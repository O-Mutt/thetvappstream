const test = require('node:test');
const assert = require('node:assert');
const { runWithConcurrency } = require('../ChannelManager');

test('runWithConcurrency processes every item exactly once and preserves index order in results', async () => {
  const items = Array.from({ length: 12 }, (_, i) => i);
  const results = await runWithConcurrency(items, 4, async n => n * 10);
  assert.deepStrictEqual(results, [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110]);
});

test('runWithConcurrency respects the concurrency limit', async () => {
  let inflight = 0;
  let peak = 0;
  const items = Array.from({ length: 20 }, (_, i) => i);

  await runWithConcurrency(items, 4, async () => {
    inflight++;
    peak = Math.max(peak, inflight);
    await new Promise(r => setTimeout(r, 5));
    inflight--;
  });

  assert.ok(peak <= 4, `peak inflight ${peak} exceeded limit 4`);
  assert.ok(peak >= 2, `peak inflight ${peak} suggests workers did not run in parallel`);
});

test('runWithConcurrency works when items.length < limit', async () => {
  const items = ['a', 'b'];
  const results = await runWithConcurrency(items, 8, async x => x.toUpperCase());
  assert.deepStrictEqual(results, ['A', 'B']);
});

test('runWithConcurrency returns empty array for empty input', async () => {
  const out = await runWithConcurrency([], 4, async () => {
    throw new Error('worker should not run');
  });
  assert.deepStrictEqual(out, []);
});
