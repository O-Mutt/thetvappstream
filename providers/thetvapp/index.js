const axios = require('axios');
const Provider = require('../Provider');
const MirrorResolver = require('../../MirrorResolver');
const { runWithConcurrency } = require('../../ChannelManager');
const { formatEtSuffix, LEAGUE_DURATION_MIN } = require('../daddylive/parse');
const { pickEventLogo } = require('../../eventLogos');
const { DEFAULT_UA: UA } = require('../../browser');
const { THETVAPP_URLS } = require('../../config');
const {
  LEAGUE_BY_PATH,
  DEFAULT_DURATION_MIN,
  STALE_AFTER_MIN,
  parseLeagueListing,
  parseRelativeStartSec,
  isEndedBadge,
  parseWatchPage,
} = require('./parse');
const { resolveTheTvAppStream } = require('./resolve');

const MAX_AHEAD_HOURS = 36;
const EVENT_FETCH_CONCURRENCY = 6;

// TheTVApp adapter, repointed at the-tv.app after the thetvapp.to takedown.
// Event-only: per-league listing pages -> per-game watch pages -> obfuscated JS
// player. Linear channels are gone, so listLinearChannels()/getEpgData() are
// empty and event programmes are synthesized by the Aggregator.
class TheTvAppProvider extends Provider {
  constructor({ urls = THETVAPP_URLS, enableEvents = true } = {}) {
    super();
    this.enableEvents = enableEvents;
    this.mirrors = new MirrorResolver('thetvapp', urls, { probe: u => this._probe(u) });
    this.client = axios.create({
      headers: { 'User-Agent': UA, Accept: '*/*' },
      timeout: 20000,
      maxRedirects: 5,
      validateStatus: () => true,
    });
    this.eventsCache = [];
  }

  get name() {
    return 'thetvapp';
  }

  base() {
    return this.mirrors.active();
  }

  // A live mirror serves a league page with the list-group event index.
  async _probe(url) {
    try {
      const r = await this.client.get(`${url}/watch/mlb-streams`, {
        headers: { Referer: `${url}/` },
      });
      const body = String(r.data || '');
      return r.status === 200 && /list-group-item/.test(body) && /\/tv-live\//.test(body);
    } catch {
      return false;
    }
  }

  async ensureReady() {
    await this.mirrors.resolve();
  }

  // GET with mirror failover; rotate on connection error and retry once.
  async _get(path) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const base = this.base();
      try {
        return await this.client.get(`${base}${path}`, { headers: { Referer: `${base}/` } });
      } catch (e) {
        if (attempt === 0) {
          await this.mirrors.rotate();
          continue;
        }
        throw e;
      }
    }
  }

  async refreshEvents() {
    if (!this.enableEvents) {
      this.eventsCache = [];
      return;
    }
    const nowSec = Math.floor(Date.now() / 1000);

    // 1) One fetch per league page -> candidate events (skip clearly-ended ones).
    const candidates = [];
    for (const [path, league] of Object.entries(LEAGUE_BY_PATH)) {
      try {
        const r = await this._get(path);
        if (!r || r.status !== 200) {
          if (r) console.error(`[thetvapp] ${path} -> ${r.status}`);
          continue;
        }
        for (const ev of parseLeagueListing(r.data, league)) {
          if (isEndedBadge(ev.timeText)) continue;
          const coarse = parseRelativeStartSec(ev.timeText, nowSec);
          // When the badge is a relative offset we can pre-drop far-future games;
          // otherwise defer the decision to the watch page's absolute time.
          if (coarse !== null && coarse > nowSec + MAX_AHEAD_HOURS * 3600) continue;
          candidates.push({ ...ev, coarseStartSec: coarse });
        }
      } catch (e) {
        console.error(`[thetvapp] ${path}: ${e.message}`);
      }
    }

    const byHref = new Map();
    for (const e of candidates) if (!byHref.has(e.href)) byHref.set(e.href, e);

    // 2) One watch-page fetch per event for the authoritative absolute start.
    const events = [];
    await runWithConcurrency([...byHref.values()], EVENT_FETCH_CONCURRENCY, async ev => {
      try {
        const r = await this._get(ev.href);
        if (!r || r.status !== 200) return;
        const { startSec } = parseWatchPage(r.data);
        const start = startSec || ev.coarseStartSec;
        if (start == null) return;
        const durMin = LEAGUE_DURATION_MIN[ev.league] || DEFAULT_DURATION_MIN;
        const endSec = start + durMin * 60;
        if (endSec < nowSec - STALE_AFTER_MIN * 60) return;
        if (start > nowSec + MAX_AHEAD_HOURS * 3600) return;
        events.push({
          league: ev.league,
          name: `${ev.matchup} @ ${formatEtSuffix(start)}`,
          startSec: start,
          endSec,
          streamRef: ev.href, // resolved lazily; embed hosts rotate so re-fetch at play time
          logo: pickEventLogo({ league: ev.league, name: ev.matchup }) || '',
        });
      } catch (e) {
        console.error(`[thetvapp] ${ev.href}: ${e.message}`);
      }
    });

    events.sort((a, b) => a.startSec - b.startSec || a.name.localeCompare(b.name));
    this.eventsCache = events;
    console.log(
      `[thetvapp] events: ${events.length} across ${Object.keys(LEAGUE_BY_PATH).length} leagues`,
    );
  }

  async listEvents() {
    return this.eventsCache;
  }

  async listLinearChannels() {
    return {};
  }

  async getEpgData() {
    return { items: [], programmesByChid: {} };
  }

  async resolveStream(streamRef) {
    return resolveTheTvAppStream(this.base(), streamRef);
  }
}

module.exports = TheTvAppProvider;
