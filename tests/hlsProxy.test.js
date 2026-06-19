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
