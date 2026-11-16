const test = require('node:test');
const assert = require('node:assert');
const StreamFreeProvider = require('../providers/streamfree');
const {
  parseStreams,
  parseEmbed,
  parseRef,
  playlistPath,
  tokenQuery,
  qualityHeight,
} = require('../providers/streamfree/parse');

// Shaped after GET /api/v1/streams on 2026-11-16, trimmed.
const NOW = 1794841200; // 2026-11-16T15:00:00Z
const LISTING = {
  count: 6,
  streams: [
    {
      id: 'moldova-vs-faroe-islands',
      name: 'Moldova vs Faroe Islands',
      category: 'soccer',
      league: 'UEFA Nations League',
      stream_key: 'moldova-vs-faroe-islands',
      match_timestamp: NOW,
      sources: [
        { quality: 'FHD', url: 'https://strmfree.st/embed/soccer/moldova-vs-faroe-islands1080p' },
        { quality: 'HD', url: 'https://strmfree.st/embed/soccer/moldova-vs-faroe-islands720p2' },
      ],
    },
    {
      id: 'malta-vs-gibraltar',
      name: 'Malta vs Gibraltar',
      category: 'soccer',
      league: 'UEFA Nations League',
      stream_key: 'malta-vs-gibraltar',
      match_timestamp: NOW + 5 * 3600,
      sources: [],
    },
    {
      id: 'dac18f6b-2340-4b28-b4fe-5f4682753764',
      name: 'RedZone',
      category: 'football',
      league: 'NFL',
      stream_key: 'redzone',
      match_timestamp: 1789318200,
      sources: [{ quality: 'FHD', url: 'https://strmfree.st/embed/football/redzone1080p' }],
    },
    {
      // A game nobody cleaned up: old, but its id is its key, so not a channel.
      id: 'old-game',
      name: 'Old vs Game',
      category: 'soccer',
      league: 'X',
      stream_key: 'old-game',
      match_timestamp: NOW - 3 * 86400,
      sources: [],
    },
    {
      id: 'far-future',
      name: 'Far vs Future',
      category: 'hockey',
      league: 'NHL',
      stream_key: 'far-future',
      match_timestamp: NOW + 5 * 86400,
      sources: [],
    },
    { id: 'broken', name: 'No key', category: 'soccer', match_timestamp: NOW },
  ],
};

const TOKENS = {
  '1080p': { _e: 1794853335, _n: 'n1', _s: 's1', _sa: 'sa1', _t: 't1', _ta: 'ta1' },
  '720p': { _e: 1794853335, _n: 'n2', _s: 's2', _sa: 'sa2', _t: 't2', _ta: 'ta2' },
};

// The parts of the real embed page the resolver reads.
function embedPage({ key = 'moldova-vs-faroe-islands', quality = '1080p', suffix = '' } = {}) {
  return `<html><script>
        const STREAM_NAME = 'Moldova vs Faroe Islands';
        const SOURCE_SUFFIX = '${suffix}';
        const QUALITY = '${quality}';
        const VARIANT = '${key}' + QUALITY + SOURCE_SUFFIX;
        const _0x = ${JSON.stringify(TOKENS)};
        async function getStreamSource() {
          const data = await window.sfFetch('/get-stream-key/${key}').then(r => r.json());
        }
  </script></html>`;
}

test('parseStreams splits games from 24/7 channels and keeps source quality', () => {
  const { events, channels } = parseStreams(LISTING, { nowSec: NOW, displayTz: 'UTC' });

  assert.deepStrictEqual(channels, [
    { name: 'RedZone', ref: 'k:football/redzone', group: 'Sports' },
  ]);
  assert.deepStrictEqual(
    events.map(e => e.name),
    ['Moldova vs Faroe Islands @ Nov 16 3:00 PM UTC', 'Malta vs Gibraltar @ Nov 16 8:00 PM UTC'],
  );

  const [game, upcoming] = events;
  assert.strictEqual(game.league, 'UEFA Nations League');
  assert.strictEqual(game.category, 'soccer');
  assert.strictEqual(game.sport, 'soccer');
  assert.strictEqual(game.endSec - game.startSec, 135 * 60, 'soccer runs 2h15');
  assert.deepStrictEqual(game.streamRef, {
    ref: 'v:soccer/moldova-vs-faroe-islands1080p',
    quality: { height: 1080 },
  });
  assert.deepStrictEqual(game.altStreamRefs, [
    { ref: 'v:soccer/moldova-vs-faroe-islands720p2', quality: { height: 720 } },
  ]);
  // No source yet: look one up at tune time instead of dropping the game.
  assert.strictEqual(upcoming.streamRef, 'k:soccer/malta-vs-gibraltar');
});

test('qualityHeight maps listing labels and player quality ids', () => {
  assert.strictEqual(qualityHeight('SD'), 480);
  assert.strictEqual(qualityHeight('HD'), 720);
  assert.strictEqual(qualityHeight('FHD'), 1080);
  assert.strictEqual(qualityHeight('4K'), 2160);
  assert.strictEqual(qualityHeight('540p'), 540);
  assert.strictEqual(qualityHeight('weird'), null);
});

test('parseRef reads both ref kinds and rejects anything else', () => {
  assert.deepStrictEqual(parseRef('v:soccer/a-vs-b1080p2'), {
    kind: 'variant',
    category: 'soccer',
    id: 'a-vs-b1080p2',
  });
  assert.deepStrictEqual(parseRef('k:football/redzone'), {
    kind: 'key',
    category: 'football',
    id: 'redzone',
  });
  assert.strictEqual(parseRef('redzone'), null);
});

test('parseEmbed extracts the token sets, the quality and the stream key', () => {
  const out = parseEmbed(
    embedPage({ quality: '720p', suffix: '2' }),
    'moldova-vs-faroe-islands720p2',
  );
  assert.deepStrictEqual(out.tokens, TOKENS);
  assert.strictEqual(out.quality, '720p');
  assert.strictEqual(out.streamKey, 'moldova-vs-faroe-islands');
});

test('parseEmbed falls back to the variant id when the page markup changes', () => {
  const out = parseEmbed('<html></html>', 'ufc-3201080p2');
  assert.strictEqual(out.tokens, null);
  assert.strictEqual(out.quality, '1080p');
  assert.strictEqual(out.streamKey, 'ufc-320');
});

test('playlistPath follows the player: externalcdn, any other CDN, origin', () => {
  assert.strictEqual(playlistPath('externalcdn', 'v1080p'), '/live-externalcdn/v1080p/index.m3u8');
  assert.strictEqual(playlistPath('cdn', 'v1080p'), '/live-cdn/v1080p/index.m3u8');
  assert.strictEqual(playlistPath('cdn2', 'v1080p'), '/live-cdn/v1080p/index.m3u8');
  assert.strictEqual(playlistPath('origin', 'v1080p'), '/live/v1080p/index.m3u8');
  assert.strictEqual(playlistPath(undefined, 'v1080p'), '/live/v1080p/index.m3u8');
});

test('tokenQuery orders the params like the player', () => {
  assert.strictEqual(
    tokenQuery(TOKENS['1080p']),
    '?_t=t1&_ta=ta1&_e=1794853335&_n=n1&_s=s1&_sa=sa1',
  );
});

const MIRROR = 'https://m.example';

function provider(routes, opts = {}) {
  const calls = [];
  const p = new StreamFreeProvider({
    urls: [MIRROR],
    now: () => NOW * 1000,
    ...opts,
  });
  p.client = {
    get: async (url, cfg = {}) => {
      calls.push({ url, headers: cfg.headers || {} });
      const r = routes[url];
      if (r instanceof Error) throw r;
      if (!r) return { status: 404, data: 'not found' };
      return { status: 200, ...r };
    },
  };
  p.mirrors.rotate = async () => null;
  return { p, calls };
}

test('resolveStream builds the CDN playlist url with tokens and the segment headers', async () => {
  const { p, calls } = provider({
    [`${MIRROR}/embed/soccer/moldova-vs-faroe-islands1080p`]: { data: embedPage() },
    [`${MIRROR}/get-stream-key/moldova-vs-faroe-islands`]: {
      data: { stream_key: 'moldova-vs-faroe-islands', is_external: false, server_name: 'cdn' },
    },
  });
  const out = await p.resolveStream('v:soccer/moldova-vs-faroe-islands1080p');
  assert.strictEqual(
    out.url,
    `${MIRROR}/live-cdn/moldova-vs-faroe-islands1080p/index.m3u8` +
      '?_t=t1&_ta=ta1&_e=1794853335&_n=n1&_s=s1&_sa=sa1',
  );
  assert.strictEqual(out.headers.Referer, `${MIRROR}/`);
  assert.strictEqual(out.headers.Origin, MIRROR);
  assert.deepStrictEqual(out.quality, { height: 1080 });
  assert.strictEqual(calls[0].headers.Referer, `${MIRROR}/`);
});

test('resolveStream uses the origin path when get-stream-key fails, as the player does', async () => {
  const { p } = provider({
    [`${MIRROR}/embed/soccer/moldova-vs-faroe-islands1080p`]: { data: embedPage() },
    [`${MIRROR}/get-stream-key/moldova-vs-faroe-islands`]: new Error('ECONNRESET'),
  });
  const out = await p.resolveStream('v:soccer/moldova-vs-faroe-islands1080p');
  assert.match(out.url, /\/live\/moldova-vs-faroe-islands1080p\/index\.m3u8\?_t=t1/);
});

test('resolveStream returns an external url as-is', async () => {
  const { p } = provider({
    [`${MIRROR}/embed/soccer/moldova-vs-faroe-islands1080p`]: { data: embedPage() },
    [`${MIRROR}/get-stream-key/moldova-vs-faroe-islands`]: {
      data: { is_external: true, external_url: 'https://elsewhere.example/x.m3u8' },
    },
  });
  const out = await p.resolveStream('v:soccer/moldova-vs-faroe-islands1080p');
  assert.strictEqual(out.url, 'https://elsewhere.example/x.m3u8');
});

test('a key ref plays the highest live source', async () => {
  const { p } = provider({
    [`${MIRROR}/api/v1/sources/redzone`]: {
      data: {
        sources: [
          { quality: 'HD', url: 'https://strmfree.st/embed/football/redzone720p', live: true },
          { quality: 'FHD', url: 'https://strmfree.st/embed/football/redzone1080p2', live: true },
          { quality: '4K', url: 'https://strmfree.st/embed/football/redzone2160p3', live: false },
        ],
      },
    },
    [`${MIRROR}/embed/football/redzone1080p2`]: {
      data: embedPage({ key: 'redzone', quality: '1080p', suffix: '2' }),
    },
    [`${MIRROR}/get-stream-key/redzone`]: { data: { server_name: 'externalcdn' } },
  });
  const out = await p.resolveStream('k:football/redzone');
  assert.match(out.url, /\/live-externalcdn\/redzone1080p2\/index\.m3u8\?/);
});

test('a key ref with nothing live fails so the next source is tried', async () => {
  const { p } = provider({
    [`${MIRROR}/api/v1/sources/redzone`]: {
      data: { sources: [{ quality: 'FHD', url: 'https://x/embed/football/redzone1080p' }] },
    },
  });
  await assert.rejects(p.resolveStream('k:football/redzone'), /nothing live/);
});

test('refreshEvents loads the listing once per cache window', async () => {
  const { p, calls } = provider({ [`${MIRROR}/api/v1/streams`]: { data: LISTING } });
  await p.refreshEvents();
  await p.refreshEvents();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual((await p.listEvents()).length, 2);
  assert.deepStrictEqual(
    (await p.listLinearChannels()).map(c => c.name),
    ['RedZone'],
  );
  assert.deepStrictEqual((await p.getEpgData()).items, [
    { name: 'RedZone', chid: 'k:football/redzone', logo: null },
  ]);
});

test('refreshEvents keeps unfinished games when the listing fails', async () => {
  const { p } = provider({ [`${MIRROR}/api/v1/streams`]: new Error('ECONNREFUSED') });
  p.eventsCache = [
    { name: 'live', endSec: NOW + 60 },
    { name: 'over', endSec: NOW - 60 },
  ];
  await p.refreshEvents();
  assert.deepStrictEqual(
    (await p.listEvents()).map(e => e.name),
    ['live'],
  );
});

test('linear channels can be turned off', async () => {
  const { p } = provider(
    { [`${MIRROR}/api/v1/streams`]: { data: LISTING } },
    { enableLinear: false },
  );
  await p.refreshEvents();
  assert.deepStrictEqual(await p.listLinearChannels(), []);
  assert.deepStrictEqual((await p.getEpgData()).items, []);
});

test('ensureReady puts the mirror directory ahead of the configured list', async () => {
  const { p } = provider(
    {
      'https://dir.example/api/domains': { data: ['strmfree.pk', 'bad domain!'] },
      'https://strmfree.pk/api/v1/categories': { data: { categories: [] } },
    },
    { directoryUrl: 'https://dir.example/api/domains' },
  );
  await p.ensureReady();
  assert.deepStrictEqual(p.mirrors.urls, ['https://strmfree.pk', MIRROR]);
  assert.strictEqual(p.base(), 'https://strmfree.pk');
});

test('ensureReady keeps the configured list when the directory is down', async () => {
  const { p } = provider(
    {
      'https://dir.example/api/domains': new Error('ENOTFOUND'),
      [`${MIRROR}/api/v1/categories`]: { data: [] },
    },
    { directoryUrl: 'https://dir.example/api/domains' },
  );
  await p.ensureReady();
  assert.deepStrictEqual(p.mirrors.urls, [MIRROR]);
});
