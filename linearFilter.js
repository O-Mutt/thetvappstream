const { networkKey } = require('./networkKey');

// Words that name a regional edition of a network rather than the network.
// networkKey already drops the US markers, so a key without one of these is
// the US (or, for UK-native brands like Sky Sports, home-market) feed.
const MARKETS = new Set([
  'uk',
  'nl',
  'mx',
  'br',
  'brasil',
  'brazil',
  'ar',
  'argentina',
  'au',
  'nz',
  'de',
  'it',
  'italy',
  'es',
  'spain',
  'fr',
  'france',
  'pt',
  'portugal',
  'ca',
  'canada',
  'chile',
  'za',
  'india',
  'mena',
  'arabic',
  'turkey',
  'malaysia',
  'qatar',
  'nordic',
  'poland',
]);

function split(key) {
  const words = key.split('-');
  return {
    base: words.filter(w => !MARKETS.has(w)),
    markets: new Set(words.filter(w => MARKETS.has(w))),
  };
}

// LINEAR_FILTER: which 24/7 networks to keep. Entries are matched by network
// key, the same key that merges a network across providers, so "ESPN USA",
// "ESPN" and "espn" are one entry.
//
// An entry keeps its family: every network whose words start with the
// entry's, as whole words, in a market the entry names. "ESPN" keeps ESPN,
// ESPN 2 and ESPN Deportes, but not ESPN 2 NL; "ESPN MX" keeps the Mexican
// feeds; "Sky Sports" keeps the UK channels but not Sky Sports F1 DE. ESPNU
// and ESPNews are one word and are listed on their own. "=ESPN" keeps exactly
// one network.
//
// Returns null when `raw` is empty (keep everything), else { entries,
// keep(key) }.
function createLinearFilter(raw) {
  const entries = String(raw || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      const exact = s.startsWith('=');
      const key = networkKey(exact ? s.slice(1) : s);
      return key ? { raw: s, key, exact, ...split(key) } : null;
    })
    .filter(Boolean);
  if (entries.length === 0) return null;

  const inFamily = (e, key) => {
    const k = split(key);
    if (![...k.markets].every(m => e.markets.has(m))) return false;
    if (k.base.length < e.base.length) return false;
    return e.base.every((w, i) => k.base[i] === w);
  };
  return {
    entries: entries.map(e => e.raw),
    keep(key) {
      return entries.some(e => key === e.key || (!e.exact && inFamily(e, key)));
    },
  };
}

module.exports = { createLinearFilter, MARKETS };
