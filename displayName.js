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

// Match a colon that separates a league from its matchup, i.e. NOT one inside a
// clock time. "MLB: Tigers vs Guardians" splits; "5:40 PM" does not.
const LEAGUE_SEP_RE = /:(?!\d)/;

// Drop a league prefix the source already baked into the event name.
//
// dlhd used to emit "LEAGUE : matchup", which the daddylive parser split apart.
// It now emits "LEAGUE: matchup" (no space before the colon), so the split stops
// firing and the league survives inside the matchup — then the guide title
// prepends it again and Plex shows "MLB: MLB: Detroit Tigers vs Cleveland
// Guardians". Soccer doubles the same way via "Europe - UEFA Europa League:".
//
// Deliberately narrow: only strips when the prefix IS the league. dlhd event
// strings carry plenty of colons that are not separators at all ("90 Day: The
// Last Resort", "Restaurant Impossible: Last Call"), and tournament prefixes
// that differ from the league ("ATP Cincinnati:" under a Tennis category) are
// worth keeping, so anything that doesn't match is left alone.
//
// Matching is on token runs, not exact strings, because the two sides reach us
// by different routes and rarely agree verbatim: the prefix comes from the event
// title ("Europe - UEFA Conference League") while the league comes from the
// category, canonicalised ("UEFA Conference League"). Either may carry the extra
// qualifier, so containment is checked both ways.
function tokens(s) {
  return stripEmoji(s)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function containsRun(haystack, needle) {
  if (!needle.length || needle.length > haystack.length) return false;
  return haystack.some(
    (_, i) =>
      i + needle.length <= haystack.length && needle.every((tok, j) => haystack[i + j] === tok),
  );
}

function stripLeaguePrefix(name, league) {
  const str = String(name ?? '').trim();
  const lTok = tokens(league);
  if (!lTok.length) return str;

  const idx = str.search(LEAGUE_SEP_RE);
  if (idx > 0) {
    const prefix = str.slice(0, idx).trim();
    const rest = str.slice(idx + 1).trim();
    const pTok = tokens(prefix);
    if (rest && pTok.length) {
      const canonP = canonicalLeague(prefix);
      const sameLeague =
        containsRun(pTok, lTok) ||
        containsRun(lTok, pTok) ||
        (canonP && canonP === canonicalLeague(league));
      if (sameLeague) return rest;
    }
    return str;
  }

  // Some categories repeat the league as a bare leading word with no separator
  // at all ("Tennis" + "Tennis ATP Cincinnati" -> "Tennis: Tennis ATP ..."), so
  // drop a leading run too. Requires a couple of tokens left over, so a name
  // that is only the league survives rather than being emptied out.
  const words = str.split(/\s+/);
  if (words.length > lTok.length + 1 && containsRun(tokens(words.slice(0, lTok.length)), lTok)) {
    return words.slice(lTok.length).join(' ');
  }
  return str;
}

module.exports = { stripEmoji, normalizeLeagueLabel, normalizeEventName, stripLeaguePrefix };
