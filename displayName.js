// Display-string cleanup for source-decorated event data.
//
// DaddyLive decorates its own strings with sport icons and country flags, and
// the flag it picks varies per game: the same league arrives as "⚾ 🇨🇦 MLB" for
// a Blue Jays game and "⚾ 🇺🇸 MLB" for a Mets game. Passed through untouched
// that splits one league into several Dispatcharr channel groups, breaks
// cross-provider dedup (the league is part of the canonical key), and renders a
// guide title nobody can read.
//
// Normalizing here — at the aggregator boundary — keeps providers free to hand
// back whatever the source gave them.
const { canonicalLeague } = require('./eventLogos');

// Pictographs, both halves of a regional-indicator flag, the emoji variation
// selector, ZWJ, and the tag characters that build subdivision flags (🏴).
// Deliberately property-based so accented Latin survives: "Montréal",
// "Türkiye" and "Curaçao" are live keys in the team-logo tables.
const EMOJI_RE =
  /[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D]|[\u{E0000}-\u{E007F}]/gu;

function stripEmoji(s) {
  return String(s ?? '')
    .replace(EMOJI_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Resolve a decorated league/group label to the bare league name. Known leagues
// go through canonicalLeague ("⚾ 🇺🇸 MLB" -> "MLB", "Tennis 🎾 ATP - Singles" ->
// "Tennis") so they collapse onto one group; everything else just loses its
// decoration ("⚽ 🇺🇦 Ukrainian Premier League" -> "Ukrainian Premier League").
function normalizeLeagueLabel(raw) {
  const canon = canonicalLeague(raw);
  if (canon) return canon;
  const stripped = stripEmoji(raw);
  return stripped || String(raw ?? '').trim();
}

// Clean an event name for display. The "@ <time>" suffix is load-bearing —
// Dispatcharr's team_recordings scheduler parses the start time straight out of
// Channel.name — so it stays.
function normalizeEventName(raw) {
  const stripped = stripEmoji(raw);
  return stripped || String(raw ?? '').trim();
}

module.exports = { stripEmoji, normalizeLeagueLabel, normalizeEventName };
