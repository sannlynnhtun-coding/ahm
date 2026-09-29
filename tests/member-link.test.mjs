import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { derivePublicShopId, sealLegacyCode } from '../api/member.js';

const shopUrl = 'https://script.google.com/macros/s/AKfycb-test_1/exec';
const otherShopUrl = 'https://script.google.com/macros/s/AKfycb-test_2/exec';
const token = '11111111-2222-4333-8444-555555555555';

function response() {
  return {
    statusCode: 200,
    headers: {},
    ended: false,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { this.ended = true; return this; }
  };
}

function assertPrivateHeaders(res) {
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer');
  assert.equal(res.headers['X-Robots-Tag'], 'noindex, nofollow');
}

test('legacy encrypted link redirects to the staff-only member route without reading customer data', async () => {
  const previousKey = process.env.MEMBER_LINK_KEY;
  const previousFetch = globalThis.fetch;
  process.env.MEMBER_LINK_KEY = 'ab'.repeat(32);
  let fetchCount = 0;
  globalThis.fetch = async () => { fetchCount++; throw new Error('Legacy redirect must not fetch Apps Script.'); };
  try {
    const code = sealLegacyCode(shopUrl, token);
    const res = response();
    await handler({ method: 'GET', query: { code } }, res);

    assert.equal(res.statusCode, 302);
    assert.equal(res.ended, true);
    assert.equal(res.headers.Location, `/member?s=legacy_uUaLcO6gcfM3tg1anYIaFdjd&t=${token}`);
    assert.equal(res.headers.Location.includes('script.google.com'), false);
    assert.equal(fetchCount, 0);
    assertPrivateHeaders(res);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.MEMBER_LINK_KEY;
    else process.env.MEMBER_LINK_KEY = previousKey;
  }
});

test('legacy public shop IDs are stable, key-derived, and distinct per Apps Script URL', async () => {
  const previousKey = process.env.MEMBER_LINK_KEY;
  process.env.MEMBER_LINK_KEY = 'ab'.repeat(32);
  try {
    assert.equal(derivePublicShopId(shopUrl), 'legacy_uUaLcO6gcfM3tg1anYIaFdjd');
    assert.equal(derivePublicShopId(shopUrl), derivePublicShopId(shopUrl));
    assert.notEqual(derivePublicShopId(shopUrl), derivePublicShopId(otherShopUrl));

    let res = response();
    await handler({ method: 'POST', body: { action: 'legacy-shop-id', url: shopUrl } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, publicShopId: 'legacy_uUaLcO6gcfM3tg1anYIaFdjd' });
    assertPrivateHeaders(res);

    res = response();
    await handler({ method: 'POST', body: { action: 'legacy-path', url: shopUrl, token } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.path, `/member?s=legacy_uUaLcO6gcfM3tg1anYIaFdjd&t=${token}`);
    assert.equal(JSON.stringify(res.body).includes(shopUrl), false);
  } finally {
    if (previousKey === undefined) delete process.env.MEMBER_LINK_KEY;
    else process.env.MEMBER_LINK_KEY = previousKey;
  }
});

test('legacy endpoint rejects tampering, unsupported mutations, and missing encryption configuration', async () => {
  const previousKey = process.env.MEMBER_LINK_KEY;
  try {
    process.env.MEMBER_LINK_KEY = 'ab'.repeat(32);
    const code = sealLegacyCode(shopUrl, token);
    const tampered = code.slice(0, -1) + (code.endsWith('A') ? 'B' : 'A');

    let res = response();
    await handler({ method: 'GET', query: { code: tampered } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'Invalid member link.');
    assertPrivateHeaders(res);

    res = response();
    await handler({ method: 'POST', body: { action: 'claim', code, rewardId: token } }, res);
    assert.equal(res.statusCode, 410);
    assert.match(res.body.error, /no longer supported/i);

    res = response();
    await handler({ method: 'PUT', body: {} }, res);
    assert.equal(res.statusCode, 405);

    delete process.env.MEMBER_LINK_KEY;
    res = response();
    await handler({ method: 'GET', query: { code } }, res);
    assert.equal(res.statusCode, 503);
    assert.match(res.body.error, /not configured/i);
    assertPrivateHeaders(res);
  } finally {
    if (previousKey === undefined) delete process.env.MEMBER_LINK_KEY;
    else process.env.MEMBER_LINK_KEY = previousKey;
  }
});
