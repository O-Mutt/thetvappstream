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
