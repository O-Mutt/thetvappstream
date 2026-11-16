const test = require('node:test');
const assert = require('node:assert');
const { SourceRanker } = require('../SourceRanker');

function clock(start = 1_000_000) {
  const c = { t: start, now: () => c.t, advance: ms => (c.t += ms) };
  return c;
}

const src = (providerName, ref, height) =>
  height ? { providerName, ref, quality: { height } } : { providerName, ref };

const keys = list => list.map(s => `${s.providerName}:${s.ref}`);

test('higher quality ranks first, regardless of provider order', () => {
  const r = new SourceRanker({ minHeight: 720 });
  const order = new Map([
    ['a', 0],
    ['b', 1],
  ]);
  const ranked = r.rank([src('a', 'sd', 480), src('a', 'hd', 720), src('b', 'fhd', 1080)], {
    providerOrder: order,
  });
  assert.deepStrictEqual(keys(ranked), ['b:fhd', 'a:hd', 'a:sd']);
});

test('unknown quality sits between HD and sub-floor sources', () => {
  const r = new SourceRanker({ minHeight: 720 });
  const ranked = r.rank([src('a', 'sd', 360), src('a', 'unknown'), src('a', 'hd', 720)]);
  assert.deepStrictEqual(keys(ranked), ['a:hd', 'a:unknown', 'a:sd']);
});

test('with the floor off, a low height is just HD-class', () => {
  const r = new SourceRanker({ minHeight: 0 });
  const ranked = r.rank([src('a', 'unknown'), src('a', 'sd', 360)]);
  assert.deepStrictEqual(keys(ranked), ['a:sd', 'a:unknown']);
});

test('at equal quality, http sources beat browser sources, then provider order decides', () => {
  const r = new SourceRanker();
  const ranked = r.rank([src('dl', '1'), src('tv', '2'), src('m3u', '3')], {
    providerOrder: new Map([
      ['dl', 0],
      ['tv', 1],
      ['m3u', 2],
    ]),
    costOf: name => (name === 'dl' ? 'browser' : 'http'),
  });
  assert.deepStrictEqual(keys(ranked), ['tv:2', 'm3u:3', 'dl:1']);
});

test('a measured height overrides the provider hint', () => {
  const r = new SourceRanker({ minHeight: 720 });
  const claimsFhd = src('a', 'x', 1080);
  r.recordSuccess(claimsFhd, { height: 360 });
  assert.strictEqual(r.heightOf(claimsFhd), 360);
  const ranked = r.rank([claimsFhd, src('b', 'y', 720)]);
  assert.deepStrictEqual(keys(ranked), ['b:y', 'a:x']);
});

test('a failed source drops below healthy ones and recovers after its cooldown', () => {
  const c = clock();
  const r = new SourceRanker({ now: c.now, baseCooldownMs: 1000, maxCooldownMs: 10_000 });
  const best = src('a', 'best', 1080);
  const other = src('b', 'other', 720);
  r.recordFailure(best, 'boom');
  assert.deepStrictEqual(keys(r.rank([best, other])), ['b:other', 'a:best']);
  c.advance(1001);
  assert.deepStrictEqual(keys(r.rank([best, other])), ['a:best', 'b:other']);
});

test('cooldown doubles with each consecutive failure, up to the cap, and resets on success', () => {
  const c = clock();
  const r = new SourceRanker({
    now: c.now,
    baseCooldownMs: 1000,
    maxCooldownMs: 3000,
    providerFailureThreshold: 99,
  });
  const s = src('a', 'x');
  r.recordFailure(s);
  r.recordFailure(s);
  c.advance(1500);
  assert.ok(r.sourceDegraded(s), 'second failure means a 2s cooldown');
  r.recordFailure(s);
  r.recordFailure(s);
  c.advance(2999);
  assert.ok(r.sourceDegraded(s));
  c.advance(2);
  assert.ok(!r.sourceDegraded(s), 'capped at 3s');
  r.recordFailure(s);
  r.recordSuccess(s);
  assert.ok(!r.sourceDegraded(s));
});

test('a provider failing across channels is demoted as a whole', () => {
  const c = clock();
  const r = new SourceRanker({
    now: c.now,
    baseCooldownMs: 1,
    providerFailureThreshold: 3,
    providerWindowMs: 60_000,
  });
  for (const ref of ['1', '2', '3']) r.recordFailure(src('dead', ref));
  c.advance(10);
  // 'dead:fresh' never failed itself, but its provider has.
  const ranked = r.rank([src('dead', 'fresh', 1080), src('ok', 'y', 720)]);
  assert.deepStrictEqual(keys(ranked), ['ok:y', 'dead:fresh']);

  r.recordSuccess(src('dead', 'fresh'));
  assert.ok(!r.providerDegraded('dead'));
});

test('degraded sources stay in the list so they are still tried last', () => {
  const r = new SourceRanker();
  const s = src('a', 'x');
  r.recordFailure(s);
  assert.deepStrictEqual(keys(r.rank([s])), ['a:x']);
});

test('explain reports the ranked order with reasons', () => {
  const r = new SourceRanker({ minHeight: 720 });
  r.recordFailure(src('a', 'x'), 'did not validate');
  const out = r.explain([src('a', 'x', 1080), src('b', 'y', 480)], {
    costOf: n => (n === 'b' ? 'browser' : 'http'),
  });
  assert.deepStrictEqual(
    out.map(o => [o.provider, o.quality, o.cost, o.degraded]),
    [
      ['b', 'low', 'browser', false],
      ['a', 'fhd', 'http', true],
    ],
  );
  assert.strictEqual(out[1].lastError, 'did not validate');
});
