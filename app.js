const express = require('express');
const { getChannelLogos, getSystemIPAddress } = require('./utils');
const ChannelManager = require('./ChannelManager');
const { PORT } = require('./config');

const app = express();
const IP = getSystemIPAddress();
const VISIBLE_URL = `http://${IP}:${PORT}`;
const channelManager = new ChannelManager();

app.get('/channels.m3u', async (req, res) => {
  try {
    const channels = await channelManager.listChannels();
    const channelLogos = await getChannelLogos();
    let m3u = '#EXTM3U';
    Object.entries(channels).forEach(([name, chid], i) => {
      const logo = channelLogos.channels.find(c => c.name === name)?.logo || '';
      m3u += `\n#EXTINF:-1 tvg-chno="${i + 1}" tvg-logo="${logo}", ${name}\n${VISIBLE_URL}/channel/${chid}`;
    });
    res.type('audio/x-mpegurl').send(m3u);
  } catch (e) {
    console.error(`/channels.m3u: ${e.message}`);
    res.status(500).send(e.message);
  }
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

(async () => {
  try {
    await channelManager.ensureSession();
    // Warm the channel list (one-time scrape ~118 channels in parallel).
    channelManager.listChannels().catch(e => console.error(`channel list warmup: ${e.message}`));
  } catch (e) {
    console.error(`startup: session bootstrap failed: ${e.message}`);
  }
  app.listen(PORT, () => {
    console.log(`Server running on ${VISIBLE_URL}`);
  });
})();
