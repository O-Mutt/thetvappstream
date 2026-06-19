const axios = require('axios');

// Header-locked HLS (DaddyLive et al.) can't be recorded via a plain redirect:
// the CDN requires a Referer/Origin the player can't be told to send. So we
// proxy the manifest, rewriting every segment/variant/key URI to come back
// through /hlsseg, and fetch those with the required headers on the server side.

// Resolve a possibly-relative URI against the manifest URL and route it through
// the segment proxy, carrying the stream id so /hlsseg can look up headers.
function proxyUri(uri, manifestUrl, base, streamId) {
  const abs = new URL(uri, manifestUrl).href;
  return `${base}/hlsseg/${encodeURIComponent(streamId)}?u=${encodeURIComponent(abs)}`;
}

// Rewrite an m3u8 body. Variant playlists (#EXT-X-STREAM-INF) and segment lines
// are bare URIs; EXT-X-KEY / EXT-X-MEDIA / EXT-X-MAP carry URI="..." attributes.
function rewriteManifest(manifestText, manifestUrl, base, streamId) {
  return String(manifestText)
    .split(/\r?\n/)
    .map(line => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        return line.replace(
          /URI="([^"]+)"/g,
          (_m, uri) => `URI="${proxyUri(uri, manifestUrl, base, streamId)}"`,
        );
      }
      return proxyUri(trimmed, manifestUrl, base, streamId);
    })
    .join('\n');
}

function isManifest(url, contentType) {
  return /\.m3u8(\?|$)/i.test(url) || /mpegurl/i.test(contentType || '');
}

// Express handler factory. `lookupHeaders(streamId)` returns the headers stored
// for that stream at resolve time (or null).
function createHlsHandlers({ lookupHeaders, baseUrlFor }) {
  // GET /channel manifest entrypoint is handled by app.js; this serves the
  // nested manifest + segments once the entry URL is known.
  async function serveManifest(req, res, { streamId, url, headers, base }) {
    const upstream = await axios.get(url, {
      headers,
      responseType: 'text',
      timeout: 20000,
      maxRedirects: 5,
      validateStatus: () => true,
      transformResponse: x => x,
    });
    if (upstream.status !== 200) {
      res.status(502).send(`upstream manifest ${upstream.status}`);
      return;
    }
    const finalUrl = upstream.request?.res?.responseUrl || url;
    res
      .type('application/vnd.apple.mpegurl')
      .send(rewriteManifest(upstream.data, finalUrl, base, streamId));
  }

  async function segment(req, res) {
    const streamId = req.params.streamId;
    const target = req.query.u;
    const headers = lookupHeaders(streamId);
    if (!target || !headers) {
      res.status(404).send('unknown segment');
      return;
    }
    const upstream = await axios.get(target, {
      headers,
      responseType: 'stream',
      timeout: 20000,
      maxRedirects: 5,
      validateStatus: () => true,
    });
    if (upstream.status !== 200) {
      res.status(502).send(`upstream segment ${upstream.status}`);
      return;
    }
    // Nested manifests (variant -> media playlist) must be rewritten too;
    // everything else streams straight through.
    const ctype = upstream.headers['content-type'] || '';
    if (isManifest(target, ctype)) {
      const chunks = [];
      upstream.data.on('data', c => chunks.push(c));
      upstream.data.on('end', () => {
        const base = baseUrlFor(req);
        const finalUrl = upstream.request?.res?.responseUrl || target;
        res
          .type('application/vnd.apple.mpegurl')
          .send(rewriteManifest(Buffer.concat(chunks).toString('utf8'), finalUrl, base, streamId));
      });
      upstream.data.on('error', () => res.status(502).end());
      return;
    }
    if (ctype) res.type(ctype);
    upstream.data.pipe(res);
  }

  return { serveManifest, segment };
}

module.exports = { rewriteManifest, proxyUri, isManifest, createHlsHandlers };
