const cheerio = require('cheerio');
const browser = require('../../browser');

// stream-<id>.php embeds the player as:
//   <iframe src="https://<rotating-host>/premiumtv/daddy3.php?id=<id>">
const EMBED_RE = /premiumtv\/daddy3\.php\?id=\d+/i;

// Pull the daddy3 embed URL out of a stream page. Exported for unit testing the
// deterministic hop without a browser.
function extractEmbedUrl(streamHtml) {
  const $ = cheerio.load(streamHtml || '');
  let src = null;
  $('iframe[src]').each((_, el) => {
    const s = $(el).attr('src');
    if (s && EMBED_RE.test(s)) src = s;
  });
  if (!src) {
    const m = /["'](https?:\/\/[^"']*premiumtv\/daddy3\.php\?id=\d+)["']/i.exec(streamHtml || '');
    if (m) src = m[1];
  }
  return src ? src.replace(/^\/\//, 'https://') : null;
}

// Build the headers a downstream fetch needs from what the browser actually
// sent, defaulting Referer/Origin to the embed origin (the player domain the
// CDN locks against).
function streamHeaders(sniffHeaders, embedOrigin) {
  const ref = sniffHeaders.referer || `${embedOrigin}/`;
  const origin = sniffHeaders.origin || embedOrigin;
  const out = { Referer: ref, Origin: origin };
  if (sniffHeaders['user-agent']) out['User-Agent'] = sniffHeaders['user-agent'];
  return out;
}

// Resolve a dlhd channel id to a playable HLS manifest URL + the headers needed
// to fetch it. `deps` is injectable for testing: { fetchPage, sniff }.
async function resolveDaddyStream(base, id, deps = {}) {
  const fetchPage = deps.fetchPage || (u => browser.fetchRendered(u, { referer: `${base}/` }));
  const sniff = deps.sniff || ((u, opts) => browser.sniffStream(u, opts));

  const streamUrl = `${base}/stream/stream-${id}.php`;
  const html = await fetchPage(streamUrl);
  const embed = extractEmbedUrl(html);
  if (!embed) throw new Error(`daddylive: no daddy3 embed for id=${id}`);

  const embedOrigin = new URL(embed).origin;
  const result = await sniff(embed, { referer: `${base}/` });
  if (!result || !result.url) throw new Error(`daddylive: no manifest for id=${id}`);

  return { url: result.url, headers: streamHeaders(result.headers || {}, embedOrigin) };
}

module.exports = { extractEmbedUrl, streamHeaders, resolveDaddyStream, EMBED_RE };
