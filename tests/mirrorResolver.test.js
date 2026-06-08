const test = require('node:test');
const assert = require('node:assert');
const MirrorResolver = require('../MirrorResolver');

// probe that reports a fixed set of URLs as live
const liveSet = (...live) => {
  const set = new Set(live);
  return async url => set.has(url);
};

test('normalizes input: trims, strips trailing slashes, dedupes', () => {
  const r = new MirrorResolver('t', ['https://a.tld/', ' https://a.tld ', 'https://b.tld']);
  assert.deepStrictEqual(r.urls, ['https://a.tld', 'https://b.tld']);
});

test('throws when no usable urls are given', () => {
  assert.throws(() => new MirrorResolver('t', []), /no candidate urls/);
  assert.throws(() => new MirrorResolver('t', ['', '   ']), /no candidate urls/);
});

test('active() defaults to the first candidate before any resolve', () => {
  const r = new MirrorResolver('t', ['https://a.tld', 'https://b.tld']);
  assert.strictEqual(r.active(), 'https://a.tld');
});

test('resolve() selects the first live mirror in order', async () => {
  const r = new MirrorResolver('t', ['https://a.tld', 'https://b.tld', 'https://c.tld'], {
    probe: liveSet('https://b.tld', 'https://c.tld'),
  });
  const live = await r.resolve();
  assert.strictEqual(live, 'https://b.tld');
  assert.strictEqual(r.active(), 'https://b.tld');
});

test('resolve() returns null and leaves active unchanged when all are dead', async () => {
  const r = new MirrorResolver('t', ['https://a.tld', 'https://b.tld'], { probe: liveSet() });
  const live = await r.resolve();
  assert.strictEqual(live, null);
  assert.strictEqual(r.active(), 'https://a.tld');
});

test('rotate() skips the current mirror and moves to the next live one', async () => {
  const r = new MirrorResolver('t', ['https://a.tld', 'https://b.tld', 'https://c.tld'], {
    // a (current) is dead, c is live
    probe: liveSet('https://c.tld'),
  });
  const live = await r.rotate();
  assert.strictEqual(live, 'https://c.tld');
  assert.strictEqual(r.active(), 'https://c.tld');
});

test('rotate() wraps around the ring back to an earlier live mirror', async () => {
  const r = new MirrorResolver('t', ['https://a.tld', 'https://b.tld'], {
    probe: liveSet('https://a.tld'),
  });
  // active starts at a; pretend a just failed -> rotate probes b (dead) then a (live)
  const live = await r.rotate();
  assert.strictEqual(live, 'https://a.tld');
});

test('rotate() is a no-op for a single-url resolver', async () => {
  let probed = 0;
  const r = new MirrorResolver('t', ['https://only.tld'], {
    probe: async () => {
      probed++;
      return true;
    },
  });
  assert.strictEqual(await r.rotate(), 'https://only.tld');
  assert.strictEqual(probed, 0, 'single-url rotate should not probe');
});

test('a throwing probe is treated as not-live, not a crash', async () => {
  const r = new MirrorResolver('t', ['https://a.tld', 'https://b.tld'], {
    probe: async url => {
      if (url === 'https://a.tld') throw new Error('boom');
      return true;
    },
  });
  assert.strictEqual(await r.resolve(), 'https://b.tld');
});
