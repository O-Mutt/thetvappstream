const test = require('node:test');
const assert = require('node:assert');
const {
  parseMatchupTeams,
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

test('pickEventLogo returns NCAAF league logo for teams not in the preferred/team maps', () => {
  assert.strictEqual(
    pickEventLogo({ league: 'NCAAF', name: 'Iowa vs Wisconsin @ Nov 8' }),
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
