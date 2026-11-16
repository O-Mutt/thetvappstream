const axios = require('axios');
const Provider = require('../Provider');
const MirrorResolver = require('../../MirrorResolver');
const browser = require('../../browser');
const { STREAMFREE_URLS, STREAMFREE_ENABLE_LINEAR } = require('../../config');
const {
  parseRef,
  parseStreams,
  parseEmbed,
  playlistPath,
  tokenQuery,
  qualityHeight,
  parseEmbedUrl,
} = require('./parse');

const UA = browser.DEFAULT_UA;
const DIRECTORY_URL = 'https://strmfree.link/api/domains';
const STREAMS_PATH = '/api/v1/streams';
// The operator asks API clients to cache the listing.
const MIN_LISTING_INTERVAL_MS = 5 * 60 * 1000;

// StreamFree (strmfree.st / .pk / streamfree.top). Keyless JSON listing, and a
// stream resolves over plain HTTP: the embed page carries the playlist tokens
// and /get-stream-key names the CDN. Segments need Referer/Origin, so streams
// go through the header-adding proxy. See
// docs/design/stream-sources-and-ranking.md, section 6.
class StreamFreeProvider extends Provider {
  constructor({
    urls = STREAMFREE_URLS,
    enableLinear = STREAMFREE_ENABLE_LINEAR,
    directoryUrl = DIRECTORY_URL,
    now = () => Date.now(),
  } = {}) {
    super();
    this.fallbackUrls = urls;
    this.enableLinear = enableLinear;
    this.directoryUrl = directoryUrl;
    this.now = now;
    this.client = axios.create({
      headers: { 'User-Agent': UA, Accept: '*/*' },
      timeout: 15000,
      maxRedirects: 5,
      validateStatus: () => true,
    });
    this.mirrors = this._mirrorsFor(urls);
    this.eventsCache = [];
    this.channelsCache = [];
    this.lastListingAt = 0;
  }

  get name() {
    return 'streamfree';
  }

  _mirrorsFor(urls) {
    return new MirrorResolver('streamfree', urls, { probe: u => this._probe(u) });
  }

  async _probe(url) {
    try {
      const r = await this.client.get(`${url}/api/v1/categories`);
      return r.status === 200 && r.data != null && typeof r.data === 'object';
    } catch {
      return false;
    }
  }

  // The operator publishes its current domains; put those ahead of the
  // configured list so a domain move needs no config change.
  async _loadDirectory() {
    try {
      const r = await this.client.get(this.directoryUrl);
      const domains = r.status === 200 && Array.isArray(r.data) ? r.data : [];
      const urls = domains
        .filter(d => typeof d === 'string' && /^[a-z0-9.-]+$/i.test(d))
        .map(d => `https://${d}`);
      if (urls.length) return [...urls, ...this.fallbackUrls];
    } catch (e) {
      console.warn(`[streamfree] mirror directory: ${e.message}`);
    }
    return this.fallbackUrls;
  }

  async ensureReady() {
    const urls = await this._loadDirectory();
    const mirrors = this._mirrorsFor(urls);
    if (await mirrors.resolve()) this.mirrors = mirrors;
    else await this.mirrors.resolve();
  }

  base() {
    return this.mirrors.active();
  }

  // GET against the active mirror; on a connection error, rotate and retry once.
  async _get(path, { referer = true } = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const base = this.base();
      try {
        const r = await this.client.get(`${base}${path}`, {
          headers: referer ? { Referer: `${base}/` } : {},
        });
        return { r, base };
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
    if (this.now() - this.lastListingAt < MIN_LISTING_INTERVAL_MS) return;
    let parsed = null;
    try {
      const { r, base } = await this._get(STREAMS_PATH, { referer: false });
      if (r.status === 200 && r.data && Array.isArray(r.data.streams)) {
        parsed = parseStreams(r.data, { nowSec: Math.floor(this.now() / 1000) });
        this.lastListingAt = this.now();
        console.log(
          `[streamfree] listing: ${parsed.events.length} event(s), ` +
            `${parsed.channels.length} channel(s) via ${base}`,
        );
      } else {
        console.error(`[streamfree] listing: HTTP ${r.status} from ${base}`);
      }
    } catch (e) {
      console.error(`[streamfree] listing: ${e.message}`);
    }
    if (parsed) {
      this.eventsCache = parsed.events;
      this.channelsCache = parsed.channels;
      return;
    }
    // Emptying the cache on a failed fetch would drop every in-progress game
    // from the M3U until the next refresh.
    const nowSec = Math.floor(this.now() / 1000);
    this.eventsCache = this.eventsCache.filter(ev => ev.endSec > nowSec);
  }

  async listEvents() {
    return this.eventsCache;
  }

  async listLinearChannels() {
    return this.enableLinear ? this.channelsCache : [];
  }

  async getEpgData() {
    const items = (this.enableLinear ? this.channelsCache : []).map(c => ({
      name: c.name,
      chid: c.ref,
      logo: null,
    }));
    return { items, programmesByChid: {} };
  }

  async resolveStream(streamRef) {
    const ref = parseRef(streamRef);
    if (!ref) throw new Error(`streamfree: bad ref '${streamRef}'`);
    if (ref.kind === 'variant') return this._resolveVariant(ref.category, ref.id);
    return this._resolveLiveSource(ref.category, ref.id);
  }

  // A key ref plays the best source that is live right now.
  async _resolveLiveSource(category, streamKey) {
    const { r } = await this._get(`/api/v1/sources/${encodeURIComponent(streamKey)}`, {
      referer: false,
    });
    const sources =
      r.status === 200 && r.data && Array.isArray(r.data.sources) ? r.data.sources : [];
    const live = sources
      .filter(s => s && s.live)
      .map(s => ({ embed: parseEmbedUrl(s.url), height: qualityHeight(s.quality) || 0 }))
      .filter(s => s.embed)
      .sort((a, b) => b.height - a.height);
    if (live.length === 0) throw new Error(`streamfree: nothing live for '${streamKey}'`);
    const best = live[0].embed;
    return this._resolveVariant(best.category || category, best.variant);
  }

  async _resolveVariant(category, variant) {
    const embedPath = `/embed/${encodeURIComponent(category)}/${encodeURIComponent(variant)}`;
    const { r: page, base } = await this._get(embedPath);
    if (page.status !== 200) throw new Error(`streamfree: embed HTTP ${page.status}`);
    const { tokens, quality, streamKey } = parseEmbed(page.data, variant);
    // Without tokens for this quality the site's player requests the bare
    // playlist, so do the same and let validation decide.
    const qTokens = tokens && quality ? tokens[quality] : null;

    // The tokens were issued by this mirror, so the playlist must come from it
    // too: no rotation from here on.
    let serverName = 'origin';
    let external = null;
    try {
      const k = await this.client.get(`${base}/get-stream-key/${encodeURIComponent(streamKey)}`, {
        headers: { Referer: `${base}${embedPath}` },
      });
      if (k.status === 200 && k.data && typeof k.data === 'object') {
        if (k.data.is_external && k.data.external_url) external = k.data.external_url;
        else if (k.data.server_name) serverName = String(k.data.server_name);
      }
    } catch (e) {
      // The site's player falls back to the origin path the same way.
      console.warn(`[streamfree] get-stream-key ${streamKey}: ${e.message}`);
    }

    const headers = { Referer: `${base}/`, Origin: base, 'User-Agent': UA };
    const height = qualityHeight(quality);
    const out = external
      ? { url: new URL(external, `${base}/`).href, headers }
      : { url: `${base}${playlistPath(serverName, variant)}${tokenQuery(qTokens)}`, headers };
    if (height) out.quality = { height };
    return out;
  }
}

module.exports = StreamFreeProvider;
