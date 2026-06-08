const express = require('express');
const { baseUrlFor } = require('./baseUrl');
const { PORT, PUBLIC_BASE_URL, EVENT_REFRESH_MS } = require('./config');
const { createAggregator } = require('./providers');

const app = express();
// Honor X-Forwarded-Proto / X-Forwarded-Host so req.protocol + req.get('host')
// reflect the public-facing URL when behind a reverse proxy (swag/nginx/etc).
app.set('trust proxy', true);

const aggregator = createAggregator();

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
    const { url } = await aggregator.resolveStream(req.params.id);
    res.redirect(url);
  } catch (e) {
    console.error(`/channel/${req.params.id}: ${e.message}`);
    res.status(404).send('Channel does not exist, or is blocked.');
  }
});

app.get('/healthz', (_req, res) => {
  res.type('text/plain').send('ok');
});

const EPG_REFRESH_MS = 6 * 60 * 60 * 1000;

(async () => {
  try {
    await aggregator.ensureReady();
    // Prime the stream index (so /channel resolves before the first M3U fetch),
    // then build the EPG.
    aggregator
      .listM3uEntries()
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
  } catch (e) {
    console.error(`startup: bootstrap failed: ${e.message}`);
  }
  app.listen(PORT, () => {
    const advertised = PUBLIC_BASE_URL || `http://0.0.0.0:${PORT}`;
    console.log(`Server listening on :${PORT} (public base: ${advertised})`);
  });
})();
