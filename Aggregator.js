const { buildXmltv } = require('./ChannelManager');
const { getChannelLogos } = require('./utils');
const { canonicalKey, canonicalEventId, stripTime, sameGame } = require('./canonicalName');
const { pickEventLogo, pickMatchupLogos } = require('./eventLogos');
const { normalizeLeagueLabel, normalizeEventName, stripLeaguePrefix } = require('./displayName');
const { PUBLIC_BASE_URL, STREAM_CACHE_MS, RESOLVE_BUDGET_MS, EVENT_FILTER } = require('./config');
const { SourceRanker, sourceKey } = require('./SourceRanker');
const { createEventFilter } = require('./EventFilter');
const { inferSport } = require('./sports');
const { networkKey } = require('./networkKey');

// streamRef / altStreamRefs entries are a bare ref or { ref, quality }.
function normalizeRef(r) {
  if (r && typeof r === 'object') {
    if (r.ref == null || r.ref === '') return null;
    return r.quality ? { ref: r.ref, quality: r.quality } : { ref: r.ref };
  }
  return r == null || r === '' ? null : { ref: r };
}

class ResolveTimeout extends Error {}

// The abandoned attempt keeps running (a provider can't be cancelled), so its
// eventual rejection is swallowed here rather than surfacing as unhandled.
function withTimeout(promise, ms) {
  promise.catch(() => {});
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new ResolveTimeout(`timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// M3U attributes are double-quoted and the title follows the last comma, so a
// stray quote or newline in a source-supplied string corrupts the row (and the
// rows after it, for parsers that don't resync on #EXTINF).
function m3uAttr(s) {
  return String(s ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/"/g, "'");
}
function m3uTitle(s) {
  return String(s ?? '').replace(/[\r\n]+/g, ' ');
}

// Rendered artwork lives behind /logo/event and is addressed by the same
// display strings that appear in the guide, so one URL covers crest-backed and
// text-only events alike.
function eventArtUrl(base, ev, fmt) {
  const q = [
    `fmt=${fmt}`,
    `league=${encodeURIComponent(ev.league || '')}`,
    `name=${encodeURIComponent(ev.name || '')}`,
  ];
  if (ev.startSec) q.push(`t=${ev.startSec}`);
  return `${base}/logo/event?${q.join('&')}`;
}

// listLinearChannels() returns either the legacy { displayName: ref } map or an
// array of { name, ref, logo?, group? } (playlist-backed sources, which carry
// their own artwork/groups and can list two channels under one name).
function normalizeLinear(channels) {
  if (Array.isArray(channels)) {
    return channels.filter(c => c && c.name && c.ref != null && c.ref !== '');
  }
  return Object.entries(channels || {}).map(([name, ref]) => ({ name, ref }));
}

// Fans the M3U/EPG/stream surface out across N providers:
//   - linear channels are merged by network (id `live:<networkKey>`), each
//     provider's copy becoming one ranked source of the merged channel
//   - events are deduped by cross-provider canonical identity, keeping an
//     ordered source list so a dead link at record time falls through to the
//     next provider
//   - EPG folds every provider's linear guide together with synthesized event
//     programmes, all keyed to the same ids the M3U emits
//
// Downstream (Dispatcharr/Plex) never sees provider boundaries: one channel per
// game, league as the group-title, "@ <time>" preserved in the name. That's
// what keeps the recording scheduler provider-agnostic.
class Aggregator {
  constructor(providers, { eventFilter = EVENT_FILTER } = {}) {
    this.providers = providers || [];
    this.eventFilter = createEventFilter(eventFilter);
    // Events EVENT_FILTER removed on the last listing pass, for /debug/dropped.
    this.dropped = [];
    this._droppedKeys = new Set();
    this._providerByName = new Map(this.providers.map(p => [p.name, p]));
    this.streamIndex = new Map(); // publicId -> [{ providerName, ref }]
    // publicId -> { stream, sourceKey, expires }. Players re-request the entry
    // URL on reconnect (and on every reload when the upstream entry is a media
    // playlist), so without this each poll re-ran the full resolve — for
    // DaddyLive that's a headless-browser session per request.
    this._resolved = new Map();
    // publicId -> in-flight resolve promise. A tune fans out into several
    // concurrent /channel requests (Plex retries, ffmpeg reconnects, the
    // recorder), and each used to run its own resolve, a headless browser for
    // DaddyLive, so a slow source piled up sessions until the box stalled.
    this._inflight = new Map();
    this.streamCacheMs = STREAM_CACHE_MS;
    this.resolveBudgetMs = RESOLVE_BUDGET_MS;
    this.ranker = new SourceRanker();
    this._providerOrder = new Map(this.providers.map((p, i) => [p.name, i]));
    this._costOf = name => {
      const p = this._providerByName.get(name);
      return (p && p.resolveCost) || 'http';
    };
    this.epgXml = null;
    this.epgLastRefresh = 0;
    this.epgRefreshing = null;
  }

  async ensureReady() {
    await Promise.all(
      this.providers.map(p =>
        p.ensureReady().catch(e => console.error(`[${p.name}] ensureReady: ${e.message}`)),
      ),
    );
  }

  async refreshEvents() {
    await Promise.all(
      this.providers.map(p =>
        p.refreshEvents().catch(e => console.error(`[${p.name}] refreshEvents: ${e.message}`)),
      ),
    );
  }

  // Collect every provider's events and collapse same-game duplicates. Each
  // returned entry carries the ordered fallback `sources`.
  async _dedupeEvents() {
    const byKey = new Map();
    const dropped = [];
    for (const p of this.providers) {
      let events = [];
      try {
        events = await p.listEvents();
      } catch (e) {
        console.error(`[${p.name}] listEvents: ${e.message}`);
      }
      for (const ev of events) {
        if (!ev || !normalizeRef(ev.streamRef)) continue;
        // Strip the source's own emoji/flag decoration before anything derives
        // from these strings. The league is part of the canonical key, so
        // leaving it raw splits one game's league ("⚾ 🇨🇦 MLB" vs "⚾ 🇺🇸 MLB")
        // into separate dedup buckets and separate Dispatcharr channel groups.
        const league = normalizeLeagueLabel(ev.league);
        // The source now bakes the league into the matchup too; without this the
        // guide title prepends it a second time ("MLB: MLB: Tigers vs ...").
        const name = stripLeaguePrefix(normalizeEventName(ev.name), league);
        const sport = inferSport({ ...ev, league, name });
        const normalized = { ...ev, league, name, sport };
        if (this.eventFilter && !this.eventFilter.keep(normalized)) {
          dropped.push({ provider: p.name, sport, league, category: ev.category ?? null, name });
          continue;
        }
        const key = canonicalKey(normalized);
        // Exact identity first; then the looser same-game test so a source that
        // spells a team differently, or rounds the start across a UTC midnight,
        // lands as a fallback on the existing channel instead of a duplicate.
        let bucket = byKey.get(key);
        if (!bucket) {
          for (const b of byKey.values()) {
            if (sameGame(b, normalized)) {
              bucket = b;
              break;
            }
          }
          if (bucket) byKey.set(key, bucket);
        }
        if (!bucket) {
          const matchup = pickMatchupLogos({ league, name });
          bucket = {
            id: canonicalEventId(normalized),
            name,
            league,
            sport,
            logo:
              ev.logo || (matchup ? matchup.away : null) || pickEventLogo({ league, name }) || '',
            awayLogo: matchup ? matchup.away : null,
            homeLogo: matchup ? matchup.home : null,
            startSec: ev.startSec,
            endSec: ev.endSec,
            sources: [],
          };
          byKey.set(key, bucket);
        }
        // A source may carry alternate feeds for the same game (dlhd lists
        // several channels per event); queue them right behind the primary so a
        // dead feed falls through to the provider's next one before the next
        // provider.
        const refs = [ev.streamRef, ...(Array.isArray(ev.altStreamRefs) ? ev.altStreamRefs : [])];
        for (const raw of refs) {
          const r = normalizeRef(raw);
          if (!r) continue;
          const dup = bucket.sources.some(s => s.providerName === p.name && s.ref === r.ref);
          if (!dup) bucket.sources.push({ providerName: p.name, ...r });
        }
      }
    }
    this._recordDropped(dropped);
    // byKey can alias one bucket under several keys after a fuzzy match.
    return [...new Set(byKey.values())].sort(
      (a, b) => (a.startSec || 0) - (b.startSec || 0) || a.name.localeCompare(b.name),
    );
  }

  // Every provider's linear channels, merged by network. Name and group come
  // from the first provider in PROVIDERS order that lists the network, the
  // logo from the first that has one; sources keep that order, and ranking
  // reorders them at tune time.
  async _linearChannels(logoByName = new Map()) {
    const byKey = new Map();
    for (const p of this.providers) {
      let channels = {};
      try {
        channels = await p.listLinearChannels();
      } catch (e) {
        console.error(`[${p.name}] listLinearChannels: ${e.message}`);
      }
      for (const ch of normalizeLinear(channels)) {
        // A name that is all decoration ("HD") still needs a stable id.
        const key = networkKey(ch.name) || networkKey(`${p.name} ${ch.ref}`);
        let entry = byKey.get(key);
        if (!entry) {
          entry = {
            id: `live:${key}`,
            name: ch.name,
            group: ch.group || 'Live TV',
            logo: '',
            sources: [],
          };
          byKey.set(key, entry);
        }
        if (!entry.logo) entry.logo = ch.logo || logoByName.get(ch.name) || '';
        if (!entry.sources.some(s => s.providerName === p.name && s.ref === ch.ref)) {
          entry.sources.push({ providerName: p.name, ref: ch.ref });
        }
      }
    }
    return [...byKey.values()];
  }

  // Build merged M3U rows and (re)populate the stream index that resolveStream
  // reads. Returns { linearEntries, eventEntries } for formatting/tests.
  async listM3uEntries(base = '') {
    const index = new Map();
    const logos = await getChannelLogos().catch(() => ({ channels: [] }));
    const logoByName = new Map(
      (logos.channels || []).filter(c => c?.name && c?.logo).map(c => [c.name, c.logo]),
    );

    const linearEntries = (await this._linearChannels(logoByName)).map(ch => {
      index.set(ch.id, ch.sources);
      return { tvgId: ch.id, name: ch.name, group: ch.group, logo: ch.logo, streamId: ch.id };
    });

    const eventEntries = (await this._dedupeEvents()).map(ev => {
      // Every event gets rendered art when we know our public base URL — the
      // renderer falls back to text for leagues with no crest table, so no
      // event ships a blank tvg-logo.
      const logo = base ? eventArtUrl(base, ev, 'thumb') : ev.logo;
      index.set(ev.id, ev.sources);
      return {
        tvgId: ev.id,
        name: ev.name,
        group: ev.league,
        logo,
        streamId: ev.id,
        startSec: ev.startSec,
      };
    });

    this.streamIndex = index;
    return { linearEntries, eventEntries };
  }

  async getM3u(base) {
    const { linearEntries, eventEntries } = await this.listM3uEntries(base);
    let chno = 0;
    let m3u = '#EXTM3U';
    for (const e of [...linearEntries, ...eventEntries]) {
      chno++;
      m3u +=
        `\n#EXTINF:-1 tvg-id="${m3uAttr(e.tvgId)}" tvg-chno="${chno}" tvg-logo="${m3uAttr(e.logo)}" group-title="${m3uAttr(e.group)}", ${m3uTitle(e.name)}` +
        `\n${base}/channel/${encodeURIComponent(e.streamId)}`;
    }
    return m3u;
  }

  async refreshEpg() {
    if (this.epgRefreshing) return this.epgRefreshing;
    this.epgRefreshing = (async () => {
      const allItems = [];
      const allProgrammes = {};

      // Provider guides keyed by `${provider}:${chid}`. Every provider uses
      // its stream ref as its guide chid, so these line up with sources.
      const guideItems = new Map();
      const guideProgrammes = new Map();
      for (const p of this.providers) {
        let data = { items: [], programmesByChid: {} };
        try {
          data = await p.getEpgData();
        } catch (e) {
          console.error(`[${p.name}] getEpgData: ${e.message}`);
        }
        for (const it of data.items || []) guideItems.set(`${p.name}:${it.chid}`, it);
        for (const [chid, progs] of Object.entries(data.programmesByChid || {})) {
          if (Array.isArray(progs) && progs.length) guideProgrammes.set(`${p.name}:${chid}`, progs);
        }
      }

      // One guide row per merged linear channel, under the same live: id the
      // M3U emits. Programmes come from the first source that has any, so a
      // guide-less copy of a network never blanks one that has a guide.
      for (const ch of await this._linearChannels()) {
        const keys = ch.sources.map(s => `${s.providerName}:${s.ref}`);
        const withGuide = keys.find(k => guideProgrammes.has(k));
        const item = guideItems.get(withGuide || keys[0]);
        allItems.push({
          name: ch.name,
          chid: ch.id,
          logo: ch.logo || (item && item.logo) || null,
        });
        if (withGuide) allProgrammes[ch.id] = guideProgrammes.get(withGuide);
      }

      // Synthesize one programme per deduped event, keyed to the same id the
      // M3U emits so Plex pairs the row with its guide entry.
      for (const ev of await this._dedupeEvents()) {
        // The channel name keeps the "@ <time>" suffix (Dispatcharr's recording
        // scheduler parses it out of Channel.name); the programme title drops it
        // because Plex already renders the time slot.
        const title = `${ev.league}: ${stripTime(ev.name)}`;
        const base = PUBLIC_BASE_URL;
        allItems.push({
          name: title,
          chid: ev.id,
          logo: (base ? eventArtUrl(base, ev, 'thumb') : ev.logo) || null,
        });
        // Tag as Sports (+ the league) so Plex categorizes these in its Sports
        // hub with the right artwork/metadata.
        const categories = [...new Set(['Sports', ev.league].filter(Boolean))];
        // Programme-level icon drives Plex poster art, which it renders in a 2:3
        // frame — hence the portrait format here and the landscape one above.
        const icon = base ? eventArtUrl(base, ev, 'poster') : ev.logo || null;
        allProgrammes[ev.id] = [
          { title, startTime: ev.startSec, endTime: ev.endSec, categories, icon },
        ];
      }

      const { xml, programmeCount } = buildXmltv(allItems, allProgrammes);
      this.epgXml = xml;
      this.epgLastRefresh = Date.now();
      console.log(`[epg] refreshed: ${allItems.length} channels, ${programmeCount} programmes`);
    })();
    try {
      await this.epgRefreshing;
    } finally {
      this.epgRefreshing = null;
    }
  }

  getEpgXml() {
    return this.epgXml;
  }

  // Resolve a public id to a playable stream, trying its sources best-first
  // (see SourceRanker: recent health, then quality, then resolve cost, then
  // provider order). Every outcome is recorded so the next tune ranks better.
  //
  // `validate(stream)` (optional) is called on every candidate and must return
  // a truthy value only when the stream actually plays — app.js passes a
  // manifest fetch, so a provider that hands back a dead or geo-blocked URL
  // falls through to the next source instead of ending the request. Whatever
  // validate returns is passed back as `check` so the caller can reuse it
  // (e.g. the manifest body it already downloaded).
  //
  // A validated stream is cached per id; the cached URL is re-validated on use,
  // so an expired token costs one failed check and a fresh resolve. Each
  // successful re-validation extends the entry, so a channel that is being
  // played keeps its stream: the player reloads the playlist every few seconds,
  // and a hard expiry made one of those reloads wait on a full resolve (tens of
  // seconds for DaddyLive), which stalled playback long enough for Dispatcharr
  // to drop the channel. The TTL now only ages out channels nobody is watching.
  //
  // Concurrent calls for the same id share one resolve, and its result.
  resolveStream(publicId, opts = {}) {
    const pending = this._inflight.get(publicId);
    if (pending) return pending;
    const p = this._resolveStream(publicId, opts).finally(() => {
      this._inflight.delete(publicId);
    });
    this._inflight.set(publicId, p);
    return p;
  }

  async _resolveStream(publicId, { validate } = {}) {
    const sources = this.streamIndex.get(publicId);
    if (!sources || sources.length === 0) throw new Error(`unknown stream id: ${publicId}`);

    const cached = this._resolved.get(publicId);
    if (cached && cached.expires > Date.now()) {
      if (!validate) return cached.stream;
      const check = await Promise.resolve(validate(cached.stream)).catch(() => null);
      if (check) {
        cached.expires = Date.now() + this.streamCacheMs;
        return { ...cached.stream, check };
      }
      this.ranker.recordFailure(cached.source, 'cached stream stopped validating');
      this._resolved.delete(publicId);
    }

    const deadline = Date.now() + this.resolveBudgetMs;
    let lastErr;
    let attempts = 0;
    for (const source of this._rankedSources(sources)) {
      const { providerName, ref } = source;
      const provider = this._providerByName.get(providerName);
      if (!provider) continue;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        console.error(
          `[aggregator] ${publicId}: resolve budget spent before trying ${sourceKey(source)} and any later sources`,
        );
        break;
      }
      const firstAttempt = attempts++ === 0;
      try {
        const { res, check } = await withTimeout(
          this._attempt(provider, source, validate),
          remaining,
        );
        const height = (check && check.height) || (res.quality && res.quality.height);
        this.ranker.recordSuccess(source, { height });
        if (this.streamCacheMs > 0) {
          this._resolved.set(publicId, {
            stream: res,
            source,
            expires: Date.now() + this.streamCacheMs,
          });
        }
        return check === undefined ? res : { ...res, check };
      } catch (e) {
        lastErr = e;
        // A later source cut off by what earlier ones spent says nothing about
        // its own health; only a source that had the whole budget is blamed.
        if (!(e instanceof ResolveTimeout) || firstAttempt) {
          this.ranker.recordFailure(source, e.message);
        }
        console.error(`[${providerName}] resolveStream(${ref}): ${e.message}`);
      }
    }
    throw lastErr || new Error(`no source resolved for ${publicId}`);
  }

  async _attempt(provider, { providerName, ref }, validate) {
    const res = await provider.resolveStream(ref);
    if (!res || !res.url) throw new Error(`${providerName}:${ref} resolved to no stream`);
    if (!validate) return { res, check: undefined };
    const check = await validate(res);
    if (!check) throw new Error(`${providerName}:${ref} resolved but did not validate`);
    return { res, check };
  }

  _rankedSources(sources) {
    return this.ranker.rank(sources, { providerOrder: this._providerOrder, costOf: this._costOf });
  }

  // _dedupeEvents runs on every M3U fetch and EPG build, so only events not
  // already reported are logged.
  _recordDropped(dropped) {
    const keys = new Set();
    for (const d of dropped) {
      const key = `${d.provider}|${d.name}`;
      keys.add(key);
      if (!this._droppedKeys.has(key)) {
        console.log(
          `[filter] dropped ${d.provider} event "${d.name}" ` +
            `(sport=${d.sport}, league=${d.league}, category=${d.category ?? '-'})`,
        );
      }
    }
    this._droppedKeys = keys;
    this.dropped = dropped;
  }

  listDropped() {
    return {
      filter: this.eventFilter ? this.eventFilter.entries : null,
      count: this.dropped.length,
      dropped: this.dropped,
    };
  }

  // Ranked sources for one channel with the reasons behind the order, for
  // /debug/sources. Null for an unknown id.
  explainSources(publicId) {
    const sources = this.streamIndex.get(publicId);
    if (!sources) return null;
    const cached = this._resolved.get(publicId);
    return {
      id: publicId,
      playing:
        cached && cached.expires > Date.now() && cached.source ? sourceKey(cached.source) : null,
      sources: this.ranker.explain(sources, {
        providerOrder: this._providerOrder,
        costOf: this._costOf,
      }),
    };
  }

  // Drop a cached resolution (e.g. after the upstream starts failing mid-play).
  invalidateStream(publicId) {
    this._resolved.delete(publicId);
  }

  // The source playing on `publicId` failed during playback: count it against
  // that source and drop the cached resolution, so the next resolve walks the
  // ranking again with the failed source last. Returns the failed source, or
  // null when nothing was cached.
  reportFailure(publicId, reason) {
    const cached = this._resolved.get(publicId);
    this._resolved.delete(publicId);
    if (!cached || !cached.source) return null;
    this.ranker.recordFailure(cached.source, reason);
    return cached.source;
  }
}

module.exports = Aggregator;
