const axios = require('axios');
const Provider = require('../Provider');
const MirrorResolver = require('../../MirrorResolver');
const browser = require('../../browser');
const { parseChannels, parseSchedule, parseScheduleHtml } = require('./parse');
const { resolveDaddyStream } = require('./resolve');
const {
  DLHD_URLS,
  DLHD_ENABLE_EVENTS,
  DLHD_ENABLE_LINEAR,
  DLHD_MAX_STALE_DAYS,
} = require('../../config');

const UA = browser.DEFAULT_UA;
const CHANNELS_PATH = '/24-7-channels.php';
const SCHEDULE_PATH = '/schedule/schedule-generated.json';

// DaddyLive (dlhd) adapter. Linear channels + best-effort live events from the
// schedule JSON; stream resolution goes through the headless solver because the
// player is obfuscated and the CDN is Referer-locked.
class DaddyLiveProvider extends Provider {
  constructor({
    urls = DLHD_URLS,
    enableEvents = DLHD_ENABLE_EVENTS,
    enableLinear = DLHD_ENABLE_LINEAR,
    maxStaleDays = DLHD_MAX_STALE_DAYS,
  } = {}) {
    super();
    this.enableEvents = enableEvents;
    this.enableLinear = enableLinear;
    this.maxStaleDays = maxStaleDays;
    this.mirrors = new MirrorResolver('daddylive', urls, { probe: u => this._probe(u) });
    this.client = axios.create({
      headers: { 'User-Agent': UA, Accept: '*/*' },
      timeout: 20000,
      maxRedirects: 5,
      validateStatus: () => true,
    });
    this.channelsCache = {};
    this.eventsCache = [];
  }

  get name() {
    return 'daddylive';
  }

  async _probe(url) {
    try {
      const r = await this.client.get(`${url}${CHANNELS_PATH}`, {
        headers: { Referer: `${url}/` },
      });
      return r.status === 200 && /watch\.php\?id=\d+/.test(String(r.data || ''));
    } catch {
      return false;
    }
  }

  async ensureReady() {
    await this.mirrors.resolve();
  }

  base() {
    return this.mirrors.active();
  }

  // GET with mirror failover; rotate on connection error and retry once.
  async _get(path, { responseType } = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const base = this.base();
      try {
        const r = await this.client.get(`${base}${path}`, {
          headers: { Referer: `${base}/` },
          responseType,
        });
        return r;
      } catch (e) {
        if (attempt === 0) {
          await this.mirrors.rotate();
          continue;
        }
        throw e;
      }
    }
  }

  async listLinearChannels() {
    // dlhd's ~900 24/7 channels carry no EPG, so they show as empty guide rows
    // downstream. When the-tv.app (or another EPG source) is primary, disable
    // them to keep the guide clean — dlhd still contributes events.
    if (!this.enableLinear) {
      this.channelsCache = {};
      return {};
    }
    const base = this.base();
    let channels = {};
    try {
      const r = await this._get(CHANNELS_PATH);
      if (r && r.status === 200) channels = parseChannels(r.data);
    } catch (e) {
      console.error(`[daddylive] channels fetch: ${e.message}`);
    }
    // Bot shell sometimes returns a JS page with no links; fall back to render.
    if (Object.keys(channels).length === 0) {
      try {
        const html = await browser.fetchRendered(`${base}${CHANNELS_PATH}`, {
          referer: `${base}/`,
        });
        channels = parseChannels(html);
      } catch (e) {
        console.error(`[daddylive] channels render fallback: ${e.message}`);
      }
    }
    this.channelsCache = channels;
    return channels;
  }

  async refreshEvents() {
    if (!this.enableEvents) {
      this.eventsCache = [];
      return;
    }
    // Start each refresh from the most preferred live mirror, so a domain that
    // was skipped while down or frozen is picked back up once it recovers.
    if (this.mirrors.urls.length > 1) await this.mirrors.preferFirst();

    // A frozen mirror (dlhd.st served a 201-day-old schedule in Nov 2026), a
    // redesign or a block page served as 200 still passes the liveness probe,
    // which only checks the 24/7 channel list. dlhd always lists games, so zero
    // current events from both sources means this mirror is no use for events:
    // try the next one. `tried` stops the ring from spinning back to a mirror
    // that already came up empty this refresh.
    const tried = new Set();
    for (;;) {
      const base = this.base();
      tried.add(base);
      const { events, source } = await this._collectEvents(base);
      if (events.length) {
        this.eventsCache = events;
        console.log(
          `[daddylive] schedule (${source}): ${events.length} current event(s) via ${base}`,
        );
        return;
      }
      if (this.mirrors.urls.length < 2) break;
      await this.mirrors.rotate();
      const next = this.base();
      if (tried.has(next)) {
        console.warn(
          `[daddylive] no mirror lists any current events (tried ${[...tried].join(', ')})`,
        );
        break;
      }
      console.warn(`[daddylive] ${base} lists no current events; retrying on ${next}`);
    }

    this._keepLastGoodEvents();
  }

  // One schedule read against the active mirror: the homepage first, then the
  // static JSON. Returns the events and which source produced them.
  async _collectEvents(base) {
    const parseOpts = {
      maxStaleDays: this.maxStaleDays,
      onStaleDay: ({ dayKey, driftDays }) =>
        console.warn(
          `[daddylive] rejected stale schedule day "${dayKey}" (${driftDays}d from today) ` +
            `on ${base}`,
        ),
    };

    // Primary: the live, server-rendered homepage. dlhd's static
    // schedule-generated.json froze in March 2025, so the HTML is the fresh source.
    try {
      const r = await this._get('/');
      if (r && r.status === 200 && typeof r.data === 'string') {
        const events = parseScheduleHtml(r.data, parseOpts);
        if (events.length) return { events, source: 'html' };
      }
    } catch (e) {
      console.error(`[daddylive] schedule html: ${e.message}`);
    }

    // Fallback: the static schedule JSON. The freshness gate drops it when frozen,
    // so this contributes 0 rather than relabeling year-old fixtures as live.
    try {
      const r = await this._get(SCHEDULE_PATH);
      if (r && r.status === 200) {
        const json = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
        const events = parseSchedule(json, parseOpts);
        if (events.length) return { events, source: 'json' };
      }
    } catch (e) {
      console.error(`[daddylive] schedule fetch: ${e.message}`);
    }

    return { events: [], source: null };
  }

  // dlhd always lists games, so zero from both sources means the fetch failed,
  // not an empty day. Emptying the cache would drop every event channel from the
  // M3U until the next refresh, and Dispatcharr would 404 every in-progress game.
  _keepLastGoodEvents(nowSec = Math.floor(Date.now() / 1000)) {
    const before = this.eventsCache.length;
    this.eventsCache = this.eventsCache.filter(ev => ev.endSec > nowSec);
    console.warn(
      `[daddylive] schedule unavailable; keeping ${this.eventsCache.length} of ${before} ` +
        'last-good event(s) that have not ended',
    );
  }

  async listEvents() {
    return this.eventsCache;
  }

  async getEpgData() {
    // DaddyLive linear channels have no per-channel guide; expose them as EPG
    // channels (so Plex shows them) with no programmes. Event programmes are
    // synthesized by the aggregator.
    const items = Object.entries(this.channelsCache).map(([name, id]) => ({
      name,
      chid: id,
      logo: null,
    }));
    return { items, programmesByChid: {} };
  }

  async resolveStream(streamRef) {
    return resolveDaddyStream(this.base(), streamRef);
  }
}

module.exports = DaddyLiveProvider;
