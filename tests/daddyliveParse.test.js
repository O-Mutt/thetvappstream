const test = require('node:test');
const assert = require('node:assert');
const {
  parseChannels,
  parseSchedule,
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
  // deliberately stale/wrong date label, like dlhd serves
  'Thursday 20th March 2025 - Schedule Time UK GMT': {
    'TV Shows</span>': [
      { time: '12:00', event: "Hell's Kitchen", channels: [{ channel_id: '742' }] },
    ],
    'Baseball</span>': [
      {
        // 20:00 London (BST) == 19:00 UTC == 3:00 PM ET, ~1h ahead of NOW -> keep
        time: '20:00',
        event: 'MLB : Boston Red Sox vs Minnesota Twins',
        channels: [{ channel_name: 'MLB Network', channel_id: '742' }],
        channels2: [{ channel_name: 'Backup', channel_id: '999' }],
      },
    ],
    'Basketball</span>': [
      {
        // 02:00 London next day-ish; here 06:00 London == 05:00 UTC, long past NOW -> drop
        time: '06:00',
        event: 'NBA : Old Game vs Stale Team',
        channels: [{ channel_id: '500' }],
      },
    ],
  },
};

test('parseSchedule keeps current sport events, drops TV Shows and stale ones', () => {
  const events = parseSchedule(SCHEDULE, { nowSec: NOW });
  assert.strictEqual(events.length, 1, 'only the live MLB game survives');
  const e = events[0];
  assert.strictEqual(e.league, 'MLB');
  assert.match(e.name, /^Boston Red Sox vs Minnesota Twins @ /);
  assert.match(e.name, /3:00 PM$/); // formatted in ET
  assert.strictEqual(e.streamRef, '742');
  assert.deepStrictEqual(e.channelIds, ['742', '999']); // primary + backup feed
  assert.strictEqual(e.endSec, e.startSec + 210 * 60); // MLB duration
});

test('parseSchedule ignores the stale date header and uses "today"', () => {
  const events = parseSchedule(SCHEDULE, { nowSec: NOW });
  // event start is computed from NOW's date, not "March 2025"
  const startIso = new Date(events[0].startSec * 1000).toISOString();
  assert.match(startIso, /^2026-06-08T19:00:00/);
});

test('parseSchedule drops events whose only channel list is empty', () => {
  const sched = {
    Day: { 'Soccer</span>': [{ time: '20:00', event: 'A vs B', channels: [] }] },
  };
  assert.deepStrictEqual(parseSchedule(sched, { nowSec: NOW }), []);
});
