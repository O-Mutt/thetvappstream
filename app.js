const express = require('express');
const { baseUrlFor } = require('./baseUrl');
const { PORT, PUBLIC_BASE_URL, EVENT_REFRESH_MS } = require('./config');
const { createAggregator } = require('./providers');
const { createHlsHandlers } = require('./hlsProxy');

const app = express();
// Honor X-Forwarded-Proto / X-Forwarded-Host so req.protocol + req.get('host')
// reflect the public-facing URL when behind a reverse proxy (swag/nginx/etc).
app.set('trust proxy', true);

const aggregator = createAggregator();

// Headers captured at resolve time for header-locked streams (DaddyLive et al.),
// keyed by stream id so the segment proxy can replay them.
const streamHeaders = new Map();
const hls = createHlsHandlers({
  lookupHeaders: id => streamHeaders.get(id) || null,
  baseUrlFor: req => baseUrlFor(req, PUBLIC_BASE_URL),
});

app.get('/channels.m3u', async (req, res) => {
  try {
    const base = baseUrlFor(req, PUBLIC_BASE_URL);
    res.type('audio/x-mpegurl').send(await aggregator.getM3u(base));
  } catch (e) {
    console.error(`/channels.m3u: ${e.message}`);
    res.status(500).send(e.message);
  }
});

app.get('/epg.xml', (_req, res) => {
  const xml = aggregator.getEpgXml();
  if (!xml) {
    res.status(503).type('text/plain').send('EPG not yet built; try again shortly.');
    return;
  }
  res.type('application/xml').send(xml);
});

app.get('/channel/:id', async (req, res) => {
  try {
    const { url, headers } = await aggregator.resolveStream(req.params.id);
    if (headers && Object.keys(headers).length > 0) {
      // Header-locked stream: remux through the proxy so segments carry the
      // required Referer/Origin (a redirect can't).
      streamHeaders.set(req.params.id, headers);
      await hls.serveManifest(req, res, {
        streamId: req.params.id,
        url,
        headers,
        base: baseUrlFor(req, PUBLIC_BASE_URL),
      });
    } else {
      res.redirect(url);
    }
  } catch (e) {
    console.error(`/channel/${req.params.id}: ${e.message}`);
    res.status(404).send('Channel does not exist, or is blocked.');
  }
});

app.get('/hlsseg/:streamId', (req, res) => {
  hls.segment(req, res).catch(e => {
    console.error(`/hlsseg/${req.params.streamId}: ${e.message}`);
    if (!res.headersSent) res.status(502).end();
  });
});

app.get('/healthz', (_req, res) => {
  res.type('text/plain').send('ok');
});

const EPG_REFRESH_MS = 6 * 60 * 60 * 1000;

// Listen immediately; warm the providers in the background so a slow or dead
// source never blocks the HTTP server from coming up. Until warmup finishes,
// /channels.m3u is empty and /epg.xml returns 503 — both recover on their own.
app.listen(PORT, () => {
  const advertised = PUBLIC_BASE_URL || `http://0.0.0.0:${PORT}`;
  console.log(`Server listening on :${PORT} (public base: ${advertised})`);
});

aggregator
  .ensureReady()
  // Prime the stream index (so /channel resolves before the first M3U fetch),
  // then build the EPG.
  .then(() => aggregator.listM3uEntries())
  .then(() => aggregator.refreshEpg())
  .catch(e => console.error(`startup warmup: ${e.message}`));

setInterval(() => {
  aggregator.refreshEpg().catch(e => console.error(`epg refresh: ${e.message}`));
}, EPG_REFRESH_MS);

setInterval(() => {
  aggregator
    .refreshEvents()
    .then(() => aggregator.listM3uEntries())
    .then(() => aggregator.refreshEpg())
    .catch(e => console.error(`event refresh: ${e.message}`));
}, EVENT_REFRESH_MS);
