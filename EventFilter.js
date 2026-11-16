const { SPORTS, normalizeLabel, hasTerm, sportFromLabel } = require('./sports');
const { canonicalLeague } = require('./eventLogos');

// EVENT_FILTER entries that name a competition or discipline rather than a
// whole sport. `terms` are matched as whole words against the event's league,
// category and name. Extend this when /debug/dropped shows a labeling gap.
const ALIASES = {
  boxing: {
    sport: 'combat',
    terms: [
      'boxing',
      'matchroom',
      'top rank',
      'queensberry',
      'dazn',
      'golden boy',
      'pbc',
      'premier boxing champions',
    ],
  },
  ufc: {
    sport: 'combat',
    terms: ['ufc', 'ufc fight night', 'mma', 'pfl', 'bellator', 'one championship'],
  },
  wrestling: {
    sport: 'combat',
    terms: ['wrestling', 'wwe', 'aew', 'raw', 'smackdown', 'nxt', 'tna'],
  },
  nfl: { sport: 'american-football', terms: ['nfl', 'redzone', 'red zone', 'american football'] },
  ncaaf: {
    sport: 'american-football',
    terms: ['ncaaf', 'college football', 'ncaa football', 'cfb'],
  },
  nba: { sport: 'basketball', terms: ['nba'] },
  wnba: { sport: 'basketball', terms: ['wnba'] },
  ncaab: {
    sport: 'basketball',
    terms: ['ncaab', 'college basketball', 'ncaa basketball', 'march madness'],
  },
  nhl: { sport: 'hockey', terms: ['nhl'] },
  mlb: { sport: 'baseball', terms: ['mlb'] },
  f1: { sport: 'motorsport', terms: ['f1', 'formula 1', 'formula one'] },
  nascar: { sport: 'motorsport', terms: ['nascar'] },
  epl: { sport: 'soccer', terms: ['epl', 'premier league', 'english premier league'] },
  mls: { sport: 'soccer', terms: ['mls', 'major league soccer'] },
  ucl: { sport: 'soccer', terms: ['ucl', 'champions league'] },
};
ALIASES.mma = ALIASES.ufc;
ALIASES.wwe = ALIASES.wrestling;
ALIASES['formula 1'] = ALIASES.f1;
ALIASES['premier league'] = ALIASES.epl;
ALIASES['champions league'] = ALIASES.ucl;

// Entries that mean a whole sport.
const SPORT_ENTRIES = {
  'american football': 'american-football',
  basketball: 'basketball',
  hockey: 'hockey',
  'ice hockey': 'hockey',
  baseball: 'baseball',
  soccer: 'soccer',
  combat: 'combat',
  'combat sports': 'combat',
  fighting: 'combat',
  motorsport: 'motorsport',
  motorsports: 'motorsport',
  racing: 'motorsport',
  tennis: 'tennis',
  cricket: 'cricket',
  golf: 'golf',
  rugby: 'rugby',
  darts: 'darts',
  other: 'other',
};
for (const s of SPORTS) SPORT_ENTRIES[normalizeLabel(s).trim()] = s;

// League/category labels that name only a sport, not a competition: "Soccer",
// "Fight", "PPV". An event labeled this way could belong to any competition
// in its sport, so a competition entry keeps it rather than guess wrong.
// Dropping a boxing card a source filed as "combat" is the failure the
// filter must not have.
const GENERIC_LABELS = new Set([
  ...Object.keys(SPORT_ENTRIES),
  'football',
  'am football',
  'fight',
  'fights',
  'ppv',
  'pay per view',
  'events',
  'sports',
  'live',
]);

function isGeneric(label) {
  const n = normalizeLabel(label).trim();
  return !n || GENERIC_LABELS.has(n);
}

function compileEntry(raw) {
  const key = normalizeLabel(raw).trim();
  if (!key) return null;
  if (SPORT_ENTRIES[key]) return { raw, kind: 'sport', sport: SPORT_ENTRIES[key] };
  const alias = ALIASES[key];
  return {
    raw,
    kind: 'competition',
    sport: alias ? alias.sport : sportFromLabel(key),
    terms: alias ? alias.terms : [key],
    league: canonicalLeague(String(raw)),
  };
}

// Competition entries of the same sport, so an ambiguous event can be checked
// for a label that places it in a different one.
function siblingTerms(entry) {
  const out = new Set();
  for (const a of new Set(Object.values(ALIASES))) {
    if (a.sport === entry.sport && a.terms !== entry.terms) a.terms.forEach(t => out.add(t));
  }
  return [...out];
}

function matchesEntry(entry, ev, labels) {
  if (entry.kind === 'sport') return ev.sport === entry.sport;
  if (entry.terms.some(t => labels.some(l => hasTerm(l, t)))) return true;
  if (entry.league && canonicalLeague(ev.league || '') === entry.league) return true;
  // Same sport, but the source only said which sport: keep it unless its
  // name points at another competition of that sport ("UFC 320" under Boxing).
  if (entry.sport && ev.sport === entry.sport && isGeneric(ev.league) && isGeneric(ev.category)) {
    const name = normalizeLabel(ev.name);
    return !entry.siblings.some(t => hasTerm(name, t));
  }
  return false;
}

// Returns null when `raw` is empty (keep everything), else a filter with
// keep(ev) for events carrying { sport, league, category?, name }.
function createEventFilter(raw) {
  const entries = String(raw || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(compileEntry)
    .filter(Boolean);
  if (entries.length === 0) return null;
  for (const e of entries) if (e.kind === 'competition') e.siblings = siblingTerms(e);
  return {
    entries: entries.map(e => e.raw),
    keep(ev) {
      const labels = [ev.league, ev.category, ev.name].map(normalizeLabel).filter(Boolean);
      return entries.some(e => matchesEntry(e, ev, labels));
    },
  };
}

module.exports = { createEventFilter, ALIASES };
