const express = require('express');
const { getChannelLogos } = require('./utils');
const ChannelManager = require('./ChannelManager');
const { PORT, PUBLIC_BASE_URL } = require('./config');

const app = express();
// Honor X-Forwarded-Proto / X-Forwarded-Host so req.protocol + req.get('host')
// reflect the public-facing URL when behind a reverse proxy (swag/nginx/etc).
app.set('trust proxy', true);

const channelManager = new ChannelManager();

function baseUrlFor(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

app.get('/channels.m3u', async (req, res) => {
  try {
    const channels = await channelManager.listChannels();
    const channelLogos = await getChannelLogos();
    const base = baseUrlFor(req);
    let m3u = '#EXTM3U';
    Object.entries(channels).forEach(([name, chid], i) => {
      const logo = channelLogos.channels.find(c => c.name === name)?.logo || '';
      m3u +=
        `\n#EXTINF:-1 tvg-id="${chid}" tvg-chno="${i + 1}" tvg-logo="${logo}", ${name}` +
        `\n${base}/channel/${chid}`;
    });
    res.type('audio/x-mpegurl').send(m3u);
  } catch (e) {
    console.error(`/channels.m3u: ${e.message}`);
    res.status(500).send(e.message);
  }
});

app.get('/epg.xml', (_req, res) => {
  const xml = channelManager.getEpgXml();
  if (!xml) {
    res.status(503).type('text/plain').send('EPG not yet built; try again shortly.');
    return;
  }
  res.type('application/xml').send(xml);
});

app.get('/channel/:chid', async (req, res) => {
  try {
    const streamUrl = await channelManager.getStream(req.params.chid);
    res.redirect(streamUrl);
  } catch (e) {
    console.error(`/channel/${req.params.chid}: ${e.message}`);
    res.status(404).send('Channel does not exist, or is blocked.');
  }
});

app.get('/healthz', (_req, res) => {
  res.type('text/plain').send('ok');
});

const EPG_REFRESH_MS = 6 * 60 * 60 * 1000;

(async () => {
  try {
    await channelManager.ensureSession();
    // Warm the channel list (~118 channels), then build the EPG once it's ready.
    channelManager
      .listChannels()
      .then(() => channelManager.refreshEpg())
      .catch(e => console.error(`startup warmup: ${e.message}`));
    setInterval(() => {
      channelManager.refreshEpg().catch(e => console.error(`epg refresh: ${e.message}`));
    }, EPG_REFRESH_MS);
  } catch (e) {
    console.error(`startup: session bootstrap failed: ${e.message}`);
  }
  app.listen(PORT, () => {
    const advertised = PUBLIC_BASE_URL || `http://0.0.0.0:${PORT}`;
    console.log(`Server listening on :${PORT} (public base: ${advertised})`);
  });
})();
