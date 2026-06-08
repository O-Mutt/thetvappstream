const axios = require('axios');
const Provider = require('../Provider');
const MirrorResolver = require('../../MirrorResolver');
const browser = require('../../browser');
const { parseChannels, parseSchedule } = require('./parse');
const { resolveDaddyStream } = require('./resolve');
const { DLHD_URLS, DLHD_ENABLE_EVENTS } = require('../../config');

const UA = browser.DEFAULT_UA;
const CHANNELS_PATH = '/24-7-channels.php';
const SCHEDULE_PATH = '/schedule/schedule-generated.json';

// DaddyLive (dlhd) adapter. Linear channels + best-effort live events from the
// schedule JSON; stream resolution goes through the headless solver because the
// player is obfuscated and the CDN is Referer-locked.
class DaddyLiveProvider extends Provider {
  constructor({ urls = DLHD_URLS, enableEvents = DLHD_ENABLE_EVENTS } = {}) {
    super();
    this.enableEvents = enableEvents;
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
    try {
      const r = await this._get(SCHEDULE_PATH);
      if (r && r.status === 200) {
        const json = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
        this.eventsCache = parseSchedule(json);
        console.log(`[daddylive] schedule: ${this.eventsCache.length} current event(s)`);
      }
    } catch (e) {
      console.error(`[daddylive] schedule fetch: ${e.message}`);
      this.eventsCache = [];
    }
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
