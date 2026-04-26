const test = require('node:test');
const assert = require('node:assert');
const { parseSportIndex, hrefToEventId, EventManager } = require('../EventManager');
const { parseChannelPage } = require('../ChannelManager');

const NHL_INDEX_HTML = `
<html><body>
  <ol class="list-group list-group-numbered">
    <a href="/event/carolina-hurricanes-vs-ottawa-senators-apr-25-3-00-pm/" class="list-group-item">Carolina Hurricanes vs Ottawa Senators @ Apr 25 3:00 PM
      <span>2026-04-25T19:00:00Z</span></a>
    <a href="/event/dallas-stars-vs-minnesota-wild-apr-25-5-30-pm/" class="list-group-item">Dallas Stars vs Minnesota Wild @ Apr 25 5:30 PM
      <span>2026-04-25T21:30:00Z</span></a>
    <a href="/event/pittsburgh-penguins-vs-philadelphia-flyers-apr-25-8-00-pm/" class="list-group-item">Pittsburgh Penguins vs Philadelphia Flyers @ Apr 25 8:00 PM
      <span>2026-04-26T00:00:00Z</span></a>
  </ol>
  <a href="/tv/some-channel/" class="list-group-item">A linear TV row that should be ignored<span>2026-04-25T19:00:00Z</span></a>
  <a href="/event/no-time-here/" class="list-group-item">Bogus row with no ISO span</a>
</body></html>
`;

test('parseSportIndex extracts event href, name, league, and start time', () => {
  const events = parseSportIndex(NHL_INDEX_HTML, '/nhl');
  assert.strictEqual(events.length, 3);

  assert.deepStrictEqual(events[0], {
    href: '/event/carolina-hurricanes-vs-ottawa-senators-apr-25-3-00-pm/',
    name: 'Carolina Hurricanes vs Ottawa Senators @ Apr 25 3:00 PM',
    startSec: Math.floor(Date.parse('2026-04-25T19:00:00Z') / 1000),
    league: 'NHL',
  });
  assert.strictEqual(events[1].href, '/event/dallas-stars-vs-minnesota-wild-apr-25-5-30-pm/');
  assert.strictEqual(events[2].league, 'NHL');
});

test('parseSportIndex skips non-/event/ links and rows without parseable ISO time', () => {
  const events = parseSportIndex(NHL_INDEX_HTML, '/nhl');
  assert.ok(!events.some(e => e.href.startsWith('/tv/')), 'TV channel rows should be filtered out');
  assert.ok(
    !events.some(e => e.href === '/event/no-time-here/'),
    'rows without ISO span should be filtered out',
  );
});

test('parseSportIndex strips trailing ISO span content from the visible name', () => {
  const events = parseSportIndex(NHL_INDEX_HTML, '/nhl');
  for (const e of events) {
    assert.ok(
      !/\d{4}-\d{2}-\d{2}T/.test(e.name),
      `name should not contain ISO timestamp: ${e.name}`,
    );
  }
});

test('parseSportIndex maps known sport paths to friendly league labels', () => {
  for (const [path, label] of Object.entries({
    '/mlb': 'MLB',
    '/nhl': 'NHL',
    '/nfl': 'NFL',
    '/nba': 'NBA',
    '/ncaaf': 'NCAAF',
    '/ncaab': 'NCAAB',
    '/soccer': 'Soccer',
    '/ppv': 'PPV',
  })) {
    const html = `<a href="/event/x/" class="list-group-item">X<span>2026-04-25T19:00:00Z</span></a>`;
    const events = parseSportIndex(html, path);
    assert.strictEqual(events[0].league, label);
  }
});

test('parseChannelPage handles event-page slot ids the same way as channel pages', () => {
  const eventHtml = `
    <html><body>
      <div id="stream_name" name="mlb01"></div>
    </body></html>
  `;
  const { chid, guideId } = parseChannelPage(eventHtml);
  assert.strictEqual(chid, 'mlb01');
  assert.strictEqual(guideId, null);
});

test('hrefToEventId derives a stable evt- id from the URL slug', () => {
  assert.strictEqual(
    hrefToEventId('/event/carolina-hurricanes-vs-ottawa-senators-apr-25-3-00-pm/'),
    'evt-carolina-hurricanes-vs-ottawa-senators-apr-25-3-00-pm',
  );
  assert.strictEqual(hrefToEventId('/event/foo'), 'evt-foo');
});

test('hrefToEventId returns null for non-event hrefs and bad input', () => {
  assert.strictEqual(hrefToEventId('/tv/cnn-live-stream/'), null);
  assert.strictEqual(hrefToEventId('/event/'), null);
  assert.strictEqual(hrefToEventId(''), null);
  assert.strictEqual(hrefToEventId(null), null);
  assert.strictEqual(hrefToEventId(undefined), null);
});

test('EventManager.getEpgFragment emits one channel + one programme per event (no dedup by slot)', () => {
  // Two events sharing the same upstream slot 'mlb01' but distinct event ids.
  // Old behavior collapsed them into one <channel> with two <programme>s; new
  // behavior gives each its own <channel> so Plex sees a 1:1 mapping.
  const em = new EventManager(null);
  em.events = [
    {
      name: 'Yankees vs Red Sox @ 1 PM',
      chid: 'mlb01',
      eventId: 'evt-yankees-vs-redsox-1pm',
      league: 'MLB',
      startSec: 1777138800,
      endSec: 1777151400,
    },
    {
      name: 'Cubs vs Cardinals @ 4 PM',
      chid: 'mlb01',
      eventId: 'evt-cubs-vs-cardinals-4pm',
      league: 'MLB',
      startSec: 1777150800,
      endSec: 1777163400,
    },
  ];

  const { items, programmesByChid } = em.getEpgFragment();
  assert.strictEqual(items.length, 2, 'two M3U entries should produce two EPG channels');
  assert.deepStrictEqual(
    items.map(i => i.chid),
    ['evt-yankees-vs-redsox-1pm', 'evt-cubs-vs-cardinals-4pm'],
  );
  assert.strictEqual(programmesByChid['evt-yankees-vs-redsox-1pm'].length, 1);
  assert.strictEqual(programmesByChid['evt-cubs-vs-cardinals-4pm'].length, 1);
});

test('EventManager.getEpgFragment skips events that lack an eventId', () => {
  const em = new EventManager(null);
  em.events = [
    { name: 'Has id', chid: 'mlb01', eventId: 'evt-has-id', league: 'MLB', startSec: 1, endSec: 2 },
    { name: 'No id', chid: 'mlb02', eventId: null, league: 'MLB', startSec: 3, endSec: 4 },
  ];
  const { items } = em.getEpgFragment();
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].chid, 'evt-has-id');
});
