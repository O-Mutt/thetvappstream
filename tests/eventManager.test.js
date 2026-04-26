const test = require('node:test');
const assert = require('node:assert');
const { parseSportIndex } = require('../EventManager');
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
