const dotenv = require('dotenv');
dotenv.config();

function parseBool(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(v).trim());
}

function parsePositiveInt(v, fallback) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

module.exports = {
  PORT: process.env.PORT || 5000,
  TV_URL: process.env.TV_URL || 'https://thetvapp.to',
  // Optional. When set, the M3U playlist emits channel URLs prefixed with this
  // value (e.g. https://thetvapp-proxy.example.com). When unset, the prefix is
  // derived from the request's Host/X-Forwarded-* headers, which works as long
  // as the M3U is fetched at a URL that downstream players can also reach.
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || '',
  // When true, scrape per-game event pages (MLB/NHL/NFL/NBA/NCAAF/NCAAB/Soccer/PPV)
  // and merge them into /channels.m3u and /epg.xml alongside the linear TV channels.
  ENABLE_EVENT_STREAMS: parseBool(process.env.ENABLE_EVENT_STREAMS, true),
  // How often to re-scrape the per-sport listing pages. The chids that back
  // event entries are slot ids reused across the day, so frequent refresh
  // matters more here than for the TV channel cache.
  EVENT_REFRESH_MS: parsePositiveInt(process.env.EVENT_REFRESH_MS, 30 * 60 * 1000),
};
