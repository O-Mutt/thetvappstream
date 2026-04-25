const test = require('node:test');
const assert = require('node:assert');
const { baseUrlFor } = require('../baseUrl');

function fakeReq({ protocol = 'http', host = 'localhost:5000' } = {}) {
  return { protocol, get: header => (header.toLowerCase() === 'host' ? host : undefined) };
}

test('baseUrlFor uses the override when provided', () => {
  const req = fakeReq({ protocol: 'http', host: 'irrelevant.test' });
  assert.strictEqual(
    baseUrlFor(req, 'https://thetvapp-proxy.example.com'),
    'https://thetvapp-proxy.example.com',
  );
});

test('baseUrlFor strips a trailing slash from the override', () => {
  assert.strictEqual(baseUrlFor(fakeReq(), 'https://example.com/'), 'https://example.com');
});

test('baseUrlFor falls back to request scheme + host when no override', () => {
  const req = fakeReq({ protocol: 'https', host: 'thetvapp-proxy.example.com' });
  assert.strictEqual(baseUrlFor(req, ''), 'https://thetvapp-proxy.example.com');
});

test('baseUrlFor preserves a non-default port in the host header', () => {
  const req = fakeReq({ protocol: 'http', host: '10.1.1.42:5000' });
  assert.strictEqual(baseUrlFor(req, undefined), 'http://10.1.1.42:5000');
});

test('baseUrlFor empty-string override is treated as "no override"', () => {
  const req = fakeReq({ protocol: 'https', host: 'svc.example' });
  assert.strictEqual(baseUrlFor(req, ''), 'https://svc.example');
});
