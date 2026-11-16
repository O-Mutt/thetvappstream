const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseLeagueListing,
  parseRelativeStartSec,
  isEndedBadge,
  parseWatchPage,
  parseEmbedPlaylist,
  LEAGUE_BY_PATH,
} = require('../providers/thetvapp/parse');

const LISTING = `
<div class="col-lg-12"><h4>MLB</h4>
<ol class="list-group list-group-numbered mb-4">
  <a class="list-group-item" href="https://the-tv.app/tv-live/mlb/new-york-yankees-cleveland-guardians/7515936008">Cleveland Guardians vs New York Yankees: <span class="time-badge"> In Progress </span> HD</a>
  <a class="list-group-item" href="/tv-live/mlb/san-diego-padres-cincinnati-reds/7515952976">San Diego Padres vs Cincinnati Reds: <span class="time-badge">13 minutes from now</span> HD</a>
  <a class="list-group-item" href="/tv-live/mlb/x-y/7515958632">Team X vs Team Y: <span class="time-badge">Final</span> HD</a>
</ol></div>`;

test('parseLeagueListing extracts matchup, path, time badge', () => {
  const rows = parseLeagueListing(LISTING, 'MLB');
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(rows[0].matchup, 'Cleveland Guardians vs New York Yankees');
  assert.strictEqual(rows[0].href, '/tv-live/mlb/new-york-yankees-cleveland-guardians/7515936008');
  assert.strictEqual(rows[0].timeText, 'In Progress');
  assert.strictEqual(rows[1].href, '/tv-live/mlb/san-diego-padres-cincinnati-reds/7515952976');
  assert.strictEqual(rows[1].matchup, 'San Diego Padres vs Cincinnati Reds');
});

test('parseRelativeStartSec handles in-progress / minutes / hours / unknown', () => {
  const now = 1_000_000;
  assert.strictEqual(parseRelativeStartSec('In Progress', now), now);
  assert.strictEqual(parseRelativeStartSec('13 minutes from now', now), now + 13 * 60);
  assert.strictEqual(parseRelativeStartSec('2 hours from now', now), now + 2 * 3600);
  assert.strictEqual(parseRelativeStartSec('Starting Soon', now), now + 5 * 60);
  assert.strictEqual(parseRelativeStartSec('Final', now), null);
  assert.strictEqual(parseRelativeStartSec('', now), null);
});

test('isEndedBadge flags only finished games', () => {
  assert.ok(isEndedBadge('Final'));
  assert.ok(isEndedBadge('Full Time'));
  assert.ok(isEndedBadge('Postponed'));
  assert.ok(!isEndedBadge('In Progress'));
  assert.ok(!isEndedBadge('2 hours from now'));
  // A weather delay is a live game that resumes — it must not drop the channel.
  assert.ok(!isEndedBadge('Delayed'));
  assert.ok(!isEndedBadge('Rain Delay'));
  assert.ok(isEndedBadge('FT'));
  assert.ok(isEndedBadge('Abandoned'));
});

const WATCH = `
<h1>Giants vs Nationals</h1>
<p>Start Time: 56 seconds from now</p>
<button onclick="window.changeStream(51828)">Server1</button>
<button onclick="window.changeStream(51829)">Backup</button>
<div>Date: 2026-06-10 15:45ET</div>
<iframe src="https://gooz.aapmains.net/new-stream-embed/51828"></iframe>`;

test('parseWatchPage reads absolute ET time, stream ids, embed host', () => {
  const { startSec, streamIds, embedHost } = parseWatchPage(WATCH);
  assert.deepStrictEqual(streamIds, ['51828', '51829']);
  assert.strictEqual(embedHost, 'gooz.aapmains.net');
  // 2026-06-10 15:45 ET == 19:45 UTC (EDT, UTC-4)
  const d = new Date(startSec * 1000);
  assert.strictEqual(d.getUTCHours(), 19);
  assert.strictEqual(d.getUTCMinutes(), 45);
});

test('parseEmbedPlaylist extracts the load-playlist url', () => {
  const embed = `clappr.Player({source: "https://chatgpt.hereisman.net/playlist/51828/load-playlist"});`;
  assert.strictEqual(
    parseEmbedPlaylist(embed, 'https://gooz.aapmains.net'),
    'https://chatgpt.hereisman.net/playlist/51828/load-playlist',
  );
  // relative source resolves against the embed origin
  assert.strictEqual(
    parseEmbedPlaylist(`source:'/playlist/9/load-playlist'`, 'https://gooz.aapmains.net'),
    'https://gooz.aapmains.net/playlist/9/load-playlist',
  );
  assert.strictEqual(parseEmbedPlaylist('<html>no source</html>', 'https://x.y'), null);
});

test('LEAGUE_BY_PATH maps cfb -> NCAAF and covers the nav tabs', () => {
  assert.strictEqual(LEAGUE_BY_PATH['/watch/cfb-streams'], 'NCAAF');
  assert.strictEqual(LEAGUE_BY_PATH['/watch/mlb-streams'], 'MLB');
  assert.strictEqual(Object.keys(LEAGUE_BY_PATH).length, 11);
});

// thetvapp.plus league page, Nov 2026, trimmed.
const CARDS = `
<section class="games" data-game-group="live">
  <a class="game" data-league-id="320" data-game data-sport="NBA" data-status="live"
     data-search="Boston Celtics vs Orlando Magic NBA" href="https://thetvapp.plus/tv-live/nba/orlando-magic-boston-celtics/9276190672">
    <span class="league-tag"><span class="sport-icon" aria-hidden="true">🏀</span>NBA</span>
    <span class="matchup">Boston Celtics vs Orlando Magic</span>
    <span><span class="badge-time">7:00 PM ET</span><small class="d-block">Nov 16</small></span>
    <span class="watch">Watch</span>
  </a>
</section>
<section class="games" data-game-group="soon">
  <a class="game" data-game data-sport="NBA" data-status="soon" href="https://thetvapp.plus/tv-live/nba/denver-nuggets-phoenix-suns/9276230264">
    <span class="matchup">Phoenix Suns vs Denver Nuggets</span>
    <span><span class="badge-time">9:00 PM ET</span><small class="d-block">Nov 16</small></span>
  </a>
  <a class="game" data-status="final" href="/tv-live/nba/a-b/1"><span class="matchup">A vs B</span></a>
  <a class="game" data-status="soon" href="/tv-live/nba/no-matchup/2"></a>
</section>`;

test('parseLeagueListing reads thetvapp.plus game cards', () => {
  const rows = parseLeagueListing(CARDS, 'NBA');
  assert.deepStrictEqual(rows, [
    {
      href: '/tv-live/nba/orlando-magic-boston-celtics/9276190672',
      matchup: 'Boston Celtics vs Orlando Magic',
      timeText: 'In Progress',
      league: 'NBA',
    },
    {
      href: '/tv-live/nba/denver-nuggets-phoenix-suns/9276230264',
      matchup: 'Phoenix Suns vs Denver Nuggets',
      timeText: 'Nov 16 9:00 PM ET',
      league: 'NBA',
    },
    { href: '/tv-live/nba/a-b/1', matchup: 'A vs B', timeText: 'Final', league: 'NBA' },
  ]);
  // A live card counts as started; a dated one defers to the watch page.
  assert.strictEqual(parseRelativeStartSec(rows[0].timeText, 100), 100);
  assert.strictEqual(parseRelativeStartSec(rows[1].timeText, 100), null);
  assert.ok(isEndedBadge(rows[2].timeText));
});
