// Cross-provider event identity. The same game carried by two sources must
// collapse to one M3U channel, so identity is derived from the normalized team
// set + league + date rather than any provider's URL slug or naming.
//
// Display names are NOT touched here: the Dispatcharr scheduler parses the
// "@ <time>" suffix out of the channel name to schedule recordings, so only the
// dedup KEY/id is normalized. Team aliasing (e.g. "Min Twins" -> "Minnesota
// Twins") lives in TEAM_ALIASES and is filled in as real source mismatches show
// up; with one provider it never triggers.
const TEAM_ALIASES = {};

const SPLIT_RE = /\bvs\.?\b|\bv\.?\b|\bat\b|@/i;

function stripTime(name) {
  // "Team A vs Team B @ Apr 25 3:00 PM" -> "Team A vs Team B"
  return String(name || '')
    .split('@')[0]
    .replace(/\s+/g, ' ')
    .trim();
}

function normToken(s) {
  const k = String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return TEAM_ALIASES[k] || k;
}

function teamSet(name) {
  return stripTime(name).split(SPLIT_RE).map(normToken).filter(Boolean).sort();
}

function dateBucket(startSec) {
  const d = new Date(startSec * 1000);
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`;
}

// Stable identity string for dedup comparisons.
function canonicalKey({ league, name, startSec }) {
  return `${String(league || '').toLowerCase()}|${teamSet(name).join('-')}|${dateBucket(startSec)}`;
}

// URL/XMLTV-safe id used as the M3U tvg-id and stream path. Keeps the historical
// `evt-` prefix so Dispatcharr's orphan-stream pruning (which keys on `evt-*`)
// still recognizes these rows.
function canonicalEventId(ev) {
  const slug = canonicalKey(ev)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `evt-${slug}`;
}

module.exports = {
  TEAM_ALIASES,
  stripTime,
  normToken,
  teamSet,
  dateBucket,
  canonicalKey,
  canonicalEventId,
};
