const test = require('node:test');
const assert = require('node:assert');
const { stripTime, teamSet, canonicalKey, canonicalEventId } = require('../canonicalName');

const startA = Date.parse('2026-05-22T23:10:00Z') / 1000;

test('stripTime removes the trailing "@ time" suffix', () => {
  assert.strictEqual(
    stripTime('Minnesota Twins vs Boston Red Sox @ May 22 7:10 PM'),
    'Minnesota Twins vs Boston Red Sox',
  );
});

test('teamSet is order- and format-independent', () => {
  assert.deepStrictEqual(
    teamSet('Boston Red Sox vs Minnesota Twins @ May 22 7:10 PM'),
    teamSet('Minnesota Twins at Boston Red Sox @ 7:10pm'),
  );
});

test('canonicalKey matches the same game described two ways', () => {
  const a = {
    league: 'MLB',
    name: 'Minnesota Twins vs Boston Red Sox @ May 22 7:10 PM',
    startSec: startA,
  };
  const b = {
    league: 'mlb',
    name: 'Boston Red Sox at Minnesota Twins @ 7:10pm',
    // 20 min later, same UTC day -> same bucket
    startSec: startA + 20 * 60,
  };
  assert.strictEqual(canonicalKey(a), canonicalKey(b));
});

test('canonicalKey separates different matchups', () => {
  const a = { league: 'MLB', name: 'Twins vs Red Sox', startSec: startA };
  const b = { league: 'MLB', name: 'Twins vs Yankees', startSec: startA };
  assert.notStrictEqual(canonicalKey(a), canonicalKey(b));
});

test('canonicalKey separates the same matchup on different days', () => {
  const a = { league: 'MLB', name: 'Twins vs Red Sox', startSec: startA };
  const b = { league: 'MLB', name: 'Twins vs Red Sox', startSec: startA + 24 * 3600 };
  assert.notStrictEqual(canonicalKey(a), canonicalKey(b));
});

test('canonicalEventId is evt- prefixed and url/xmltv-safe', () => {
  const id = canonicalEventId({
    league: 'MLB',
    name: 'Twins vs Red Sox @ May 22 7:10 PM',
    startSec: startA,
  });
  assert.match(id, /^evt-[a-z0-9-]+$/);
});
