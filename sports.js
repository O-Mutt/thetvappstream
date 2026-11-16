// Canonical sport for an event, from whatever labels its source gives it.
// Sources disagree on what a label means (dlhd "Football" is soccer,
// StreamFree "football" is the NFL), so a provider that knows passes an
// override; the table below covers labels that mean the same everywhere.

const SPORTS = [
  'american-football',
  'basketball',
  'hockey',
  'baseball',
  'soccer',
  'combat',
  'motorsport',
  'tennis',
  'cricket',
  'golf',
  'rugby',
  'darts',
  'other',
];

// Checked in order, so the narrower sports come first: "Premier League
// Darts" is darts and "Indian Premier League" is cricket, not soccer.
const SPORT_TERMS = [
  ['darts', ['darts', 'pdc']],
  ['cricket', ['cricket', 'ipl', 'indian premier league', 'big bash', 'test match', 'odi', 't20']],
  ['rugby', ['rugby', 'nrl', 'super rugby', 'six nations', 'premiership rugby']],
  ['golf', ['golf', 'pga', 'lpga', 'liv golf', 'dp world tour', 'ryder cup', 'masters']],
  ['tennis', ['tennis', 'atp', 'wta', 'wimbledon', 'us open tennis', 'roland garros']],
  [
    'motorsport',
    [
      'motorsport',
      'motorsports',
      'racing',
      'f1',
      'formula 1',
      'formula one',
      'nascar',
      'indycar',
      'motogp',
      'wec',
    ],
  ],
  [
    'combat',
    [
      'combat',
      'combat sports',
      'fight',
      'fights',
      'fighting',
      'boxing',
      'mma',
      'ufc',
      'pfl',
      'bellator',
      'kickboxing',
      'wrestling',
      'wwe',
      'aew',
      // Pay-per-view cards on these sites are fights almost without exception.
      'ppv',
      'pay per view',
    ],
  ],
  [
    'american-football',
    [
      'american football',
      'am football',
      'nfl',
      'ncaaf',
      'college football',
      'cfb',
      'cfl',
      'ufl',
      'redzone',
      'red zone',
    ],
  ],
  [
    'basketball',
    ['basketball', 'nba', 'wnba', 'ncaab', 'college basketball', 'euroleague', 'g league'],
  ],
  ['hockey', ['hockey', 'ice hockey', 'nhl', 'pwhl', 'ahl', 'khl']],
  ['baseball', ['baseball', 'mlb', 'npb', 'kbo']],
  [
    'soccer',
    [
      'soccer',
      'mls',
      'nwsl',
      'epl',
      'premier league',
      'la liga',
      'laliga',
      'bundesliga',
      'serie a',
      'ligue 1',
      'eredivisie',
      'champions league',
      'europa league',
      'conference league',
      'nations league',
      'uefa',
      'fifa',
      'world cup',
      'fa cup',
      'efl',
      'concacaf',
      'copa',
      'liga mx',
    ],
  ],
];

// Lowercase, emoji and punctuation removed, padded so term matches are whole
// words: " nba " is found in " nba finals ", not in " wnba ".
function normalizeLabel(s) {
  const t = String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return t ? ` ${t} ` : '';
}

function hasTerm(normalized, term) {
  return !!normalized && normalized.includes(` ${term} `);
}

// The sport a single label names, or null. `overrides` maps a normalized
// label to a sport for this source ({ football: 'soccer' }).
function sportFromLabel(label, overrides = {}) {
  const n = normalizeLabel(label);
  if (!n) return null;
  const exact = overrides[n.trim()];
  if (exact) return exact;
  for (const [sport, terms] of SPORT_TERMS) {
    if (terms.some(t => hasTerm(n, t))) return sport;
  }
  return null;
}

// The event's own sport when its provider set a valid one; otherwise inferred
// from its category, then league, then name.
function inferSport({ sport, category, league, name } = {}) {
  if (SPORTS.includes(sport)) return sport;
  return sportFromLabel(category) || sportFromLabel(league) || sportFromLabel(name) || 'other';
}

module.exports = { SPORTS, SPORT_TERMS, normalizeLabel, hasTerm, sportFromLabel, inferSport };
