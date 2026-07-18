const espn = (league, key) => `https://a.espncdn.com/i/teamlogos/${league}/500/${key}.png`;
const espnLeague = key => `https://a.espncdn.com/i/teamlogos/leagues/500/${key}.png`;
const { NCAA_FOOTBALL, NCAA_BASKETBALL } = require('./ncaaLogos');

const LEAGUE_LOGOS = {
  MLB: espnLeague('mlb'),
  NHL: espnLeague('nhl'),
  NFL: espnLeague('nfl'),
  NBA: espnLeague('nba'),
  WNBA: espnLeague('wnba'),
  Soccer: espnLeague('mls'),
  'FIFA World Cup': espnLeague('fifa'),
  'FIFA World Cup 2026': espnLeague('fifa'),
  NCAAF: espnLeague('ncaaf'),
  NCAAB: espnLeague('ncaab'),
  Tennis: espnLeague('atp'),
  Golf: espnLeague('pga'),
  Motorsport: espnLeague('f1'),
  MMA: espnLeague('ufc'),
  Boxing: espnLeague('boxing'),
  Rugby: espnLeague('rugby'),
  Cricket: espnLeague('cricket'),
  AFL: espnLeague('afl'),
};

// Substring keys checked against the matchup string. First hit wins, and the
// matched key is also used to look up a logo in TEAM_LOGOS for that league.
// Order matters where entries overlap (e.g., NCAA generic "Minnesota").
const PREFERRED_TEAMS = {
  MLB: ['Minnesota Twins'],
  NHL: ['Minnesota Wild'],
  NFL: ['Minnesota Vikings'],
  NBA: ['Minnesota Timberwolves'],
  WNBA: ['Minnesota Lynx'],
  NCAAF: ['Minnesota', 'Michigan'],
  NCAAB: ['Minnesota', 'Michigan'],
  Soccer: ['Minnesota United'],
};

const TEAM_LOGOS = {
  MLB: {
    'Arizona Diamondbacks': espn('mlb', 'ari'),
    'Atlanta Braves': espn('mlb', 'atl'),
    'Baltimore Orioles': espn('mlb', 'bal'),
    'Boston Red Sox': espn('mlb', 'bos'),
    'Chicago Cubs': espn('mlb', 'chc'),
    'Chicago White Sox': espn('mlb', 'chw'),
    'Cincinnati Reds': espn('mlb', 'cin'),
    'Cleveland Guardians': espn('mlb', 'cle'),
    'Colorado Rockies': espn('mlb', 'col'),
    'Detroit Tigers': espn('mlb', 'det'),
    'Houston Astros': espn('mlb', 'hou'),
    'Kansas City Royals': espn('mlb', 'kc'),
    'Los Angeles Angels': espn('mlb', 'laa'),
    'Los Angeles Dodgers': espn('mlb', 'lad'),
    'Miami Marlins': espn('mlb', 'mia'),
    'Milwaukee Brewers': espn('mlb', 'mil'),
    'Minnesota Twins': espn('mlb', 'min'),
    'New York Mets': espn('mlb', 'nym'),
    'New York Yankees': espn('mlb', 'nyy'),
    Athletics: espn('mlb', 'oak'),
    'Philadelphia Phillies': espn('mlb', 'phi'),
    'Pittsburgh Pirates': espn('mlb', 'pit'),
    'San Diego Padres': espn('mlb', 'sd'),
    'Seattle Mariners': espn('mlb', 'sea'),
    'San Francisco Giants': espn('mlb', 'sf'),
    'St. Louis Cardinals': espn('mlb', 'stl'),
    'Tampa Bay Rays': espn('mlb', 'tb'),
    'Texas Rangers': espn('mlb', 'tex'),
    'Toronto Blue Jays': espn('mlb', 'tor'),
    'Washington Nationals': espn('mlb', 'wsh'),
  },
  NHL: {
    'Anaheim Ducks': espn('nhl', 'ana'),
    'Boston Bruins': espn('nhl', 'bos'),
    'Buffalo Sabres': espn('nhl', 'buf'),
    'Calgary Flames': espn('nhl', 'cgy'),
    'Carolina Hurricanes': espn('nhl', 'car'),
    'Chicago Blackhawks': espn('nhl', 'chi'),
    'Colorado Avalanche': espn('nhl', 'col'),
    'Columbus Blue Jackets': espn('nhl', 'cbj'),
    'Dallas Stars': espn('nhl', 'dal'),
    'Detroit Red Wings': espn('nhl', 'det'),
    'Edmonton Oilers': espn('nhl', 'edm'),
    'Florida Panthers': espn('nhl', 'fla'),
    'Los Angeles Kings': espn('nhl', 'la'),
    'Minnesota Wild': espn('nhl', 'min'),
    'Montreal Canadiens': espn('nhl', 'mtl'),
    'Nashville Predators': espn('nhl', 'nsh'),
    'New Jersey Devils': espn('nhl', 'nj'),
    'New York Islanders': espn('nhl', 'nyi'),
    'New York Rangers': espn('nhl', 'nyr'),
    'Ottawa Senators': espn('nhl', 'ott'),
    'Philadelphia Flyers': espn('nhl', 'phi'),
    'Pittsburgh Penguins': espn('nhl', 'pit'),
    'San Jose Sharks': espn('nhl', 'sj'),
    'Seattle Kraken': espn('nhl', 'sea'),
    'St. Louis Blues': espn('nhl', 'stl'),
    'Tampa Bay Lightning': espn('nhl', 'tb'),
    'Toronto Maple Leafs': espn('nhl', 'tor'),
    'Utah Hockey Club': espn('nhl', 'utah'),
    'Vancouver Canucks': espn('nhl', 'van'),
    'Vegas Golden Knights': espn('nhl', 'vgk'),
    'Washington Capitals': espn('nhl', 'wsh'),
    'Winnipeg Jets': espn('nhl', 'wpg'),
  },
  NFL: {
    'Arizona Cardinals': espn('nfl', 'ari'),
    'Atlanta Falcons': espn('nfl', 'atl'),
    'Baltimore Ravens': espn('nfl', 'bal'),
    'Buffalo Bills': espn('nfl', 'buf'),
    'Carolina Panthers': espn('nfl', 'car'),
    'Chicago Bears': espn('nfl', 'chi'),
    'Cincinnati Bengals': espn('nfl', 'cin'),
    'Cleveland Browns': espn('nfl', 'cle'),
    'Dallas Cowboys': espn('nfl', 'dal'),
    'Denver Broncos': espn('nfl', 'den'),
    'Detroit Lions': espn('nfl', 'det'),
    'Green Bay Packers': espn('nfl', 'gb'),
    'Houston Texans': espn('nfl', 'hou'),
    'Indianapolis Colts': espn('nfl', 'ind'),
    'Jacksonville Jaguars': espn('nfl', 'jax'),
    'Kansas City Chiefs': espn('nfl', 'kc'),
    'Las Vegas Raiders': espn('nfl', 'lv'),
    'Los Angeles Chargers': espn('nfl', 'lac'),
    'Los Angeles Rams': espn('nfl', 'lar'),
    'Miami Dolphins': espn('nfl', 'mia'),
    'Minnesota Vikings': espn('nfl', 'min'),
    'New England Patriots': espn('nfl', 'ne'),
    'New Orleans Saints': espn('nfl', 'no'),
    'New York Giants': espn('nfl', 'nyg'),
    'New York Jets': espn('nfl', 'nyj'),
    'Philadelphia Eagles': espn('nfl', 'phi'),
    'Pittsburgh Steelers': espn('nfl', 'pit'),
    'San Francisco 49ers': espn('nfl', 'sf'),
    'Seattle Seahawks': espn('nfl', 'sea'),
    'Tampa Bay Buccaneers': espn('nfl', 'tb'),
    'Tennessee Titans': espn('nfl', 'ten'),
    'Washington Commanders': espn('nfl', 'wsh'),
  },
  NBA: {
    'Atlanta Hawks': espn('nba', 'atl'),
    'Boston Celtics': espn('nba', 'bos'),
    'Brooklyn Nets': espn('nba', 'bkn'),
    'Charlotte Hornets': espn('nba', 'cha'),
    'Chicago Bulls': espn('nba', 'chi'),
    'Cleveland Cavaliers': espn('nba', 'cle'),
    'Dallas Mavericks': espn('nba', 'dal'),
    'Denver Nuggets': espn('nba', 'den'),
    'Detroit Pistons': espn('nba', 'det'),
    'Golden State Warriors': espn('nba', 'gs'),
    'Houston Rockets': espn('nba', 'hou'),
    'Indiana Pacers': espn('nba', 'ind'),
    'LA Clippers': espn('nba', 'lac'),
    'Los Angeles Clippers': espn('nba', 'lac'),
    'Los Angeles Lakers': espn('nba', 'lal'),
    'Memphis Grizzlies': espn('nba', 'mem'),
    'Miami Heat': espn('nba', 'mia'),
    'Milwaukee Bucks': espn('nba', 'mil'),
    'Minnesota Timberwolves': espn('nba', 'min'),
    'New Orleans Pelicans': espn('nba', 'no'),
    'New York Knicks': espn('nba', 'ny'),
    'Oklahoma City Thunder': espn('nba', 'okc'),
    'Orlando Magic': espn('nba', 'orl'),
    'Philadelphia 76ers': espn('nba', 'phi'),
    'Phoenix Suns': espn('nba', 'phx'),
    'Portland Trail Blazers': espn('nba', 'por'),
    'Sacramento Kings': espn('nba', 'sac'),
    'San Antonio Spurs': espn('nba', 'sas'),
    'Toronto Raptors': espn('nba', 'tor'),
    'Utah Jazz': espn('nba', 'utah'),
    'Washington Wizards': espn('nba', 'wsh'),
  },
  WNBA: {
    'Atlanta Dream': espn('wnba', 'atl'),
    'Chicago Sky': espn('wnba', 'chi'),
    'Connecticut Sun': espn('wnba', 'con'),
    'Dallas Wings': espn('wnba', 'dal'),
    'Indiana Fever': espn('wnba', 'ind'),
    'Las Vegas Aces': espn('wnba', 'lv'),
    'Los Angeles Sparks': espn('wnba', 'la'),
    'Minnesota Lynx': espn('wnba', 'min'),
    'New York Liberty': espn('wnba', 'ny'),
    'Phoenix Mercury': espn('wnba', 'phx'),
    'Portland Fire': espn('wnba', 'por'),
    'Seattle Storm': espn('wnba', 'sea'),
    'Toronto Tempo': espn('wnba', 'tor'),
    'Golden State Valkyries': espn('wnba', 'gsv'),
    'Washington Mystics': espn('wnba', 'wsh'),
  },
  // ESPN soccer namespace uses numeric IDs.
  Soccer: {
    'Atlanta United FC': espn('soccer', '18418'),
    'Austin FC': espn('soccer', '20906'),
    'CF Montréal': espn('soccer', '9720'),
    'CF Montreal': espn('soccer', '9720'),
    'Charlotte FC': espn('soccer', '21300'),
    'Chicago Fire FC': espn('soccer', '182'),
    'Colorado Rapids': espn('soccer', '184'),
    'Columbus Crew': espn('soccer', '183'),
    'D.C. United': espn('soccer', '193'),
    'DC United': espn('soccer', '193'),
    'FC Cincinnati': espn('soccer', '18267'),
    'FC Dallas': espn('soccer', '185'),
    'Houston Dynamo FC': espn('soccer', '6077'),
    'Inter Miami CF': espn('soccer', '20232'),
    'LA Galaxy': espn('soccer', '187'),
    'Los Angeles FC': espn('soccer', '18966'),
    LAFC: espn('soccer', '18966'),
    'Minnesota United': espn('soccer', '17362'),
    'Nashville SC': espn('soccer', '18986'),
    'New England Revolution': espn('soccer', '189'),
    'New York City FC': espn('soccer', '17606'),
    'New York Red Bulls': espn('soccer', '190'),
    'Orlando City SC': espn('soccer', '12011'),
    'Philadelphia Union': espn('soccer', '10739'),
    'Portland Timbers': espn('soccer', '9723'),
    'Real Salt Lake': espn('soccer', '4771'),
    'San Diego FC': espn('soccer', '22529'),
    'San Jose Earthquakes': espn('soccer', '191'),
    'Seattle Sounders FC': espn('soccer', '9726'),
    'Sporting Kansas City': espn('soccer', '186'),
    'St. Louis City SC': espn('soccer', '21812'),
    'Toronto FC': espn('soccer', '7318'),
    'Vancouver Whitecaps FC': espn('soccer', '9727'),
  },
  NCAAF: NCAA_FOOTBALL,
  NCAAB: NCAA_BASKETBALL,
  // FIFA World Cup national team ESPN soccer IDs sourced from ESPN API.
  // Keys match both FIFA standard names and DaddyLive display variants.
  'FIFA World Cup': {
    Algeria: espn('soccer', '624'),
    Argentina: espn('soccer', '202'),
    Australia: espn('soccer', '628'),
    Austria: espn('soccer', '474'),
    Belgium: espn('soccer', '459'),
    Bosnia: espn('soccer', '452'),
    'Bosnia and Herzegovina': espn('soccer', '452'),
    Brazil: espn('soccer', '205'),
    Canada: espn('soccer', '206'),
    'Cape Verde': espn('soccer', '2597'),
    Colombia: espn('soccer', '208'),
    'Congo DR': espn('soccer', '2850'),
    'DR Congo': espn('soccer', '2850'),
    Croatia: espn('soccer', '477'),
    "Côte d'Ivoire": espn('soccer', '4789'),
    Czechia: espn('soccer', '450'),
    'Czech Republic': espn('soccer', '450'),
    Ecuador: espn('soccer', '209'),
    Egypt: espn('soccer', '2620'),
    England: espn('soccer', '448'),
    France: espn('soccer', '478'),
    Germany: espn('soccer', '481'),
    Ghana: espn('soccer', '4469'),
    Haiti: espn('soccer', '2654'),
    Iran: espn('soccer', '469'),
    Iraq: espn('soccer', '4375'),
    'Ivory Coast': espn('soccer', '4789'),
    Japan: espn('soccer', '627'),
    Jordan: espn('soccer', '2917'),
    'Korea Republic': espn('soccer', '451'),
    'South Korea': espn('soccer', '451'),
    Mexico: espn('soccer', '203'),
    Morocco: espn('soccer', '2869'),
    Netherlands: espn('soccer', '449'),
    'New Zealand': espn('soccer', '2666'),
    Norway: espn('soccer', '464'),
    Panama: espn('soccer', '2659'),
    Paraguay: espn('soccer', '210'),
    Portugal: espn('soccer', '482'),
    Qatar: espn('soccer', '4398'),
    'Saudi Arabia': espn('soccer', '655'),
    Scotland: espn('soccer', '580'),
    Senegal: espn('soccer', '654'),
    'South Africa': espn('soccer', '467'),
    Spain: espn('soccer', '164'),
    Sweden: espn('soccer', '466'),
    Switzerland: espn('soccer', '475'),
    Tunisia: espn('soccer', '659'),
    Turkey: espn('soccer', '465'),
    Türkiye: espn('soccer', '465'),
    'United States': espn('soccer', '660'),
    Uruguay: espn('soccer', '212'),
    USA: espn('soccer', '660'),
    Uzbekistan: espn('soccer', '2570'),
    Curaçao: espn('soccer', '11678'),
  },
};

TEAM_LOGOS['FIFA World Cup 2026'] = TEAM_LOGOS['FIFA World Cup'];

function parseMatchupTeams(name) {
  if (typeof name !== 'string') return null;
  const parts = name.split(/\s+vs\.?\s+/i);
  if (parts.length !== 2) return null;
  const teamA = parts[0].trim();
  // Strip the trailing " @ Apr 28 6:10 PM" date stamp from the second team.
  const teamB = parts[1].split(/\s+@\s+/)[0].trim();
  if (!teamA || !teamB) return null;
  return [teamA, teamB];
}

function findLogoBySubstring(haystack, teamMap) {
  if (!teamMap || typeof haystack !== 'string') return null;
  // Longest keys first so "Minnesota Twins" beats "Minnesota" if both are
  // present in the same map.
  const keys = Object.keys(teamMap).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (haystack.includes(k)) return teamMap[k];
  }
  return null;
}

// The upstream source periodically decorates league group-titles with emoji and
// suffixes ("MLB" -> "⚾ MLB", "NHL" -> "🏒 NHL", bare "Soccer" -> "NWSL Soccer
// ⚽"). Our logo tables are keyed by the bare league, so an exact lookup blanks
// every banner after such a rename. Resolve a raw league/group string to a
// canonical table key by matching a known league name as a whole word/phrase in
// the normalized string. Returns null when no known league is present -- callers
// then fall back to no icon, exactly as before.
const CANON_LEAGUES = [...new Set([...Object.keys(LEAGUE_LOGOS), ...Object.keys(TEAM_LOGOS)])];
function normLeague(s) {
  return String(s)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}
function canonicalLeague(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  if (TEAM_LOGOS[raw] || LEAGUE_LOGOS[raw]) return raw; // already canonical
  const hay = ` ${normLeague(raw)} `;
  // Longest canonical names first so "FIFA World Cup 2026" wins over "FIFA World
  // Cup", and multi-word keys beat single tokens.
  const keys = CANON_LEAGUES.slice().sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const needle = normLeague(key);
    if (needle && hay.includes(` ${needle} `)) return key;
  }
  return null;
}

function pickMatchupLogos({ league, name } = {}) {
  league = canonicalLeague(league);
  if (!league) return null;
  const teamMap = TEAM_LOGOS[league];
  if (!teamMap) return null;
  const teams = parseMatchupTeams(name);
  if (!teams) return null;
  const awayLogo = findLogoBySubstring(teams[0], teamMap);
  const homeLogo = findLogoBySubstring(teams[1], teamMap);
  if (!awayLogo || !homeLogo) return null;
  return { away: awayLogo, home: homeLogo };
}

function pickEventLogo({ league, name } = {}) {
  league = canonicalLeague(league);
  if (!league) return null;
  const teamMap = TEAM_LOGOS[league];
  const preferred = PREFERRED_TEAMS[league];

  if (preferred && teamMap && typeof name === 'string') {
    for (const pref of preferred) {
      if (name.includes(pref) && teamMap[pref]) return teamMap[pref];
    }
  }

  const teams = parseMatchupTeams(name);
  if (teams) {
    const awayLogo = findLogoBySubstring(teams[0], teamMap);
    if (awayLogo) return awayLogo;
  }

  return LEAGUE_LOGOS[league] || null;
}

module.exports = {
  LEAGUE_LOGOS,
  TEAM_LOGOS,
  PREFERRED_TEAMS,
  parseMatchupTeams,
  canonicalLeague,
  pickEventLogo,
  pickMatchupLogos,
};
