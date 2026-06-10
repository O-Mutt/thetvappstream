const { test } = require('node:test');
const assert = require('node:assert');
const DaddyLiveProvider = require('../providers/daddylive');

test('listLinearChannels returns {} and makes no request when linear disabled', async () => {
  const p = new DaddyLiveProvider({ enableLinear: false });
  // Trip the test if it tries to hit the network.
  p.client.get = () => {
    throw new Error('should not fetch when linear disabled');
  };
  assert.deepStrictEqual(await p.listLinearChannels(), {});
  assert.deepStrictEqual(await p.getEpgData(), { items: [], programmesByChid: {} });
});

test('linear enabled by default', () => {
  const p = new DaddyLiveProvider({});
  assert.strictEqual(p.enableLinear, true);
});
