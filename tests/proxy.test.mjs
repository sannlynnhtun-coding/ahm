import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/sheets.js';

function response() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('relay rejects other hosts and forwards only a deployed Apps Script URL', async () => {
  const originalFetch = globalThis.fetch;
  let forwarded;
  globalThis.fetch = async (url, options) => {
    forwarded = { url: String(url), options };
    return { ok: true, text: async () => JSON.stringify({ ok: true, member: null }) };
  };
  try {
    let res = response();
    await handler({ method: 'POST', body: { url: 'https://example.com/exec', action: 'find' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(forwarded, undefined);
    res = response();
    await handler({ method: 'POST', body: { url: 'https://script.google.com/macros/s/AKfycb-test_1/exec', action: 'find', pin: 'test-pin' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(forwarded.url, 'https://script.google.com/macros/s/AKfycb-test_1/exec');
    assert.equal(forwarded.options.method, 'POST');
    assert.equal(JSON.parse(forwarded.options.body).pin, 'test-pin');
    assert.equal(forwarded.options.redirect, 'follow');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
