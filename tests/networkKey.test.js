const test = require('node:test');
const assert = require('node:assert');
const { networkKey } = require('../networkKey');

const same = (...names) => {
  const keys = names.map(networkKey);
  assert.ok(
    keys.every(k => k === keys[0]),
    `${names.join(' / ')} -> ${keys.join(' / ')}`,
  );
  return keys[0];
};

test('quality and US-market decoration is ignored', () => {
  assert.strictEqual(
    same('ESPN USA', 'ESPN HD', 'espn', 'US: ESPN [HD]', 'USA | ESPN FHD'),
    'espn',
  );
  assert.strictEqual(same('News One (720p)', 'News One SD', 'News One 1080p'), 'news-one');
});

test('digits joined to a name are split so spellings agree', () => {
  assert.strictEqual(same('ESPN2 USA', 'ESPN 2'), 'espn-2');
  assert.strictEqual(networkKey('Sky Sports F1 UK'), 'sky-sports-f1');
});

test('aliases join known spellings', () => {
  assert.strictEqual(same('NFL Network', 'NFL Net', 'NFLNetwork'), 'nfl-network');
  assert.strictEqual(same('NFL RedZone', 'RedZone', 'Red Zone'), 'nfl-redzone');
  assert.strictEqual(same('FS1', 'Fox Sports 1 USA'), 'fox-sports-1');
  assert.strictEqual(same('CBS Sports Network (CBSSN)', 'CBSSN'), 'cbs-sports-network');
  assert.strictEqual(same('Willow Cricket', 'Willow'), 'willow');
});

test('Sky Sports UK channels match with or without the suffix; other markets stay apart', () => {
  assert.strictEqual(same('Sky Sports Tennis UK', 'Sky Sports Tennis'), 'sky-sports-tennis');
  assert.notStrictEqual(networkKey('Sky Sports F1 DE'), networkKey('Sky Sports F1'));
});

test('different feeds and markets stay separate channels', () => {
  assert.notStrictEqual(networkKey('ESPN 2 NL'), networkKey('ESPN2 USA'));
  assert.notStrictEqual(networkKey('TNT Sports 1 UK'), networkKey('TNT USA'));
  assert.notStrictEqual(networkKey('18+ (Player-01)'), networkKey('18+ (Player-02)'));
  assert.notStrictEqual(networkKey('HBO (East)'), networkKey('HBO (West)'));
});

test('accents and emoji do not change the key; empty names give an empty key', () => {
  assert.strictEqual(same('Télé Montréal', 'Tele Montreal'), 'tele-montreal');
  assert.strictEqual(networkKey('📺 ESPN'), 'espn');
  assert.strictEqual(networkKey('HD'), '');
  assert.strictEqual(networkKey(''), '');
});
