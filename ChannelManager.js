const axios = require('axios');
const cheerio = require('cheerio');
const { encodeXML } = require('entities');
const { TV_URL } = require('./config');

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const BOOTSTRAP_PAGE = '/tv/ae-live-stream/';

class ChannelManager {
  constructor() {
    this.client = axios.create({
      baseURL: TV_URL,
      headers: { 'User-Agent': UA, Accept: '*/*' },
      validateStatus: () => true,
    });
    this.cookieJar = [];
    this.channelsCache = {}; // name -> chid
    this.guideIds = {}; // chid -> numeric guide-JSON id from the channel page
    this.epgXml = null;
    this.epgLastRefresh = 0;
    this.epgRefreshing = null;
    this.sessionPromise = null;
  }

  _cookieHeader() {
    return this.cookieJar.map(c => c.split(';')[0]).join('; ');
  }

  _ingestCookies(setCookieHeaders) {
    if (!setCookieHeaders) return;
    for (const raw of setCookieHeaders) {
      const name = raw.split('=')[0];
      this.cookieJar = this.cookieJar.filter(c => c.split('=')[0] !== name);
      this.cookieJar.push(raw);
    }
  }

  async ensureSession(force = false) {
    if (force) {
      this.cookieJar = [];
      this.sessionPromise = null;
    }
    if (this.sessionPromise) return this.sessionPromise;
    if (!force && this.cookieJar.length > 0) return;

    this.sessionPromise = (async () => {
      const r1 = await this.client.get('/');
      if (r1.status !== 200) throw new Error(`session bootstrap GET / failed: ${r1.status}`);
      this._ingestCookies(r1.headers['set-cookie']);

      const r2 = await this.client.get(BOOTSTRAP_PAGE, {
        headers: { Cookie: this._cookieHeader() },
      });
      if (r2.status !== 200)
        throw new Error(`session bootstrap GET ${BOOTSTRAP_PAGE} failed: ${r2.status}`);
      this._ingestCookies(r2.headers['set-cookie']);

      console.log(`[session] established (${this.cookieJar.length} cookies)`);
    })();

    try {
      await this.sessionPromise;
    } finally {
      this.sessionPromise = null;
    }
  }

  async _getWithRetry(path, { retries = 3, baseDelayMs = 750 } = {}) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const r = await this.client.get(path, { headers: { Cookie: this._cookieHeader() } });
      if (r.status === 200) return r;
      if (r.status === 503 && attempt < retries) {
        await new Promise(res => setTimeout(res, baseDelayMs * (attempt + 1)));
        continue;
      }
      return r;
    }
  }

  async _runWithConcurrency(items, limit, worker) {
    const results = [];
    let i = 0;
    const runners = Array.from({ length: limit }, async () => {
      while (i < items.length) {
        const idx = i++;
        results[idx] = await worker(items[idx], idx);
      }
    });
    await Promise.all(runners);
    return results;
  }

  async listChannels() {
    if (Object.keys(this.channelsCache).length > 0) return this.channelsCache;
    await this.ensureSession();

    const index = await this._getWithRetry('/');
    const $ = cheerio.load(index.data);

    const links = [];
    $('a.list-group-item').each((_, el) => {
      const href = $(el).attr('href');
      const name = $(el).text().replace(/\s+/g, ' ').trim();
      if (href && name && href.startsWith('/tv/')) links.push({ href, name });
    });

    const chids = {};
    const guideIds = {};
    await this._runWithConcurrency(links, 4, async ({ href, name }) => {
      try {
        const r = await this._getWithRetry(href);
        if (r.status !== 200) {
          console.error(`listChannels: ${name}: ${href} -> ${r.status}`);
          return;
        }
        const body = r.data || '';
        const m = /<div id="stream_name"\s+name="([^"]+)"/.exec(body);
        if (!m) return;
        chids[name] = m[1];
        const gm = /thetvapp\.to\/json\/(\d+)\.json/.exec(body);
        if (gm) guideIds[m[1]] = gm[1];
      } catch (e) {
        console.error(`listChannels: ${name}: ${e.message}`);
      }
    });

    this.channelsCache = Object.fromEntries(
      Object.keys(chids)
        .sort()
        .map(k => [k, chids[k]]),
    );
    this.guideIds = guideIds;
    console.log(
      `[channels] loaded ${Object.keys(this.channelsCache).length} ` +
        `(${Object.keys(guideIds).length} with guide IDs)`,
    );
    return this.channelsCache;
  }

  async refreshEpg() {
    if (this.epgRefreshing) return this.epgRefreshing;
    this.epgRefreshing = (async () => {
      const channels = await this.listChannels();
      const items = Object.entries(channels)
        .filter(([, chid]) => this.guideIds[chid])
        .map(([name, chid]) => ({ name, chid, guideId: this.guideIds[chid] }));

      const programmes = {};
      await this._runWithConcurrency(items, 4, async item => {
        try {
          const r = await this._getWithRetry(`/json/${item.guideId}.json`);
          if (r.status === 200 && Array.isArray(r.data)) {
            programmes[item.chid] = r.data;
          }
        } catch (e) {
          console.error(`epg ${item.name} (${item.guideId}): ${e.message}`);
        }
      });

      const lines = ['<?xml version="1.0" encoding="UTF-8"?>'];
      lines.push('<tv generator-info-name="thetvappstream">');
      for (const it of items) {
        lines.push(
          `  <channel id="${encodeXML(it.chid)}"><display-name>${encodeXML(it.name)}</display-name></channel>`,
        );
      }
      let progCount = 0;
      for (const it of items) {
        for (const p of programmes[it.chid] || []) {
          if (!p || !p.title || !p.startTime || !p.endTime) continue;
          lines.push(
            `  <programme channel="${encodeXML(it.chid)}" start="${formatXmltvTime(p.startTime)}" stop="${formatXmltvTime(p.endTime)}">`,
          );
          lines.push(`    <title>${encodeXML(p.title)}</title>`);
          if (p.episodeTitle) lines.push(`    <sub-title>${encodeXML(p.episodeTitle)}</sub-title>`);
          lines.push('  </programme>');
          progCount++;
        }
      }
      lines.push('</tv>');
      this.epgXml = lines.join('\n') + '\n';
      this.epgLastRefresh = Date.now();
      console.log(`[epg] refreshed: ${items.length} channels, ${progCount} programmes`);
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

  async getStream(chid) {
    await this.ensureSession();

    const fetchToken = () =>
      this.client.get(`/token/${chid}`, { headers: { Cookie: this._cookieHeader() } });

    let r = await fetchToken();
    if (r.status === 401 || r.status === 403) {
      console.log(`[session] /token/${chid} returned ${r.status}, re-bootstrapping`);
      await this.ensureSession(true);
      r = await fetchToken();
    }
    if (r.status !== 200) throw new Error(`token endpoint ${r.status}`);

    const body = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    if (!body || !body.url) throw new Error('no url in token response');
    return body.url;
  }
}

function formatXmltvTime(unixSeconds) {
  const d = new Date(unixSeconds * 1000);
  const pad = n => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())} +0000`
  );
}

module.exports = ChannelManager;
