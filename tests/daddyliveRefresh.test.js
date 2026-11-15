const test = require('node:test');
const assert = require('node:assert');
const DaddyLiveProvider = require('../providers/daddylive');

const NOW = Math.floor(Date.now() / 1000);

function provider(get) {
  const p = new DaddyLiveProvider({ urls: ['https://a.example'], enableEvents: true });
  p.client = { get };
  p.mirrors.rotate = async () => null;
  return p;
}

function event(name, endSec) {
  return { league: 'NHL', name, startSec: endSec - 3 * 3600, endSec, streamRef: '51' };
}

test('refreshEvents keeps unfinished last-good events when both schedule sources fail', async () => {
  const p = provider(async () => {
    throw new Error('connect ECONNREFUSED');
  });
  p.eventsCache = [event('Live game', NOW + 3600), event('Finished game', NOW - 60)];

  await p.refreshEvents();

  assert.deepStrictEqual(
    (await p.listEvents()).map(e => e.name),
    ['Live game'],
  );
});

test('refreshEvents keeps last-good events when the JSON fallback parses to nothing', async () => {
  const p = provider(async url =>
    url.endsWith('.json')
      ? { status: 200, data: { 'Tuesday 28th April 2026 - Schedule Time UK GMT': {} } }
      : { status: 200, data: '<html>no schedule</html>' },
  );
  p.eventsCache = [event('Live game', NOW + 3600)];

  await p.refreshEvents();

  assert.strictEqual((await p.listEvents()).length, 1);
});

// --- mirror failover on an empty/frozen schedule ---------------------------

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// A homepage for "today" (UTC) with one NHL game that started at the top of
// the current UTC hour, so it is current whenever the test runs.
function freshHomepage() {
  const d = new Date();
  const day = `${d.getUTCDate()}th ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  return `
<div class="schedule__dayTitle">Someday ${day} - Schedule Time UK GMT</div>
<div class="schedule__category">
  <div class="schedule__catHeader"><div class="card__meta">Ice Hockey</div></div>
  <div class="schedule__event">
    <span class="schedule__time" data-time="${hh}:00">${hh}:00</span>
    <span class="schedule__eventTitle">NHL : San Jose Sharks vs Minnesota Wild</span>
    <div class="schedule__channels"><a href="/watch.php?id=51">Feed</a></div>
  </div>
</div>`;
}

const FROZEN_HOMEPAGE = `
<div class="schedule__dayTitle">Tuesday 28th April 2026 - Schedule Time UK GMT</div>
<div class="schedule__category">
  <div class="schedule__catHeader"><div class="card__meta">Ice Hockey</div></div>
  <div class="schedule__event">
    <span class="schedule__time" data-time="23:00">23:00</span>
    <span class="schedule__eventTitle">NHL : Old Game vs Older Game</span>
    <div class="schedule__channels"><a href="/watch.php?id=51">Feed</a></div>
  </div>
</div>`;
const FROZEN_JSON = { 'Tuesday 28th April 2026 - Schedule Time UK GMT': {} };

// Mirror behaviours keyed by base URL: 'fresh', 'frozen' or 'dead'. Every
// non-dead mirror passes the liveness probe (the 24/7 list), as a frozen
// mirror does in production. Records each homepage fetch.
function mirrorProvider(behaviour) {
  const urls = Object.keys(behaviour);
  const p = new DaddyLiveProvider({ urls, enableEvents: true });
  p.homepageHits = [];
  p.client = {
    get: async url => {
      const base = urls.find(u => url.startsWith(u));
      const kind = behaviour[base];
      if (kind === 'dead') throw new Error('connect ECONNREFUSED');
      const path = url.slice(base.length);
      if (path === '/24-7-channels.php')
        return { status: 200, data: '<a href="/watch.php?id=1">x</a>' };
      if (path === '/') {
        p.homepageHits.push(base);
        return { status: 200, data: kind === 'fresh' ? freshHomepage() : FROZEN_HOMEPAGE };
      }
      if (path.endsWith('.json')) return { status: 200, data: FROZEN_JSON };
      return { status: 404, data: '' };
    },
  };
  return p;
}

test('refreshEvents fails over from a frozen mirror to the next one that lists games', async () => {
  const p = mirrorProvider({
    'https://frozen.example': 'frozen',
    'https://fresh.example': 'fresh',
  });

  await p.refreshEvents();

  const events = await p.listEvents();
  assert.strictEqual(events.length, 1);
  assert.match(events[0].name, /Minnesota Wild/);
  assert.strictEqual(p.base(), 'https://fresh.example');
});

test('refreshEvents skips a dead mirror and a frozen one to reach a fresh one', async () => {
  const p = mirrorProvider({
    'https://dead.example': 'dead',
    'https://frozen.example': 'frozen',
    'https://fresh.example': 'fresh',
  });

  await p.refreshEvents();

  assert.strictEqual((await p.listEvents()).length, 1);
  assert.strictEqual(p.base(), 'https://fresh.example');
});

test('refreshEvents tries each frozen mirror once, then keeps last-good events', async () => {
  const p = mirrorProvider({
    'https://a.example': 'frozen',
    'https://b.example': 'frozen',
    'https://c.example': 'dead',
  });
  p.eventsCache = [event('Live game', NOW + 3600)];

  await p.refreshEvents();

  assert.deepStrictEqual(p.homepageHits, ['https://a.example', 'https://b.example']);
  assert.deepStrictEqual(
    (await p.listEvents()).map(e => e.name),
    ['Live game'],
  );
});

test('refreshEvents returns to the preferred mirror once it lists games again', async () => {
  const behaviour = { 'https://first.example': 'frozen', 'https://second.example': 'fresh' };
  const p = mirrorProvider(behaviour);
  await p.refreshEvents();
  assert.strictEqual(p.base(), 'https://second.example');

  behaviour['https://first.example'] = 'fresh';
  await p.refreshEvents();

  assert.strictEqual(p.base(), 'https://first.example');
});
