const test = require('node:test');
const assert = require('node:assert');
const {
  parseChannels,
  parseSchedule,
  parseScheduleHeaderDate,
  parseScheduleHtml,
  formatEventSuffix,
  leagueAndMatchup,
  zonedToUtcSec,
} = require('../providers/daddylive/parse');

const CHANNELS_HTML = `
<div class="grid">
  <a href="/watch.php?id=51" class="card">CNN USA ID: 51</a>
  <a href="/watch.php?id=206">ESPN USA ID: 206</a>
  <a href="https://dlhd.pk/watch.php?id=302">TNT Sports 1 UK</a>
  <a href="/24-7-channels.php">Back</a>
  <a href="/watch.php?id=51">CNN USA ID: 51</a>
</div>`;

test('parseChannels maps display name -> id, strips "ID: N", ignores non-channel links', () => {
  const ch = parseChannels(CHANNELS_HTML);
  assert.deepStrictEqual(ch, { 'CNN USA': '51', 'ESPN USA': '206', 'TNT Sports 1 UK': '302' });
});

test('parseChannels returns empty for junk input', () => {
  assert.deepStrictEqual(parseChannels(''), {});
  assert.deepStrictEqual(parseChannels('<html>no channels</html>'), {});
});

test('leagueAndMatchup prefers the "LEAGUE : matchup" prefix', () => {
  assert.deepStrictEqual(leagueAndMatchup('MLB : Boston Red Sox vs Minnesota Twins', 'Baseball'), {
    league: 'MLB',
    matchup: 'Boston Red Sox vs Minnesota Twins',
  });
});

test('leagueAndMatchup falls back to a mapped category label', () => {
  assert.deepStrictEqual(leagueAndMatchup('Some Friendly Match', 'Soccer'), {
    league: 'Soccer',
    matchup: 'Some Friendly Match',
  });
});

test('zonedToUtcSec handles British Summer Time (GMT+1 in June)', () => {
  // 19:00 London on 2026-06-08 (BST) == 18:00 UTC
  const sec = zonedToUtcSec(2026, 6, 8, 19, 0, 'Europe/London');
  assert.strictEqual(new Date(sec * 1000).toISOString(), '2026-06-08T18:00:00.000Z');
});

test('zonedToUtcSec handles GMT in winter', () => {
  // 19:00 London on 2026-01-08 (GMT) == 19:00 UTC
  const sec = zonedToUtcSec(2026, 1, 8, 19, 0, 'Europe/London');
  assert.strictEqual(new Date(sec * 1000).toISOString(), '2026-01-08T19:00:00.000Z');
});

// nowSec anchored to 2026-06-08 ~14:00 ET (18:00 UTC)
const NOW = Date.parse('2026-06-08T18:00:00Z') / 1000;

const SCHEDULE = {
  // header date matches NOW (2026-06-08) so the freshness gate passes
  'Monday 8th June 2026 - Schedule Time UK GMT': {
    'TV Shows</span>': [
      { time: '12:00', event: "Hell's Kitchen", channels: [{ channel_id: '742' }] },
    ],
    'Baseball</span>': [
      {
        // 20:00 GMT (UTC+0) == 20:00 UTC == 3:00 PM CDT, ~2h ahead of NOW -> keep
        time: '20:00',
        event: 'MLB : Boston Red Sox vs Minnesota Twins',
        channels: [{ channel_name: 'MLB Network', channel_id: '742' }],
        channels2: [{ channel_name: 'Backup', channel_id: '999' }],
      },
    ],
    'Basketball</span>': [
      {
        // 06:00 GMT (UTC+0) == 06:00 UTC, long past NOW (18:00 UTC) -> drop
        time: '06:00',
        event: 'NBA : Old Game vs Stale Team',
        channels: [{ channel_id: '500' }],
      },
    ],
  },
};

// Some mirrors use a bare label with no date; the freshness gate can't judge it
// so it falls through to the relabel-to-today path.
const SCHEDULE_NO_DATE = {
  Day: {
    'Baseball</span>': [
      {
        time: '20:00',
        event: 'MLB : Boston Red Sox vs Minnesota Twins',
        channels: [{ channel_id: '742' }],
      },
    ],
  },
};

test('parseSchedule keeps current sport events, drops TV Shows and stale ones', () => {
  const events = parseSchedule(SCHEDULE, { nowSec: NOW, displayTz: 'America/Chicago' });
  assert.strictEqual(events.length, 1, 'only the live MLB game survives');
  const e = events[0];
  assert.strictEqual(e.league, 'MLB');
  assert.match(e.name, /^Boston Red Sox vs Minnesota Twins @ /);
  // 20:00 GMT (UTC+0) == 20:00 UTC == 3:00 PM CDT, labeled with the zone
  assert.match(e.name, /3:00 PM CDT$/);
  assert.strictEqual(e.streamRef, '742');
  assert.deepStrictEqual(e.channelIds, ['742', '999']); // primary + backup feed
  assert.strictEqual(e.endSec, e.startSec + 210 * 60); // MLB duration
});

test('parseSchedule anchors event times to the day-header date', () => {
  const events = parseSchedule(SCHEDULE, { nowSec: NOW });
  const startIso = new Date(events[0].startSec * 1000).toISOString();
  assert.match(startIso, /^2026-06-08T20:00:00/); // header is the 8th == today here
});

test('parseSchedule rejects a schedule whose header date is far stale', () => {
  const stale = {
    'Thursday 20th March 2025 - Schedule Time UK GMT':
      SCHEDULE['Monday 8th June 2026 - Schedule Time UK GMT'],
  };
  const seen = [];
  const events = parseSchedule(stale, { nowSec: NOW, onStaleDay: info => seen.push(info) });
  assert.deepStrictEqual(events, [], 'frozen mirror contributes no phantom events');
  assert.strictEqual(seen.length, 1);
  assert.strictEqual(
    seen[0].driftDays,
    Math.round((Date.UTC(2025, 2, 20) - Date.UTC(2026, 5, 8)) / 86400000),
  );
});

test('parseSchedule keeps a within-tolerance future day, dated to its header', () => {
  const tomorrow = {
    'Tuesday 9th June 2026 - Schedule Time UK GMT':
      SCHEDULE['Monday 8th June 2026 - Schedule Time UK GMT'],
  };
  const events = parseSchedule(tomorrow, { nowSec: NOW });
  // Stamped on the 9th (the header date), so both sport games are upcoming —
  // the 06:00 NBA game is no longer "earlier today" once correctly dated.
  assert.strictEqual(events.length, 2, 'a 1-day-ahead schedule keeps its future games');
  for (const e of events) {
    assert.match(new Date(e.startSec * 1000).toISOString(), /^2026-06-09T/, 'dated to the 9th');
  }
});

test('parseSchedule still processes day keys with no parseable date', () => {
  const events = parseSchedule(SCHEDULE_NO_DATE, { nowSec: NOW });
  assert.strictEqual(events.length, 1, 'unparseable header falls through to relabel-to-today');
});

test('formatEventSuffix renders a DST-accurate Central label', () => {
  // 2026-06-12 19:00 UTC -> Central Daylight (UTC-5) -> 2:00 PM CDT
  const summer = Date.parse('2026-06-12T19:00:00Z') / 1000;
  assert.strictEqual(formatEventSuffix(summer, 'America/Chicago'), 'Jun 12 2:00 PM CDT');
  // 2026-01-12 19:00 UTC -> Central Standard (UTC-6) -> 1:00 PM CST
  const winter = Date.parse('2026-01-12T19:00:00Z') / 1000;
  assert.strictEqual(formatEventSuffix(winter, 'America/Chicago'), 'Jan 12 1:00 PM CST');
  // an explicit zone override still works (Eastern)
  assert.strictEqual(formatEventSuffix(summer, 'America/New_York'), 'Jun 12 3:00 PM EDT');
});

// Mirrors the live dlhd homepage DOM: one day header, categories with a
// .card__meta label, events with .schedule__time[data-time] + .schedule__eventTitle,
// and .schedule__channels anchors carrying watch.php?id=N. Includes a future-dated
// category that must be skipped.
const HOMEPAGE_HTML = `
<div class="schedule__dayTitle">Monday 8th June 2026 - Schedule Time UK GMT</div>
<div class="schedule__category">
  <div class="schedule__catHeader"><div class="card__meta">Soccer</div></div>
  <div class="schedule__categoryBody">
    <div class="schedule__event">
      <div class="schedule__eventHeader" data-title="x">
        <span class="schedule__time" data-time="19:00">19:00</span>
        <span class="schedule__eventTitle">Canada vs Bosnia and Herzegovina</span>
      </div>
      <div class="schedule__channels">
        <a target="_blank" href="/watch.php?id=211" data-ch="event">Feed 1</a>
        <a target="_blank" href="/watch.php?id=5016" data-ch="event">Feed 2</a>
      </div>
    </div>
  </div>
</div>
<div class="schedule__category">
  <div class="schedule__catHeader"><div class="card__meta">FIFA World Cup 2026 — Upcoming Matches Jun 10</div></div>
  <div class="schedule__categoryBody">
    <div class="schedule__event">
      <div class="schedule__eventHeader">
        <span class="schedule__time" data-time="20:00">20:00</span>
        <span class="schedule__eventTitle">Future Game vs Other Team</span>
      </div>
      <div class="schedule__channels"><a href="/watch.php?id=999">Feed</a></div>
    </div>
  </div>
</div>`;

test('parseScheduleHtml parses the live homepage and extracts watch.php channel ids', () => {
  const events = parseScheduleHtml(HOMEPAGE_HTML, { nowSec: NOW, displayTz: 'America/Chicago' });
  assert.strictEqual(events.length, 1, 'today Soccer game kept; future-dated category skipped');
  const e = events[0];
  assert.strictEqual(e.league, 'Soccer');
  // 19:00 GMT (UTC+0) == 19:00 UTC == 2:00 PM CDT
  assert.match(e.name, /^Canada vs Bosnia and Herzegovina @ Jun \d+ 2:00 PM CDT$/);
  assert.strictEqual(e.streamRef, '211');
  assert.deepStrictEqual(e.channelIds, ['211', '5016']);
});

test('parseScheduleHtml rejects a stale homepage via the freshness gate', () => {
  const stale = HOMEPAGE_HTML.replace('Monday 8th June 2026', 'Thursday 20th March 2025');
  assert.deepStrictEqual(parseScheduleHtml(stale, { nowSec: NOW }), []);
});

// dlhd leads the homepage with YESTERDAY's section, then today's. Each game must
// be stamped on its own day header so finished ones drop out — regression for
// "Canada vs Bosnia (yesterday) showing as scheduled today".
const TWO_DAY_HTML = `
<div class="schedule__dayTitle">Sunday 7th June 2026 - Schedule Time UK GMT</div>
<div class="schedule__category">
  <div class="schedule__catHeader"><div class="card__meta">Soccer</div></div>
  <div class="schedule__categoryBody">
    <div class="schedule__event">
      <div class="schedule__eventHeader">
        <span class="schedule__time" data-time="19:00">19:00</span>
        <span class="schedule__eventTitle">Yesterday Game vs Old Team</span>
      </div>
      <div class="schedule__channels"><a href="/watch.php?id=100">Feed</a></div>
    </div>
  </div>
</div>
<div class="schedule__dayTitle">Monday 8th June 2026 - Schedule Time UK GMT</div>
<div class="schedule__category">
  <div class="schedule__catHeader"><div class="card__meta">Soccer</div></div>
  <div class="schedule__categoryBody">
    <div class="schedule__event">
      <div class="schedule__eventHeader">
        <span class="schedule__time" data-time="20:00">20:00</span>
        <span class="schedule__eventTitle">Today Game vs New Team</span>
      </div>
      <div class="schedule__channels"><a href="/watch.php?id=200">Feed</a></div>
    </div>
  </div>
</div>`;

test('parseScheduleHtml drops a leading past-day section, keeps today', () => {
  const events = parseScheduleHtml(TWO_DAY_HTML, { nowSec: NOW, displayTz: 'America/Chicago' });
  assert.strictEqual(events.length, 1, "yesterday's finished game dropped; today's kept");
  assert.match(events[0].name, /^Today Game vs New Team @ /);
  assert.strictEqual(events[0].streamRef, '200');
});

test('parseScheduleHeaderDate extracts the date or returns null', () => {
  assert.deepStrictEqual(
    parseScheduleHeaderDate('Thursday 20th March 2025 - Schedule Time UK GMT'),
    {
      y: 2025,
      m: 3,
      d: 20,
    },
  );
  assert.deepStrictEqual(parseScheduleHeaderDate('Monday 8th June 2026 - Schedule Time UK GMT'), {
    y: 2026,
    m: 6,
    d: 8,
  });
  assert.strictEqual(parseScheduleHeaderDate('Day'), null);
  assert.strictEqual(parseScheduleHeaderDate(''), null);
});

test('parseSchedule drops events whose only channel list is empty', () => {
  const sched = {
    Day: { 'Soccer</span>': [{ time: '20:00', event: 'A vs B', channels: [] }] },
  };
  assert.deepStrictEqual(parseSchedule(sched, { nowSec: NOW }), []);
});
