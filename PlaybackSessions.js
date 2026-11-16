const {
  parseMediaPlaylist,
  chooseRendition,
  renderSession,
  spliceOffset,
  lastUpstreamSeq,
} = require('./sessionPlaylist');

// One live session per channel id, shared by every client watching it. Each
// playlist reload checks the source in use and, when it has failed, stalled
// or ended, switches to the next ranked source and splices it into the same
// playlist. See docs/design/playback-failover.md.
//
// deps:
//   aggregator    resolveStream(id, { validate }), reportFailure(id, reason)
//   probe         (url, headers) -> probeStream result
//   fetchText     (url, headers) -> { status, text, finalUrl }; throws on network error
//   proxyUri      (absUrl, base, id) -> the /hlsseg URL for a header-locked segment
//   setHeaders    (id, headers) -> store the headers /hlsseg replays
class PlaybackSessions {
  constructor({
    aggregator,
    probe,
    fetchText,
    proxyUri,
    setHeaders = () => {},
    minHeight = 0,
    now = () => Date.now(),
    idleMs = 2 * 60 * 1000,
    reuseMs = 1000,
    stallMinMs = 20 * 1000,
    failoverCooldownMs = 15 * 1000,
  }) {
    Object.assign(this, { aggregator, probe, fetchText, proxyUri, setHeaders, minHeight, now });
    Object.assign(this, { idleMs, reuseMs, stallMinMs, failoverCooldownMs });
    this.sessions = new Map();
  }

  // -> { kind: 'playlist', text } to send as the channel's playlist, or
  //    { kind: 'legacy', stream } for a stream that can't be served as one
  //    media playlist (non-HLS, separate audio); the caller serves it as before.
  async serve(id, { base }) {
    let s = this.sessions.get(id);
    if (s && this.now() - s.touchedAt > this.idleMs) {
      this.sessions.delete(id);
      s = null;
    }
    if (!s) {
      const started = await this._start(id);
      if (started.kind === 'legacy') return started;
      s = started.session;
      this.sessions.set(id, s);
    } else {
      try {
        await this._refresh(id, s);
      } catch (e) {
        this.sessions.delete(id);
        throw e;
      }
    }
    s.touchedAt = this.now();
    return { kind: 'playlist', text: this._render(id, s, base) };
  }

  describe(id) {
    const s = this.sessions.get(id);
    if (!s) return null;
    return {
      upstreamHost: hostOf(s.upstream.url),
      offset: s.state.offset,
      splices: s.splices,
      lastSeq: s.state.lastSeq,
      upstreamAdvancedAt: new Date(s.advancedAt).toISOString(),
    };
  }

  // Resolve the channel and load the media playlist to serve. A master is
  // narrowed to one rendition.
  async _resolveUpstream(id) {
    const stream = await this.aggregator.resolveStream(id, {
      validate: st => this.probe(st.url, st.headers).catch(() => null),
    });
    const { check } = stream;
    if (!check || check.kind !== 'hls') return { legacy: stream };
    const headers = stream.headers || {};
    const needsHeaders = Object.keys(headers).length > 0;
    const finalUrl = check.finalUrl || stream.url;
    let url = finalUrl;
    let playlist = parseMediaPlaylist(check.text);
    if (!playlist) {
      const choice = chooseRendition(check.text, finalUrl, this.minHeight);
      if (!choice || choice.separateAudio) return { legacy: stream };
      const r = await this.fetchText(choice.url, headers);
      playlist = r.status >= 200 && r.status < 300 ? parseMediaPlaylist(r.text) : null;
      if (!playlist || !playlist.segments.length) {
        throw new Error(`rendition playlist unavailable (${r.status}) for ${id}`);
      }
      url = r.finalUrl || choice.url;
    }
    return { upstream: { url, headers, needsHeaders }, playlist };
  }

  async _start(id) {
    const got = await this._resolveUpstream(id);
    if (got.legacy) return { kind: 'legacy', stream: got.legacy };
    const t = this.now();
    const session = {
      upstream: got.upstream,
      playlist: got.playlist,
      fetchedAt: t,
      state: { offset: 0, lastSeq: -1, discontinuities: new Set(), discontinuitySeq: 0 },
      upstreamLastSeq: lastUpstreamSeq(got.playlist),
      advancedAt: t,
      splices: 0,
      failedOverAt: 0,
      refreshing: null,
      touchedAt: t,
    };
    if (got.upstream.needsHeaders) this.setHeaders(id, got.upstream.headers);
    return { kind: 'session', session };
  }

  // Concurrent reloads share one upstream check, and a check under `reuseMs`
  // old is reused.
  async _refresh(id, s) {
    if (this.now() - s.fetchedAt < this.reuseMs) return;
    if (!s.refreshing) {
      s.refreshing = this._check(id, s).finally(() => {
        s.refreshing = null;
      });
    }
    await s.refreshing;
  }

  async _check(id, s) {
    const failure = await this._health(s);
    if (!failure) return;
    // A source that fails again right after a switch, or a channel with one
    // source, would otherwise re-resolve on every reload: a headless browser
    // session every few seconds for dlhd. Serve what we have until the
    // cooldown passes.
    if (this.now() - s.failedOverAt < this.failoverCooldownMs) return;
    s.failedOverAt = this.now();
    console.warn(`[failover] ${id}: ${failure}; switching source`);
    this.aggregator.reportFailure(id, failure);
    const got = await this._resolveUpstream(id);
    if (got.legacy) throw new Error(`next source for ${id} is not a single HLS playlist`);
    const t = this.now();
    if (got.upstream.url !== s.upstream.url) {
      spliceOffset(got.playlist, s.state);
      s.splices++;
      console.log(`[failover] ${id}: now playing ${hostOf(got.upstream.url)}`);
    }
    s.upstream = got.upstream;
    s.playlist = got.playlist;
    s.fetchedAt = t;
    s.upstreamLastSeq = lastUpstreamSeq(got.playlist);
    s.advancedAt = t;
    if (got.upstream.needsHeaders) this.setHeaders(id, got.upstream.headers);
  }

  // Fetch the upstream playlist into the session. Returns why the source has
  // failed, or null when it is healthy.
  async _health(s) {
    let r;
    try {
      r = await this.fetchText(s.upstream.url, s.upstream.headers);
    } catch (e) {
      return `playlist fetch failed: ${e.message}`;
    }
    if (r.status < 200 || r.status >= 300) return `playlist answered ${r.status}`;
    const playlist = parseMediaPlaylist(r.text);
    if (!playlist || !playlist.segments.length) return 'playlist has no segments';
    if (playlist.endList) return 'playlist ended';

    const t = this.now();
    const last = lastUpstreamSeq(playlist);
    if (last < s.upstreamLastSeq) {
      // The source restarted its numbering: continue ours after what was served.
      spliceOffset(playlist, s.state);
      s.splices++;
    }
    if (last !== s.upstreamLastSeq) s.advancedAt = t;
    s.upstreamLastSeq = last;
    s.playlist = playlist;
    s.fetchedAt = t;
    const stallMs = Math.max(4 * (playlist.targetDuration || 0) * 1000, this.stallMinMs);
    if (t - s.advancedAt > stallMs)
      return `playlist stalled for ${Math.round((t - s.advancedAt) / 1000)}s`;
    return null;
  }

  _render(id, s, base) {
    const { url, needsHeaders } = s.upstream;
    const mapUri = uri => {
      const abs = new URL(uri, url).href;
      return needsHeaders ? this.proxyUri(abs, base, id) : abs;
    };
    return renderSession(s.playlist, s.state, mapUri);
  }
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

module.exports = PlaybackSessions;
