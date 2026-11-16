const test = require('node:test');
const assert = require('node:assert');
const { rewriteManifest, proxyUri, isManifest } = require('../hlsProxy');

const BASE = 'https://proxy.example.com';
const MANIFEST_URL = 'https://cdn.newkso.ru/key/premium51/mono.m3u8';
const SID = 'daddylive:51';

test('proxyUri resolves relative segment URIs and routes them through /hlsseg', () => {
  const out = proxyUri('seg-1.ts', MANIFEST_URL, BASE, SID);
  assert.match(out, /^https:\/\/proxy\.example\.com\/hlsseg\/daddylive%3A51\?u=/);
  const u = new URL(out);
  assert.strictEqual(
    decodeURIComponent(u.searchParams.get('u')),
    'https://cdn.newkso.ru/key/premium51/seg-1.ts',
  );
});

test('rewriteManifest rewrites segment lines but leaves tags intact', () => {
  const m3u8 = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXTINF:6.0,',
    'seg-1.ts',
    '#EXTINF:6.0,',
    'https://cdn.newkso.ru/key/premium51/seg-2.ts',
  ].join('\n');
  const out = rewriteManifest(m3u8, MANIFEST_URL, BASE, SID);
  assert.match(out, /#EXTM3U/);
  assert.match(out, /#EXTINF:6\.0,/);
  // both segments routed through the proxy
  assert.strictEqual((out.match(/\/hlsseg\//g) || []).length, 2);
  assert.doesNotMatch(out, /^seg-1\.ts$/m);
});

test('rewriteManifest rewrites URI="" attributes (EXT-X-KEY / MEDIA / MAP)', () => {
  const m3u8 = [
    '#EXTM3U',
    '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x0',
    '#EXT-X-STREAM-INF:BANDWIDTH=1',
    'variant.m3u8',
  ].join('\n');
  const out = rewriteManifest(m3u8, MANIFEST_URL, BASE, SID);
  assert.match(out, /URI="https:\/\/proxy\.example\.com\/hlsseg\/[^"]*key\.bin[^"]*"/);
  assert.match(out, /\/hlsseg\/[^\n]*variant\.m3u8/);
});

test('isManifest detects m3u8 by extension or content-type', () => {
  assert.ok(isManifest('https://x/y.m3u8'));
  assert.ok(isManifest('https://x/y.m3u8?token=1'));
  assert.ok(isManifest('https://x/y', 'application/vnd.apple.mpegurl'));
  assert.ok(!isManifest('https://x/seg.ts', 'video/mp2t'));
});

test('rewriteManifest preserves EXT-X-ENDLIST tag unchanged', () => {
  const m3u8 = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXTINF:6.0,',
    'seg-last.ts',
    '#EXT-X-ENDLIST',
  ].join('\n');
  const out = rewriteManifest(m3u8, MANIFEST_URL, BASE, SID);
  assert.match(out, /^#EXT-X-ENDLIST\s*$/m);
});

const { Readable, PassThrough } = require('node:stream');
const { looksLikeManifest, fetchManifest, createHlsHandlers } = require('../hlsProxy');

test('looksLikeManifest accepts a BOM/whitespace-prefixed #EXTM3U only', () => {
  assert.ok(looksLikeManifest('#EXTM3U\n#EXTINF:6,\na.ts'));
  assert.ok(looksLikeManifest('﻿  #EXTM3U'));
  assert.ok(!looksLikeManifest('<html>403</html>'));
  assert.ok(!looksLikeManifest(''));
});

test('fetchManifest rejects error pages and empty #EXTM3U shells', async () => {
  const http = body => ({
    get: async () => ({
      status: 200,
      headers: {},
      data: Readable.from([Buffer.from(body)]),
      request: {},
    }),
  });
  assert.ok(await fetchManifest('u', {}, { http: http('#EXTM3U\n#EXTINF:6,\na.ts') }));
  assert.ok(
    await fetchManifest('u', {}, { http: http('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv.m3u8') }),
  );
  assert.strictEqual(await fetchManifest('u', {}, { http: http('#EXTM3U\n') }), null);
  assert.strictEqual(await fetchManifest('u', {}, { http: http('<html>blocked</html>') }), null);
  const notFound = {
    get: async () => ({ status: 404, headers: {}, data: Readable.from([Buffer.from('#EXTM3U')]) }),
  };
  assert.strictEqual(await fetchManifest('u', {}, { http: notFound }), null);
});

// Minimal express-like response backed by a writable so pipe() works.
function fakeRes() {
  const res = new PassThrough();
  const chunks = [];
  res.on('data', c => chunks.push(c));
  res.statusCode = 200;
  res.headers = {};
  res.status = code => ((res.statusCode = code), res);
  res.type = t => ((res.headers['content-type'] = t), res);
  res.set = (k, v) => ((res.headers[k.toLowerCase()] = v), res);
  res.send = body => {
    res.end(body);
    return res;
  };
  res.body = () =>
    new Promise(resolve => res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))));
  return res;
}

function segmentHandler(upstream) {
  return createHlsHandlers({
    lookupHeaders: () => ({ Referer: 'https://embed/' }),
    baseUrlFor: () => BASE,
    http: { get: async () => upstream },
  });
}

test('segment rewrites a nested manifest served from an extensionless octet-stream url', async () => {
  const hls = segmentHandler({
    status: 200,
    headers: { 'content-type': 'application/octet-stream' },
    data: Readable.from([Buffer.from('#EXTM3U\n#EXTINF:6,\nseg-1.ts\n')]),
    request: {},
  });
  const res = fakeRes();
  const done = res.body();
  await hls.segment(
    {
      params: { streamId: SID },
      query: { u: 'https://cdn.x/playlist/7/load-playlist' },
      headers: {},
    },
    res,
  );
  const out = await done;
  assert.match(out, /^#EXTM3U/);
  assert.match(out, /\/hlsseg\/daddylive%3A51\?u=https%3A%2F%2Fcdn\.x%2Fplaylist%2F7%2Fseg-1\.ts/);
});

test('segment streams binary payloads through untouched', async () => {
  const payload = Buffer.from([0x47, 0x40, 0x00, 0x10, 0xff]);
  const hls = segmentHandler({
    status: 200,
    headers: { 'content-type': 'application/octet-stream' },
    data: Readable.from([payload.subarray(0, 2), payload.subarray(2)]),
    request: {},
  });
  const res = fakeRes();
  const chunks = [];
  res.removeAllListeners('data');
  res.on('data', c => chunks.push(c));
  const ended = new Promise(r => res.on('end', r));
  await hls.segment(
    { params: { streamId: SID }, query: { u: 'https://cdn.x/a.ts' }, headers: {} },
    res,
  );
  await ended;
  assert.deepStrictEqual(Buffer.concat(chunks), payload);
});

const { probeStream } = require('../hlsProxy');

function streamHttp(status, ctype, chunks) {
  const body = Readable.from(chunks.map(c => Buffer.from(c)));
  return {
    body,
    http: {
      get: async () => ({ status, headers: { 'content-type': ctype }, data: body, request: {} }),
    },
  };
}

test('probeStream classifies HLS, direct media, and error pages', async () => {
  const hlsP = await probeStream(
    'u',
    {},
    streamHttp(200, 'text/plain', ['#EXTM3U\n#EXTINF:6,\na.ts']),
  );
  assert.strictEqual(hlsP.kind, 'hls');

  const ts = streamHttp(200, 'video/mp2t', [Buffer.from([0x47, 0x40]), Buffer.from([0x00])]);
  const direct = await probeStream('u', {}, ts);
  assert.deepStrictEqual(direct, { kind: 'direct', contentType: 'video/mp2t', finalUrl: 'u' });
  assert.ok(ts.body.destroyed, 'a continuous feed is not downloaded past its first chunk');

  assert.strictEqual(
    await probeStream('u', {}, streamHttp(200, 'text/html', ['<html>no</html>'])),
    null,
  );
  assert.strictEqual(await probeStream('u', {}, streamHttp(403, 'video/mp2t', ['x'])), null);
});

test('passthrough relays a header-locked non-HLS body with its headers', async () => {
  let sent;
  const hls = createHlsHandlers({
    lookupHeaders: () => null,
    baseUrlFor: () => BASE,
    http: {
      get: async (_url, opts) => {
        sent = opts.headers;
        return {
          status: 200,
          headers: { 'content-type': 'video/mp2t' },
          data: Readable.from([Buffer.from([0x47, 1]), Buffer.from([2])]),
        };
      },
    },
  });
  const res = fakeRes();
  const chunks = [];
  res.removeAllListeners('data');
  res.on('data', c => chunks.push(c));
  const ended = new Promise(r => res.on('end', r));
  await hls.passthrough({ headers: {} }, res, {
    url: 'https://c/x.ts',
    headers: { Referer: 'https://r/' },
  });
  await ended;
  assert.deepStrictEqual(sent, { Referer: 'https://r/' });
  assert.strictEqual(res.headers['content-type'], 'video/mp2t');
  assert.deepStrictEqual(Buffer.concat(chunks), Buffer.from([0x47, 1, 2]));
});

const { filterLowVariants, maxVariantHeight, absolutizeManifest } = require('../hlsProxy');

const MASTER = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=426x240',
  'low/index.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720',
  'mid/index.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080',
  'high/index.m3u8',
].join('\n');

test('maxVariantHeight reads the tallest rendition, null for a media playlist', () => {
  assert.strictEqual(maxVariantHeight(MASTER), 1080);
  assert.strictEqual(maxVariantHeight('#EXTM3U\n#EXTINF:6,\na.ts'), null);
});

test('filterLowVariants drops sub-floor renditions and their URIs', () => {
  const out = filterLowVariants(MASTER, 720);
  assert.doesNotMatch(out, /240|low\/index/);
  assert.match(out, /mid\/index\.m3u8/);
  assert.match(out, /high\/index\.m3u8/);
});

test('filterLowVariants leaves a master alone when nothing would remain', () => {
  const allLow =
    '#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=640x360\na.m3u8\n#EXT-X-STREAM-INF:RESOLUTION=426x240\nb.m3u8';
  assert.strictEqual(filterLowVariants(allLow, 720), allLow);
});

test('filterLowVariants keeps renditions with no RESOLUTION and ignores media playlists', () => {
  const mixed =
    '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nnores.m3u8\n#EXT-X-STREAM-INF:RESOLUTION=426x240\nlow.m3u8\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080\nhi.m3u8';
  const out = filterLowVariants(mixed, 720);
  assert.match(out, /nores\.m3u8/);
  assert.doesNotMatch(out, /low\.m3u8/);
  const media = '#EXTM3U\n#EXTINF:6,\na.ts';
  assert.strictEqual(filterLowVariants(media, 720), media);
  assert.strictEqual(filterLowVariants(MASTER, 0), MASTER);
});

test('absolutizeManifest pins relative URIs to the upstream playlist', () => {
  const out = absolutizeManifest(MASTER, 'https://cdn.x/live/master.m3u8?tok=1');
  assert.match(out, /^https:\/\/cdn\.x\/live\/high\/index\.m3u8$/m);
});

test('probeStream reports the tallest rendition of a master playlist', async () => {
  const { http } = streamHttp(200, 'application/vnd.apple.mpegurl', [MASTER]);
  const p = await probeStream('https://cdn.x/m.m3u8', {}, { http });
  assert.strictEqual(p.height, 1080);
});

test('serveFilteredMaster serves the filtered master with upstream variant URIs', async () => {
  const hls = createHlsHandlers({
    lookupHeaders: () => null,
    baseUrlFor: () => BASE,
    minHeight: 720,
  });
  const res = fakeRes();
  const done = res.body();
  const served = hls.serveFilteredMaster(res, {
    url: 'https://cdn.x/live/master.m3u8',
    manifest: { kind: 'hls', text: MASTER, finalUrl: 'https://cdn.x/live/master.m3u8' },
  });
  assert.strictEqual(served, true);
  const out = await done;
  assert.doesNotMatch(out, /low\/index/);
  assert.match(out, /^https:\/\/cdn\.x\/live\/mid\/index\.m3u8$/m);
  assert.doesNotMatch(out, /hlsseg/, 'segments still go straight upstream');
});

test('serveFilteredMaster declines when there is nothing to filter', () => {
  const hls = createHlsHandlers({
    lookupHeaders: () => null,
    baseUrlFor: () => BASE,
    minHeight: 720,
  });
  const res = fakeRes();
  const media = {
    kind: 'hls',
    text: '#EXTM3U\n#EXTINF:6,\na.ts',
    finalUrl: 'https://cdn.x/a.m3u8',
  };
  assert.strictEqual(hls.serveFilteredMaster(res, { url: 'u', manifest: media }), false);
  assert.strictEqual(hls.serveFilteredMaster(res, { url: 'u', manifest: null }), false);
});

const { splitFallback } = require('../hlsProxy');

const SF_PRIMARY = 'https://p16.tiktokcdn.example/seg/abc.js';
const SF_OWN = 'https://cdn1.strmfree.example/live-externalcdn/x1080p/seg-5.js?_t=a&_e=1';
const SF_LINE = `${SF_PRIMARY}#sf=${encodeURIComponent(SF_OWN)}`;

test('splitFallback separates a "#sf=" primary from its decoded fallback', () => {
  assert.deepStrictEqual(splitFallback(SF_LINE), { primary: SF_PRIMARY, fallback: SF_OWN });
  assert.strictEqual(splitFallback('https://cdn.x/a.ts'), null);
  assert.strictEqual(splitFallback(`${SF_PRIMARY}#sf=not-a-url`), null);
});

test('rewriteManifest keeps the "#sf=" fallback inside the proxied url', () => {
  const out = rewriteManifest(`#EXTM3U\n#EXTINF:4,\n${SF_LINE}\n`, MANIFEST_URL, BASE, SID);
  const line = out.split('\n').find(l => l.includes('/hlsseg/'));
  assert.strictEqual(new URL(line).searchParams.get('u'), SF_LINE);
});

function recordingSegmentHandler(byUrl) {
  const calls = [];
  const hls = createHlsHandlers({
    lookupHeaders: () => ({ Referer: 'https://embed/' }),
    baseUrlFor: () => BASE,
    http: {
      get: async url => {
        calls.push(url);
        const r = byUrl[url];
        if (r instanceof Error) throw r;
        return {
          status: r.status,
          headers: { 'content-type': 'video/mp2t' },
          data: Readable.from([Buffer.from(r.body || '')]),
          request: {},
        };
      },
    },
  });
  return { hls, calls };
}

async function fetchSegment(hls, u) {
  const res = fakeRes();
  const done = res.body();
  await hls.segment({ params: { streamId: SID }, query: { u }, headers: {} }, res);
  return { status: res.statusCode, body: await done };
}

test('segment falls back to the "#sf=" url when the primary is refused', async () => {
  const { hls, calls } = recordingSegmentHandler({
    [SF_PRIMARY]: { status: 403 },
    [SF_OWN]: { status: 200, body: 'own-cdn' },
  });
  const out = await fetchSegment(hls, SF_LINE);
  assert.deepStrictEqual(calls, [SF_PRIMARY, SF_OWN]);
  assert.strictEqual(out.body, 'own-cdn');
});

test('segment falls back to the "#sf=" url when the primary errors', async () => {
  const { hls } = recordingSegmentHandler({
    [SF_PRIMARY]: new Error('ETIMEDOUT'),
    [SF_OWN]: { status: 200, body: 'own-cdn' },
  });
  assert.strictEqual((await fetchSegment(hls, SF_LINE)).body, 'own-cdn');
});

test('segment uses the "#sf=" primary when it answers', async () => {
  const { hls, calls } = recordingSegmentHandler({
    [SF_PRIMARY]: { status: 200, body: 'tiktok' },
  });
  assert.strictEqual((await fetchSegment(hls, SF_LINE)).body, 'tiktok');
  assert.deepStrictEqual(calls, [SF_PRIMARY]);
});
