const axios = require('axios');
const { DEFAULT_UA: UA } = require('../../browser');
const { parseWatchPage, parseEmbedPlaylist } = require('./parse');

// Resolve a the-tv.app watch path to a playable HLS manifest. Two deterministic
// HTTP hops (no headless browser needed):
//   1. watch page  -> embed host + stream id(s)   (Server1 first, Backup next)
//   2. embed page  -> player playlist url          (Referer-locked to the embed)
// The manifest is locked to the embed origin, so the returned headers must be
// replayed on the manifest + every segment (hlsProxy does this).
function newClient() {
  return axios.create({
    headers: { 'User-Agent': UA, Accept: '*/*' },
    timeout: 20000,
    maxRedirects: 5,
    validateStatus: () => true,
  });
}

async function resolveTheTvAppStream(base, watchPath, deps = {}) {
  const http = deps.http || newClient();
  const watchUrl = /^https?:\/\//.test(watchPath) ? watchPath : `${base}${watchPath}`;

  const wr = await http.get(watchUrl, { headers: { Referer: `${base}/` } });
  if (wr.status !== 200) throw new Error(`watch page ${wr.status}`);
  const { streamIds, embedHost } = parseWatchPage(wr.data);
  if (!embedHost || streamIds.length === 0) {
    throw new Error('no embed host / stream id on watch page');
  }

  const embedOrigin = `https://${embedHost}`;
  let lastErr;
  for (const id of streamIds) {
    try {
      const er = await http.get(`${embedOrigin}/new-stream-embed/${id}`, {
        headers: { Referer: `${base}/` },
      });
      if (er.status !== 200) {
        lastErr = new Error(`embed ${id} -> ${er.status}`);
        continue;
      }
      const playlist = parseEmbedPlaylist(er.data, embedOrigin);
      if (!playlist) {
        lastErr = new Error(`no playlist in embed ${id}`);
        continue;
      }
      return {
        url: playlist,
        headers: { Referer: `${embedOrigin}/`, Origin: embedOrigin, 'User-Agent': UA },
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('thetvapp: no playable stream');
}

module.exports = { resolveTheTvAppStream };
