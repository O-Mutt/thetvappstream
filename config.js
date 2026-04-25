const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  PORT: process.env.PORT || 5000,
  TV_URL: process.env.TV_URL || 'https://thetvapp.to',
  // Optional. When set, the M3U playlist emits channel URLs prefixed with this
  // value (e.g. https://thetvapp-proxy.example.com). When unset, the prefix is
  // derived from the request's Host/X-Forwarded-* headers, which works as long
  // as the M3U is fetched at a URL that downstream players can also reach.
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || '',
};
