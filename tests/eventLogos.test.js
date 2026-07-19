const test = require('node:test');
const assert = require('node:assert');
const {
  parseMatchupTeams,
  canonicalLeague,
  pickEventLogo,
  pickMatchupLogos,
  LEAGUE_LOGOS,
  TEAM_LOGOS,
} = require('../eventLogos');

test('parseMatchupTeams pulls both teams and strips trailing date stamp', () => {
  assert.deepStrictEqual(
    parseMatchupTeams('Tampa Bay Rays vs Cleveland Guardians @ Apr 28 6:10 PM'),
    ['Tampa Bay Rays', 'Cleveland Guardians'],
  );
});

test('parseMatchupTeams returns null when "vs" separator is absent', () => {
  assert.strictEqual(parseMatchupTeams('Some single thing happening'), null);
  assert.strictEqual(parseMatchupTeams(''), null);
  assert.strictEqual(parseMatchupTeams(null), null);
});

test('pickEventLogo picks the preferred Minnesota team regardless of vs-side', () => {
  // Twins on the home (right) side
  assert.strictEqual(
    pickEventLogo({ league: 'MLB', name: 'Cleveland Guardians vs Minnesota Twins @ Apr 28' }),
    TEAM_LOGOS.MLB['Minnesota Twins'],
  );
  // Twins on the away (left) side
  assert.strictEqual(
    pickEventLogo({ league: 'MLB', name: 'Minnesota Twins vs Detroit Tigers @ Apr 29' }),
    TEAM_LOGOS.MLB['Minnesota Twins'],
  );
});

test('pickEventLogo NCAA prefers Minnesota when both Minnesota and Michigan are playing', () => {
  assert.strictEqual(
    pickEventLogo({ league: 'NCAAF', name: 'Minnesota vs Michigan @ Nov 1' }),
    TEAM_LOGOS.NCAAF.Minnesota,
  );
  assert.strictEqual(
    pickEventLogo({ league: 'NCAAF', name: 'Michigan vs Minnesota @ Nov 1' }),
    TEAM_LOGOS.NCAAF.Minnesota,
  );
});

test('pickEventLogo NCAA falls back to Michigan when Minnesota is not in the matchup', () => {
  assert.strictEqual(
    pickEventLogo({ league: 'NCAAB', name: 'Michigan vs Ohio State @ Feb 14' }),
    TEAM_LOGOS.NCAAB.Michigan,
  );
});

test('pickEventLogo Soccer prefers Minnesota United', () => {
  assert.strictEqual(
    pickEventLogo({ league: 'Soccer', name: 'LA Galaxy vs Minnesota United @ May 4' }),
    TEAM_LOGOS.Soccer['Minnesota United'],
  );
});

test('pickEventLogo falls back to away team logo when no preferred team present', () => {
  // Yankees (away) is in the map -> Yankees logo
  assert.strictEqual(
    pickEventLogo({ league: 'MLB', name: 'New York Yankees vs Boston Red Sox @ Apr 30' }),
    TEAM_LOGOS.MLB['New York Yankees'],
  );
});

test('pickEventLogo falls back to league logo when away team is unknown', () => {
  // Made-up team that isn't in any map; league logo should win.
  assert.strictEqual(
    pickEventLogo({ league: 'MLB', name: 'Anonymous Team vs Other Anonymous @ Apr 30' }),
    LEAGUE_LOGOS.MLB,
  );
});

test('pickEventLogo returns NCAAF league logo when both teams are FCS (not in the FBS map)', () => {
  // Delaware and Albany are FCS schools — not in the FBS TEAM_LOGOS map.
  assert.strictEqual(
    pickEventLogo({ league: 'NCAAF', name: 'Delaware vs Albany @ Oct 5' }),
    LEAGUE_LOGOS.NCAAF,
  );
});

test('pickEventLogo returns null for leagues with no logo (PPV) and no team match', () => {
  assert.strictEqual(pickEventLogo({ league: 'PPV', name: 'Some Fight @ May 10' }), null);
});

test('pickEventLogo returns null when called with bad input', () => {
  assert.strictEqual(pickEventLogo(), null);
  assert.strictEqual(pickEventLogo({}), null);
  assert.strictEqual(pickEventLogo({ league: 'MLB' }), LEAGUE_LOGOS.MLB);
});

test('pickMatchupLogos returns both team logo URLs when both teams are known', () => {
  const result = pickMatchupLogos({
    league: 'MLB',
    name: 'Minnesota Twins vs Boston Red Sox @ May 22 7:10 PM',
  });
  assert.deepStrictEqual(result, {
    away: TEAM_LOGOS.MLB['Minnesota Twins'],
    home: TEAM_LOGOS.MLB['Boston Red Sox'],
  });
});

test('pickMatchupLogos returns null when either team is unknown', () => {
  assert.strictEqual(
    pickMatchupLogos({ league: 'MLB', name: 'Unknown Team vs Boston Red Sox @ May 22' }),
    null,
  );
  assert.strictEqual(
    pickMatchupLogos({ league: 'MLB', name: 'Minnesota Twins vs Unknown Team @ May 22' }),
    null,
  );
});

test('pickMatchupLogos returns null when name has no vs separator', () => {
  assert.strictEqual(pickMatchupLogos({ league: 'MLB', name: 'Single Event' }), null);
});

test('pickMatchupLogos returns null when league has no team map', () => {
  assert.strictEqual(pickMatchupLogos({ league: 'PPV', name: 'Fighter A vs Fighter B' }), null);
});

test('pickMatchupLogos works for NHL', () => {
  const result = pickMatchupLogos({
    league: 'NHL',
    name: 'Minnesota Wild vs Tampa Bay Lightning @ Apr 10',
  });
  assert.deepStrictEqual(result, {
    away: TEAM_LOGOS.NHL['Minnesota Wild'],
    home: TEAM_LOGOS.NHL['Tampa Bay Lightning'],
  });
});

test('pickMatchupLogos works for FIFA World Cup', () => {
  const result = pickMatchupLogos({
    league: 'FIFA World Cup',
    name: 'Argentina vs France @ Jul 15 10:00 AM',
  });
  assert.deepStrictEqual(result, {
    away: TEAM_LOGOS['FIFA World Cup']['Argentina'],
    home: TEAM_LOGOS['FIFA World Cup']['France'],
  });
});

// Regression: the upstream source renamed league group-titles to add emoji
// (e.g. "MLB" -> "⚾ MLB"), which blanked every banner because the logo tables
// are keyed by the bare league. canonicalLeague normalizes the decorated group
// back to the table key.
test('canonicalLeague normalizes emoji-decorated league group-titles', () => {
  assert.strictEqual(canonicalLeague('⚾ MLB'), 'MLB');
  assert.strictEqual(canonicalLeague('🏒 NHL'), 'NHL');
  assert.strictEqual(canonicalLeague('🏈 NFL'), 'NFL');
  assert.strictEqual(canonicalLeague('🏀 NBA'), 'NBA');
  assert.strictEqual(canonicalLeague('🏀 WNBA'), 'WNBA');
  assert.strictEqual(canonicalLeague('NWSL Soccer ⚽'), 'Soccer');
  assert.strictEqual(canonicalLeague('⚾ MLB Home Run Derby'), 'MLB');
});

test('canonicalLeague passes through already-canonical keys and prefers the most specific', () => {
  assert.strictEqual(canonicalLeague('MLB'), 'MLB');
  assert.strictEqual(canonicalLeague('Soccer'), 'Soccer');
  // "FIFA World Cup 2026" must win over the shorter "FIFA World Cup".
  assert.strictEqual(canonicalLeague('⚽ FIFA World Cup 2026 🏆'), 'FIFA World Cup 2026');
  assert.strictEqual(canonicalLeague('🏆 FIFA World Cup'), 'FIFA World Cup');
});

test('canonicalLeague returns null for unknown leagues (fall back to no icon)', () => {
  assert.strictEqual(canonicalLeague('🤾 Handball'), null);
  assert.strictEqual(canonicalLeague(''), null);
  assert.strictEqual(canonicalLeague(null), null);
  // WNBA token must not be matched by the NBA key.
  assert.notStrictEqual(canonicalLeague('🏀 WNBA'), 'NBA');
});

test('pickEventLogo restores the Twins banner from an emoji-decorated MLB group', () => {
  assert.strictEqual(
    pickEventLogo({
      league: '⚾ MLB',
      name: '🇺🇸 Minnesota Twins vs 🇺🇸 Chicago Cubs @ Jul 18 1:20 PM CDT',
    }),
    TEAM_LOGOS.MLB['Minnesota Twins'],
  );
});

test('pickMatchupLogos resolves both teams from an emoji-decorated group', () => {
  const result = pickMatchupLogos({
    league: '⚾ MLB',
    name: 'Minnesota Twins vs Boston Red Sox @ Jul 18',
  });
  assert.deepStrictEqual(result, {
    away: TEAM_LOGOS.MLB['Minnesota Twins'],
    home: TEAM_LOGOS.MLB['Boston Red Sox'],
  });
});

// Coverage adds for the user's custom setup: WNBA logos already existed
// (Lynx), this brings NWSL (league mark) and PWHL (Minnesota Frost crest).
test('canonicalLeague recognizes newly-added NWSL and PWHL', () => {
  assert.strictEqual(canonicalLeague('⚽ NWSL'), 'NWSL');
  assert.strictEqual(canonicalLeague('🏒 PWHL'), 'PWHL');
});

test('pickEventLogo gives the Frost crest for a PWHL matchup', () => {
  assert.strictEqual(
    pickEventLogo({ league: '🏒 PWHL', name: 'Minnesota Frost vs Toronto Sceptres @ Jan 1' }),
    TEAM_LOGOS.PWHL['Minnesota Frost'],
  );
});

test('pickEventLogo falls back to the league mark for NWSL / non-seeded PWHL', () => {
  assert.strictEqual(
    pickEventLogo({ league: '⚽ NWSL', name: 'Orlando Pride vs Boston Legacy FC @ Jul 18' }),
    LEAGUE_LOGOS.NWSL,
  );
  assert.strictEqual(
    pickEventLogo({ league: '🏒 PWHL', name: 'Boston Fleet vs Ottawa Charge @ Jan 2' }),
    LEAGUE_LOGOS.PWHL,
  );
});
