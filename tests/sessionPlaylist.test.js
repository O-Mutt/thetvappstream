const test = require('node:test');
const assert = require('node:assert');
const {
  parseMediaPlaylist,
  chooseRendition,
  renderSession,
  spliceOffset,
} = require('../sessionPlaylist');

function media(seq, n, { target = 6, extra = {}, endList = false, version = 3 } = {}) {
  const out = ['#EXTM3U', `#EXT-X-VERSION:${version}`, `#EXT-X-TARGETDURATION:${target}`];
  out.push(`#EXT-X-MEDIA-SEQUENCE:${seq}`);
  for (let i = 0; i < n; i++) {
    if (extra[seq + i]) out.push(...extra[seq + i]);
    out.push('#EXTINF:6.0,', `seg-${seq + i}.ts`);
  }
  if (endList) out.push('#EXT-X-ENDLIST');
  return out.join('\n');
}

const fresh = () => ({ offset: 0, lastSeq: -1, discontinuities: new Set(), discontinuitySeq: 0 });
const ident = u => u;
const seqOf = text => Number(/#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(text)[1]);
const discSeqOf = text => Number(/#EXT-X-DISCONTINUITY-SEQUENCE:(\d+)/.exec(text)[1]);
const uris = text => text.split('\n').filter(l => l && !l.startsWith('#'));

test('parseMediaPlaylist keeps per-segment tags and reads the header', () => {
  const p = parseMediaPlaylist(
    media(100, 3, {
      extra: { 101: ['#EXT-X-DISCONTINUITY', '#EXT-X-KEY:METHOD=AES-128,URI="k1"'] },
      endList: true,
    }),
  );
  assert.strictEqual(p.mediaSequence, 100);
  assert.strictEqual(p.targetDuration, 6);
  assert.strictEqual(p.version, 3);
  assert.ok(p.endList);
  assert.deepStrictEqual(
    p.segments.map(s => [s.uri, s.discontinuity]),
    [
      ['seg-100.ts', false],
      ['seg-101.ts', true],
      ['seg-102.ts', false],
    ],
  );
  assert.deepStrictEqual(p.segments[1].tags, [
    '#EXT-X-KEY:METHOD=AES-128,URI="k1"',
    '#EXTINF:6.0,',
  ]);
});

test('parseMediaPlaylist rejects masters and non-playlists', () => {
  assert.strictEqual(parseMediaPlaylist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv.m3u8'), null);
  assert.strictEqual(parseMediaPlaylist('<html>'), null);
});

test('a session renders the upstream window under its own numbering', () => {
  const state = fresh();
  const out = renderSession(parseMediaPlaylist(media(100, 3)), state, u => `https://cdn/${u}`);
  assert.strictEqual(seqOf(out), 100);
  assert.strictEqual(discSeqOf(out), 0);
  assert.deepStrictEqual(uris(out), [
    'https://cdn/seg-100.ts',
    'https://cdn/seg-101.ts',
    'https://cdn/seg-102.ts',
  ]);
  assert.strictEqual(state.lastSeq, 102);
});

test('a splice continues numbering after the last segment served and marks a discontinuity', () => {
  const state = fresh();
  renderSession(parseMediaPlaylist(media(100, 3)), state, ident);

  // The new source numbers its segments from 7.
  const next = parseMediaPlaylist(media(7, 3));
  spliceOffset(next, state);
  const out = renderSession(next, state, ident);
  assert.strictEqual(seqOf(out), 103);
  const lines = out.split('\n');
  assert.strictEqual(lines[lines.indexOf('#EXT-X-DISCONTINUITY') + 2], 'seg-7.ts');
  assert.strictEqual(discSeqOf(out), 0);

  // Once the joined segment slides out of the window, the discontinuity
  // sequence counts it.
  const later = renderSession(parseMediaPlaylist(media(8, 3)), state, ident);
  assert.strictEqual(seqOf(later), 104);
  assert.ok(!later.includes('#EXT-X-DISCONTINUITY\n'));
  assert.strictEqual(discSeqOf(later), 1);
});

test('upstream discontinuities, keys and init maps stay with their segments', () => {
  const state = fresh();
  const text = media(5, 2, {
    extra: { 5: ['#EXT-X-MAP:URI="init.mp4"'], 6: ['#EXT-X-DISCONTINUITY'] },
  });
  const out = renderSession(parseMediaPlaylist(text), state, u => `P(${u})`);
  assert.match(out, /#EXT-X-MAP:URI="P\(init\.mp4\)"\n#EXTINF:6\.0,\nP\(seg-5\.ts\)/);
  assert.match(out, /#EXT-X-DISCONTINUITY\n#EXTINF:6\.0,\nP\(seg-6\.ts\)/);
});

test('target duration covers the longest segment served', () => {
  const text = '#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:6.4,\na.ts\n';
  assert.match(renderSession(parseMediaPlaylist(text), fresh(), ident), /#EXT-X-TARGETDURATION:7/);
});

const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
360.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720
720.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080
1080.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=7000000,RESOLUTION=1920x1080
1080b.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=20000000,RESOLUTION=3840x2160
2160.m3u8`;

test('chooseRendition takes the tallest at or below 1080, higher bandwidth on a tie', () => {
  assert.deepStrictEqual(chooseRendition(MASTER, 'https://cdn/x/master.m3u8', 720), {
    url: 'https://cdn/x/1080b.m3u8',
    height: 1080,
  });
});

test('chooseRendition falls back to the tallest when all are above 1080, and respects the floor', () => {
  const uhd =
    '#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=3840x2160\na.m3u8\n#EXT-X-STREAM-INF:RESOLUTION=2560x1440\nb.m3u8';
  assert.strictEqual(chooseRendition(uhd, 'https://c/m.m3u8').height, 2160);
  const low =
    '#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=640x360\na.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=9\nb.m3u8';
  // A rendition with no stated height outranks one known to be below the floor.
  assert.strictEqual(chooseRendition(low, 'https://c/m.m3u8', 720).url, 'https://c/b.m3u8');
});

test('chooseRendition declines renditions whose audio is a separate playlist', () => {
  const sep = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="en",URI="audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080,AUDIO="aud"
v.m3u8`;
  assert.deepStrictEqual(chooseRendition(sep, 'https://c/m.m3u8'), { separateAudio: true });
  const muxedToo = `${sep}\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720\nmuxed.m3u8`;
  assert.strictEqual(chooseRendition(muxedToo, 'https://c/m.m3u8').url, 'https://c/muxed.m3u8');
  assert.strictEqual(chooseRendition('#EXTM3U\n#EXTINF:6,\na.ts', 'https://c/m.m3u8'), null);
});
