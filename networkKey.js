// One key per TV network, so the same channel from two providers becomes one
// linear channel with both as sources. "ESPN USA", "ESPN HD" and "espn" all
// key to "espn"; "ESPN 2 NL" stays its own channel. Bracketed text is kept as
// words, because it often names the feed: "18+ (Player-07)", "(East)".

// Quality (plus any "720p"-style height) and US-market markers that only
// decorate the name. US is the
// audience this app serves, so a bare name means the US feed.
const DECORATION = new Set(['hd', 'fhd', 'uhd', '4k', 'sd', 'hevc', 'us', 'usa']);

// Known spellings of the same network, after normalization.
const ALIASES = {
  'nfl net': 'nfl network',
  nflnetwork: 'nfl network',
  redzone: 'nfl redzone',
  'red zone': 'nfl redzone',
  'nfl red zone': 'nfl redzone',
  fs1: 'fox sports 1',
  fs2: 'fox sports 2',
  nbatv: 'nba tv',
  mlbn: 'mlb network',
  cbssn: 'cbs sports network',
  'cbs sports network cbssn': 'cbs sports network',
  'willow cricket': 'willow',
  'willow 2 cricket': 'willow 2',
  'sky sports plus plus': 'sky sports plus',
};

// Sky Sports is a UK brand: its UK channels appear both with and without the
// suffix ("Sky Sports F1 UK", "Sky Sports Cricket"), while the German and
// Italian ones always carry theirs.
const SKY_UK_RE = /^sky sports (.+) uk$/;

const COMBINING_MARKS_RE = /\p{M}/gu;

function networkKey(name) {
  let s = String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(COMBINING_MARKS_RE, '')
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9]+/g, ' ')
    // "ESPN2" and "ESPN 2" are the same channel. Short prefixes stay joined,
    // so "F1" and "FS1" keep their usual spelling.
    .replace(/([a-z]{3,})(\d)/g, '$1 $2')
    .trim();
  const tokens = s ? s.split(' ') : [];
  const isDecoration = t => DECORATION.has(t) || /^\d{3,4}p$/.test(t);
  while (tokens.length && isDecoration(tokens[tokens.length - 1])) tokens.pop();
  // IPTV lists prefix the market: "US: ESPN", "USA | ESPN".
  while (tokens.length > 1 && (tokens[0] === 'us' || tokens[0] === 'usa')) tokens.shift();
  s = tokens.join(' ');
  const sky = SKY_UK_RE.exec(s);
  if (sky) s = `sky sports ${sky[1]}`;
  s = ALIASES[s] || s;
  return s.replace(/ /g, '-');
}

module.exports = { networkKey, ALIASES };
