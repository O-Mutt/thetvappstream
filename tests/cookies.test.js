const test = require('node:test');
const assert = require('node:assert');
const ChannelManager = require('../ChannelManager');

test('_ingestCookies parses Set-Cookie headers and _cookieHeader joins names+values', () => {
  const cm = new ChannelManager();
  cm._ingestCookies([
    'XSRF-TOKEN=abc123; Path=/; Secure',
    'thetvapp_session=xyz789; HttpOnly; Path=/',
  ]);
  assert.strictEqual(cm._cookieHeader(), 'XSRF-TOKEN=abc123; thetvapp_session=xyz789');
});

test('_ingestCookies replaces existing cookies with the same name (no duplicates)', () => {
  const cm = new ChannelManager();
  cm._ingestCookies(['session=v1; Path=/']);
  cm._ingestCookies(['session=v2; Path=/']);
  assert.strictEqual(cm._cookieHeader(), 'session=v2');
  assert.strictEqual(cm.cookieJar.length, 1, 'jar should hold one entry, not two');
});

test('_ingestCookies preserves unrelated cookies during a refresh', () => {
  const cm = new ChannelManager();
  cm._ingestCookies(['a=1; Path=/', 'b=2; Path=/']);
  cm._ingestCookies(['b=updated; Path=/']);
  assert.strictEqual(cm._cookieHeader(), 'a=1; b=updated');
});

test('_ingestCookies tolerates undefined / empty inputs', () => {
  const cm = new ChannelManager();
  cm._ingestCookies(undefined);
  cm._ingestCookies(null);
  cm._ingestCookies([]);
  assert.strictEqual(cm._cookieHeader(), '');
});

test('_cookieHeader returns empty string when jar is empty', () => {
  const cm = new ChannelManager();
  assert.strictEqual(cm._cookieHeader(), '');
});
