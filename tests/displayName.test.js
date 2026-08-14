const test = require('node:test');
const assert = require('node:assert');
const { stripEmoji, normalizeLeagueLabel, normalizeEventName } = require('../displayName');

test('stripEmoji removes sport icons, flags and variation selectors', () => {
  assert.strictEqual(stripEmoji('⚾ 🇺🇸 MLB'), 'MLB');
  assert.strictEqual(stripEmoji('Netball ⛹️'), 'Netball');
  assert.strictEqual(stripEmoji('🏴 England vs 🇦🇷 Argentina'), 'England vs Argentina');
  assert.strictEqual(
    stripEmoji(' Toronto Blue Jays 🇨🇦  vs  Boston Red Sox 🇺🇸 '),
    'Toronto Blue Jays vs Boston Red Sox',
  );
});

test('stripEmoji leaves accented Latin and punctuation alone', () => {
  // These are live keys in the team-logo tables — mangling them loses the crest.
  assert.strictEqual(stripEmoji('CF Montréal'), 'CF Montréal');
  assert.strictEqual(stripEmoji('Türkiye'), 'Türkiye');
  assert.strictEqual(stripEmoji('Curaçao'), 'Curaçao');
  assert.strictEqual(stripEmoji("Côte d'Ivoire"), "Côte d'Ivoire");
  assert.strictEqual(stripEmoji('St. Louis Cardinals'), 'St. Louis Cardinals');
  assert.strictEqual(
    stripEmoji('US Open | 23 August–13 September 2026'),
    'US Open | 23 August–13 September 2026',
  );
});

test('stripEmoji handles empty and non-string input', () => {
  assert.strictEqual(stripEmoji(''), '');
  assert.strictEqual(stripEmoji(null), '');
  assert.strictEqual(stripEmoji(undefined), '');
});

test('normalizeLeagueLabel canonicalizes known leagues regardless of decoration', () => {
  assert.strictEqual(normalizeLeagueLabel('⚾ 🇨🇦 MLB'), 'MLB');
  assert.strictEqual(normalizeLeagueLabel('⚾ 🇺🇸 MLB'), 'MLB');
  assert.strictEqual(normalizeLeagueLabel('MLB'), 'MLB');
  assert.strictEqual(normalizeLeagueLabel('Tennis 🎾 ATP - Singles'), 'Tennis');
});

test('normalizeLeagueLabel strips decoration from leagues we do not map', () => {
  assert.strictEqual(
    normalizeLeagueLabel('⚽ 🇺🇦 Ukrainian Premier League'),
    'Ukrainian Premier League',
  );
  assert.strictEqual(normalizeLeagueLabel('⚽ 🇬🇷 Club Friendly'), 'Club Friendly');
  assert.strictEqual(normalizeLeagueLabel('Athletics 🏃'), 'Athletics');
});

test('normalizeLeagueLabel does not match a shorter league inside a longer word', () => {
  // "Netball" must not resolve to NBA; canonicalLeague matches whole words only.
  assert.strictEqual(normalizeLeagueLabel("Netball ⛹️ Champs '26"), "Netball Champs '26");
});

test('normalizeLeagueLabel falls back to the raw label when it is only decoration', () => {
  assert.strictEqual(normalizeLeagueLabel('⚾'), '⚾');
});

test('normalizeEventName keeps the "@ <time>" suffix the scheduler parses', () => {
  assert.strictEqual(
    normalizeEventName(' Toronto Blue Jays 🇨🇦 vs Boston Red Sox 🇺🇸 @ Aug 10 6:07 PM CDT'),
    'Toronto Blue Jays vs Boston Red Sox @ Aug 10 6:07 PM CDT',
  );
});

// ---------------------------------------------------------------------------
// Duplicate league prefix
//
// dlhd changed "LEAGUE : matchup" to "LEAGUE: matchup", so the daddylive
// parser's ' : ' split stopped firing and the league stayed inside the matchup.
// The guide title then prepended it again: "MLB: MLB: Detroit Tigers vs ...".
const { stripLeaguePrefix } = require('../displayName');

test('stripLeaguePrefix removes a league the source baked into the name', () => {
  assert.strictEqual(
    stripLeaguePrefix('MLB: Detroit Tigers vs Cleveland Guardians @ Aug 13 5:40 PM CDT', 'MLB'),
    'Detroit Tigers vs Cleveland Guardians @ Aug 13 5:40 PM CDT',
  );
  // soccer doubles the same way
  assert.strictEqual(
    stripLeaguePrefix(
      'Europe - UEFA Europa League: Pafos vs Salzburg @ Aug 13 2:00 PM CDT',
      'Europe - UEFA Europa League',
    ),
    'Pafos vs Salzburg @ Aug 13 2:00 PM CDT',
  );
});

test('stripLeaguePrefix matches through emoji and punctuation differences', () => {
  assert.strictEqual(stripLeaguePrefix('⚾ 🇺🇸 MLB: Twins vs Orioles', 'MLB'), 'Twins vs Orioles');
  assert.strictEqual(
    stripLeaguePrefix('MLB: Twins vs Orioles', 'Baseball (MLB) ⚾'),
    'Twins vs Orioles',
  );
});

test('stripLeaguePrefix leaves a colon that is not a league separator', () => {
  // dlhd event strings are full of these; splitting them would mangle titles.
  for (const [name, league] of [
    ['90 Day: The Last Resort Season 3', 'TV Shows'],
    ['Restaurant Impossible: Last Call Season 1, Episode 4', 'TV Shows'],
    ['Accused: Guilty or Innocent? Season 8', 'TV Shows'],
  ]) {
    assert.strictEqual(stripLeaguePrefix(name, league), name);
  }
});

test('stripLeaguePrefix keeps a tournament prefix that differs from the league', () => {
  // "ATP Cincinnati" under a Tennis category is real information, not a dupe.
  assert.strictEqual(
    stripLeaguePrefix('ATP Cincinnati: Martin Landaluce vs Jack Draper', 'Tennis'),
    'ATP Cincinnati: Martin Landaluce vs Jack Draper',
  );
});

test('stripLeaguePrefix ignores colons inside clock times', () => {
  const name = 'Twins vs Orioles @ Aug 13 5:40 PM CDT';
  assert.strictEqual(stripLeaguePrefix(name, 'MLB'), name);
});

test('stripLeaguePrefix handles empty and degenerate input', () => {
  assert.strictEqual(stripLeaguePrefix('', 'MLB'), '');
  assert.strictEqual(stripLeaguePrefix(':leading colon', 'MLB'), ':leading colon');
  assert.strictEqual(stripLeaguePrefix('MLB:', 'MLB'), 'MLB:', 'nothing left after the colon');
});

test('stripLeaguePrefix also drops a bare leading league with no separator', () => {
  // dlhd's Tennis category repeats the league as a leading word:
  // "Tennis" + "Tennis ATP Cincinnati" rendered as "Tennis: Tennis ATP ...".
  assert.strictEqual(stripLeaguePrefix('Tennis ATP Cincinnati', 'Tennis'), 'ATP Cincinnati');
  assert.strictEqual(
    stripLeaguePrefix('Tennis WTA Toronto Centre Court', 'Tennis'),
    'WTA Toronto Centre Court',
  );
});

test('stripLeaguePrefix will not strip a name down to nothing', () => {
  assert.strictEqual(stripLeaguePrefix('Tennis', 'Tennis'), 'Tennis');
  assert.strictEqual(stripLeaguePrefix('Tennis Final', 'Tennis'), 'Tennis Final');
});

test('stripLeaguePrefix leaves a matchup that merely mentions the league word', () => {
  const name = 'Racing Club vs Boca Juniors @ Aug 13 5:40 PM CDT';
  assert.strictEqual(stripLeaguePrefix(name, 'Horse Racing'), name);
});
