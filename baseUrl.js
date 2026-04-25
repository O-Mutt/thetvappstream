// Resolve the public-facing base URL for outbound links emitted in /channels.m3u.
// PUBLIC_BASE_URL takes precedence; otherwise fall back to the inbound request's
// scheme+host (which honors X-Forwarded-* when the app has trust proxy enabled).
function baseUrlFor(req, override) {
  if (override) return String(override).replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

module.exports = { baseUrlFor };
