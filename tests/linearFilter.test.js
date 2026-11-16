const test = require('node:test');
const assert = require('node:assert');
const { createLinearFilter } = require('../linearFilter');
const { networkKey } = require('../networkKey');
const Aggregator = require('../Aggregator');

const keeps = (filter, name) => createLinearFilter(filter).keep(networkKey(name));

test('an empty LINEAR_FILTER keeps everything', () => {
  assert.strictEqual(createLinearFilter(''), null);
  assert.strictEqual(createLinearFilter(' , '), null);
});

test('an entry matches every spelling of its network', () => {
  for (const name of ['ESPN', 'ESPN USA', 'ESPN HD', 'US: ESPN'])
    assert.ok(keeps('espn', name), name);
  assert.ok(keeps('RedZone', 'NFL RedZone'));
  assert.ok(keeps('FS1', 'Fox Sports 1 USA'));
});

test('an entry keeps its family as whole words only', () => {
  assert.ok(keeps('ESPN', 'ESPN2 USA'));
  assert.ok(keeps('ESPN', 'ESPN Deportes'));
  assert.ok(!keeps('ESPN', 'ESPNU USA'), 'espnu is a different word');
  assert.ok(keeps('Sky Sports', 'Sky Sports F1 UK'));
  assert.ok(!keeps('Sky Sports', 'Sky News'));
});

test('a family match leaves out regional editions unless the entry names the market', () => {
  assert.ok(!keeps('ESPN', 'ESPN 2 NL'));
  assert.ok(!keeps('Fox Sports', 'FOX Sports 502 AU'));
  assert.ok(!keeps('Sky Sports', 'Sky Sports F1 DE'));
  assert.ok(keeps('Sky Sports', 'Sky Sports Main Event'));
  assert.ok(keeps('ESPN MX', 'ESPN 2 MX'));
  assert.ok(keeps('ESPN MX', 'ESPN USA'), 'naming a market adds it to the home feeds');
  assert.ok(keeps('TNT Sports UK', 'TNT Sports 3 UK'));
  assert.ok(!keeps('TNT', 'TNT Sports 1 UK'));
});

test('"=" keeps exactly one network', () => {
  assert.ok(keeps('=ESPN', 'ESPN USA'));
  assert.ok(!keeps('=ESPN', 'ESPN2 USA'));
});

class LinearOnly {
  constructor(name, linear) {
    this._name = name;
    this.linear = linear;
  }
  get name() {
    return this._name;
  }
  async ensureReady() {}
  async refreshEvents() {}
  async listLinearChannels() {
    return this.linear;
  }
  async listEvents() {
    return [];
  }
  async getEpgData() {
    return {
      items: Object.entries(this.linear).map(([name, chid]) => ({ name, chid, logo: null })),
      programmesByChid: {},
    };
  }
  async resolveStream(ref) {
    return { url: `http://x/${ref}` };
  }
}

test('the aggregator lists and guides only kept networks, and reports the rest', async t => {
  const logs = [];
  t.mock.method(console, 'log', msg => logs.push(String(msg)));
  const dl = new LinearOnly('daddylive', {
    'ESPN USA': '44',
    'ESPN2 USA': '45',
    'CNN USA': '345',
    'NFL RedZone': '667',
  });
  const agg = new Aggregator([dl], { linearFilter: 'ESPN, RedZone', eventFilter: '' });

  const { linearEntries } = await agg.listM3uEntries();
  assert.deepStrictEqual(
    linearEntries.map(e => e.tvgId),
    ['live:espn', 'live:espn-2', 'live:nfl-redzone'],
  );
  await assert.rejects(agg.resolveStream('live:cnn'), /unknown stream id/);
  assert.deepStrictEqual(agg.listDropped().linear, {
    filter: ['ESPN', 'RedZone'],
    count: 1,
    dropped: ['CNN USA'],
  });

  await agg.refreshEpg();
  assert.ok(!agg.getEpgXml().includes('live:cnn'));
  assert.strictEqual(logs.filter(l => l.includes('linear channel')).length, 1, 'logged once');
});
