const test = require('node:test');
const assert = require('node:assert');
const { createEventFilter } = require('../EventFilter');
const { sportFromLabel, inferSport } = require('../sports');
const Aggregator = require('../Aggregator');

const ev = (fields, sport) => ({ ...fields, sport: sport || inferSport(fields) });
const keeps = (filter, fields, sport) => createEventFilter(filter).keep(ev(fields, sport));

test('sportFromLabel reads common labels as whole words, narrow sports first', () => {
  assert.strictEqual(sportFromLabel('Basketball'), 'basketball');
  assert.strictEqual(sportFromLabel('⚾ 🇺🇸 MLB'), 'baseball');
  assert.strictEqual(sportFromLabel('Am. Football'), 'american-football');
  assert.strictEqual(sportFromLabel('Premier League Darts'), 'darts');
  assert.strictEqual(sportFromLabel('Indian Premier League'), 'cricket');
  assert.strictEqual(sportFromLabel('English Premier League'), 'soccer');
  assert.strictEqual(sportFromLabel('PPV'), 'combat');
  assert.strictEqual(sportFromLabel('Snooker'), null);
});

test('the same label maps by source: dlhd "Football" is soccer, StreamFree "football" the NFL', () => {
  assert.strictEqual(sportFromLabel('Football', { football: 'soccer' }), 'soccer');
  assert.strictEqual(sportFromLabel('Football'), null, 'ambiguous without a source override');
});

test('inferSport covers every thetvapp league', () => {
  const want = {
    MLB: 'baseball',
    NBA: 'basketball',
    NHL: 'hockey',
    NFL: 'american-football',
    NCAAF: 'american-football',
    NCAAB: 'basketball',
    Soccer: 'soccer',
    F1: 'motorsport',
    WWE: 'combat',
    Boxing: 'combat',
    MMA: 'combat',
  };
  for (const [league, sport] of Object.entries(want)) {
    assert.strictEqual(inferSport({ league, name: 'A vs B' }), sport, league);
  }
  assert.strictEqual(inferSport({ sport: 'tennis', league: 'NBA' }), 'tennis', 'provider wins');
  assert.strictEqual(inferSport({ league: 'Snooker', name: 'A vs B' }), 'other');
});

test('an empty EVENT_FILTER keeps everything', () => {
  assert.strictEqual(createEventFilter(''), null);
  assert.strictEqual(createEventFilter(' , '), null);
});

test('a sport entry keeps every competition of that sport', () => {
  const f = 'american-football';
  assert.ok(keeps(f, { league: 'NFL', name: 'Bears vs Packers' }));
  assert.ok(keeps(f, { league: 'NCAAF', name: 'Ohio State vs Michigan' }));
  assert.ok(!keeps(f, { league: 'NBA', name: 'Lakers vs Celtics' }));
});

test('Boxing keeps a boxing card however the source files it', () => {
  // dlhd: its own Boxing category.
  assert.ok(keeps('Boxing', { category: 'Boxing', league: 'Boxing', name: 'Usyk vs Dubois' }));
  // StreamFree/PPV: only "combat", no league that names the discipline.
  assert.ok(
    keeps('Boxing', { category: 'combat', league: 'PPV', name: 'Canelo vs Crawford' }, 'combat'),
  );
  assert.ok(
    keeps('Boxing', { category: 'combat', league: '', name: 'Canelo vs Crawford' }, 'combat'),
  );
  // A promoter in the name.
  assert.ok(
    keeps('boxing', { league: 'Fight Night', name: 'Matchroom: Taylor vs Serrano' }, 'combat'),
  );
  // Case and emoji don't matter.
  assert.ok(keeps('BOXING', { league: '🥊 Boxing', name: 'A vs B' }));
});

test('Boxing drops cards that are labeled as another discipline', () => {
  assert.ok(!keeps('Boxing', { category: 'combat', league: 'UFC', name: 'Jones vs Aspinall' }));
  assert.ok(
    !keeps('Boxing', { category: 'combat', league: 'PPV', name: 'UFC 320: Ankalaev vs Pereira' }),
  );
  assert.ok(
    keeps('UFC', { category: 'combat', league: 'PPV', name: 'UFC 320: Ankalaev vs Pereira' }),
  );
  assert.ok(keeps('MMA', { category: 'combat', league: 'UFC', name: 'Jones vs Aspinall' }));
});

test('NFL keeps RedZone and NFL games, not college football', () => {
  assert.ok(
    keeps('NFL', { category: 'football', league: 'NFL', name: 'RedZone' }, 'american-football'),
  );
  assert.ok(keeps('NFL', { league: 'NFL', name: 'Bears vs Packers' }));
  assert.ok(!keeps('NFL', { league: 'NCAAF', name: 'Ohio State vs Michigan' }));
});

test('a competition entry matches league aliases and keeps games labeled only "Soccer"', () => {
  const f = 'EPL,MLS';
  assert.ok(keeps(f, { league: 'English Premier League', name: 'Arsenal vs Chelsea' }));
  assert.ok(keeps(f, { league: 'Major League Soccer', name: 'LAFC vs Galaxy' }));
  assert.ok(!keeps(f, { league: 'La Liga', name: 'Barcelona vs Real Madrid' }));
  assert.ok(!keeps(f, { league: 'NBA', name: 'Lakers vs Celtics' }));
  // the-tv.app files every soccer game under "Soccer": keep rather than guess.
  assert.ok(keeps(f, { league: 'Soccer', name: 'Arsenal vs Chelsea' }));
  assert.ok(!keeps(f, { league: 'Soccer', name: 'Champions League: Inter vs Bayern' }));
});

test('an unlisted competition matches by its own words', () => {
  assert.ok(keeps('UEFA Nations League', { league: 'UEFA Nations League', name: 'A vs B' }));
  assert.ok(!keeps('UEFA Nations League', { league: 'Serie A', name: 'A vs B' }));
});

// Aggregator wiring.
class EventsOnly {
  constructor(name, events) {
    this._name = name;
    this.events = events;
  }
  get name() {
    return this._name;
  }
  async ensureReady() {}
  async refreshEvents() {}
  async listLinearChannels() {
    return {};
  }
  async listEvents() {
    return this.events;
  }
  async getEpgData() {
    return { items: [], programmesByChid: {} };
  }
  async resolveStream(ref) {
    return { url: `http://x/${ref}` };
  }
}

const START = Date.parse('2026-11-16T20:00:00Z') / 1000;
const game = (fields, ref) => ({
  startSec: START,
  endSec: START + 3 * 3600,
  streamRef: ref,
  ...fields,
});

test('the aggregator drops filtered events, records their labels and logs each once', async t => {
  const logs = [];
  t.mock.method(console, 'log', msg => logs.push(String(msg)));
  const agg = new Aggregator(
    [
      new EventsOnly('sf', [
        game(
          {
            league: 'NFL',
            name: 'Bears vs Packers',
            category: 'football',
            sport: 'american-football',
          },
          '1',
        ),
        game({ league: 'Snooker', name: 'Trump vs Robertson', category: 'snooker' }, '2'),
      ]),
    ],
    { eventFilter: 'NFL' },
  );

  const { eventEntries } = await agg.listM3uEntries();
  assert.deepStrictEqual(
    eventEntries.map(e => e.name),
    ['Bears vs Packers'],
  );
  assert.deepStrictEqual(agg.listDropped(), {
    filter: ['NFL'],
    count: 1,
    dropped: [
      {
        provider: 'sf',
        sport: 'other',
        league: 'Snooker',
        category: 'snooker',
        name: 'Trump vs Robertson',
      },
    ],
    linear: { filter: null, count: 0, dropped: [] },
  });

  await agg.listM3uEntries();
  assert.strictEqual(logs.filter(l => l.startsWith('[filter]')).length, 1);
});

test('without a filter nothing is dropped', async () => {
  const agg = new Aggregator(
    [new EventsOnly('sf', [game({ league: 'Snooker', name: 'A vs B' }, '1')])],
    { eventFilter: '' },
  );
  assert.strictEqual((await agg.listM3uEntries()).eventEntries.length, 1);
  assert.deepStrictEqual(agg.listDropped(), {
    filter: null,
    count: 0,
    dropped: [],
    linear: { filter: null, count: 0, dropped: [] },
  });
});
