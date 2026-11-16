const test = require('node:test');
const assert = require('node:assert');
const PlaybackSessions = require('../PlaybackSessions');

function media(seq, n, { endList = false } = {}) {
  const out = ['#EXTM3U', '#EXT-X-TARGETDURATION:6', `#EXT-X-MEDIA-SEQUENCE:${seq}`];
  for (let i = 0; i < n; i++) out.push('#EXTINF:6.0,', `seg-${seq + i}.ts`);
  if (endList) out.push('#EXT-X-ENDLIST');
  return out.join('\n');
}

// `streams` are handed out in order by resolveStream, as ranking would after
// each reported failure. `pages` maps a playlist URL to { status, text } or
// an Error, and can be changed between reloads.
function harness(streams, { pages = {}, ...opts } = {}) {
  const clock = { t: 1_000_000 };
  const calls = { resolve: 0, failures: [], fetches: [], headers: [] };
  const queue = [...streams];
  const aggregator = {
    async resolveStream(id, { validate }) {
      calls.resolve++;
      const next = queue.shift();
      if (!next) throw new Error('no source resolved');
      const check = await validate(next);
      return { ...next, check };
    },
    reportFailure(id, reason) {
      calls.failures.push(reason);
    },
  };
  const sessions = new PlaybackSessions({
    aggregator,
    probe: async url => {
      const p = pages[url];
      return p && !(p instanceof Error) && p.status === 200
        ? { kind: 'hls', text: p.text, finalUrl: url }
        : null;
    },
    fetchText: async url => {
      calls.fetches.push(url);
      const p = pages[url];
      if (p instanceof Error) throw p;
      if (!p) return { status: 404, text: '' };
      return { status: p.status, text: p.text, finalUrl: url };
    },
    proxyUri: (abs, base, id) => `${base}/hlsseg/${id}/seg.ts?u=${encodeURIComponent(abs)}`,
    setHeaders: (id, h) => calls.headers.push([id, h]),
    now: () => clock.t,
    ...opts,
  });
  const serve = () => sessions.serve('ch', { base: 'http://me' });
  return { sessions, serve, clock, calls, pages };
}

const A = 'https://a.example/live.m3u8';
const B = 'https://b.example/live.m3u8';
const seqOf = text => Number(/#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(text)[1]);

test('a healthy source is re-served under stable numbering with direct segment urls', async () => {
  const h = harness([{ url: A }], { pages: { [A]: { status: 200, text: media(10, 3) } } });
  const first = await h.serve();
  assert.strictEqual(first.kind, 'playlist');
  assert.match(first.text, /^https:\/\/a\.example\/seg-10\.ts$/m);

  h.clock.t += 6000;
  h.pages[A] = { status: 200, text: media(11, 3) };
  const second = await h.serve();
  assert.strictEqual(seqOf(second.text), 11);
  assert.strictEqual(h.calls.resolve, 1);
  assert.deepStrictEqual(h.calls.failures, []);
});

test('a source that starts refusing is replaced and spliced in after the last segment', async () => {
  const h = harness([{ url: A }, { url: B }], {
    pages: { [A]: { status: 200, text: media(10, 3) }, [B]: { status: 200, text: media(500, 3) } },
  });
  await h.serve();
  h.clock.t += 6000;
  h.pages[A] = { status: 403, text: 'expired' };

  const out = await h.serve();
  assert.deepStrictEqual(h.calls.failures, ['playlist answered 403']);
  assert.strictEqual(seqOf(out.text), 13, 'continues after seg 12');
  assert.match(out.text, /#EXT-X-DISCONTINUITY\n#EXTINF:6\.0,\nhttps:\/\/b\.example\/seg-500\.ts/);
  assert.strictEqual(h.sessions.describe('ch').splices, 1);
});

test('an ended or unreachable playlist also fails over', async () => {
  for (const dead of [
    { status: 200, text: media(10, 3, { endList: true }) },
    new Error('ECONNRESET'),
  ]) {
    const h = harness([{ url: A }, { url: B }], {
      pages: { [A]: { status: 200, text: media(10, 3) }, [B]: { status: 200, text: media(1, 3) } },
    });
    await h.serve();
    h.clock.t += 6000;
    h.pages[A] = dead;
    const out = await h.serve();
    assert.match(out.text, /b\.example/);
    assert.strictEqual(h.calls.failures.length, 1);
  }
});

test('a stalled playlist fails over only after the stall limit', async () => {
  const h = harness([{ url: A }, { url: B }], {
    pages: { [A]: { status: 200, text: media(10, 3) }, [B]: { status: 200, text: media(1, 3) } },
  });
  await h.serve();
  h.clock.t += 20_000; // limit is max(4 x 6 s, 20 s) = 24 s
  assert.match((await h.serve()).text, /a\.example/);
  h.clock.t += 5000;
  const out = await h.serve();
  assert.match(out.text, /b\.example/);
  assert.match(h.calls.failures[0], /stalled for 25s/);
});

test('when nothing else resolves the reload fails and the session restarts on the next one', async () => {
  const h = harness([{ url: A }], { pages: { [A]: { status: 200, text: media(10, 3) } } });
  await h.serve();
  h.clock.t += 6000;
  h.pages[A] = { status: 404, text: '' };
  await assert.rejects(h.serve(), /no source resolved/);
  assert.strictEqual(h.sessions.describe('ch'), null);
});

test('re-resolving to the same playlist does not splice', async () => {
  const h = harness([{ url: A }, { url: A }], {
    pages: { [A]: { status: 200, text: media(10, 3) } },
  });
  await h.serve();
  h.clock.t += 30_000; // stalled
  const out = await h.serve();
  assert.strictEqual(h.sessions.describe('ch').splices, 0);
  assert.ok(!out.text.includes('#EXT-X-DISCONTINUITY\n'));
});

test('a source failing again right after a switch does not re-resolve on every reload', async () => {
  const h = harness([{ url: A }, { url: B }, { url: A }], {
    pages: { [A]: { status: 200, text: media(10, 3) }, [B]: { status: 200, text: media(1, 3) } },
  });
  await h.serve();
  h.clock.t += 6000;
  h.pages[A] = { status: 403, text: '' };
  await h.serve(); // switches to B
  h.pages[B] = { status: 403, text: '' };
  h.clock.t += 6000;
  const out = await h.serve(); // inside the cooldown: keep serving B's last window
  assert.strictEqual(h.calls.resolve, 2);
  assert.match(out.text, /b\.example/);
});

test('concurrent reloads share one upstream check', async () => {
  const h = harness([{ url: A }], { pages: { [A]: { status: 200, text: media(10, 3) } } });
  await h.serve();
  h.clock.t += 6000;
  const before = h.calls.fetches.length;
  await Promise.all([h.serve(), h.serve(), h.serve()]);
  assert.strictEqual(h.calls.fetches.length - before, 1);
});

test('an idle session is dropped and the next reload resolves afresh', async () => {
  const h = harness([{ url: A }, { url: A }], {
    pages: { [A]: { status: 200, text: media(10, 3) } },
  });
  await h.serve();
  h.clock.t += 3 * 60 * 1000;
  await h.serve();
  assert.strictEqual(h.calls.resolve, 2);
});

test('a header-locked source is served through /hlsseg and its headers stored', async () => {
  const headers = { Referer: 'https://embed/' };
  const h = harness([{ url: A, headers }], { pages: { [A]: { status: 200, text: media(10, 2) } } });
  const out = await h.serve();
  assert.match(
    out.text,
    /^http:\/\/me\/hlsseg\/ch\/seg\.ts\?u=https%3A%2F%2Fa\.example%2Fseg-10\.ts$/m,
  );
  assert.deepStrictEqual(h.calls.headers, [['ch', headers]]);
});

test('a master is narrowed to one rendition; separate audio and non-HLS fall back', async () => {
  const MASTER = 'https://m.example/master.m3u8';
  const V = 'https://m.example/1080.m3u8';
  const h = harness([{ url: MASTER }], {
    pages: {
      [MASTER]: {
        status: 200,
        text: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1920x1080\n1080.m3u8',
      },
      [V]: { status: 200, text: media(1, 2) },
    },
  });
  assert.match((await h.serve()).text, /m\.example\/seg-1\.ts/);

  const SEP = 'https://s.example/master.m3u8';
  const sep = harness([{ url: SEP }], {
    pages: {
      [SEP]: {
        status: 200,
        text: '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="au.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1,AUDIO="a"\nv.m3u8',
      },
    },
  });
  const out = await sep.serve();
  assert.strictEqual(out.kind, 'legacy');
  assert.strictEqual(out.stream.url, SEP);

  const ts = harness([{ url: 'https://t.example/feed.ts' }]);
  ts.sessions.probe = async () => ({ kind: 'direct', contentType: 'video/mp2t' });
  assert.strictEqual((await ts.serve()).kind, 'legacy');
});
