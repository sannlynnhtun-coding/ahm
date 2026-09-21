import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/member.js';

const shopUrl = 'https://script.google.com/macros/s/AKfycb-test_1/exec';
const token = '11111111-2222-4333-8444-555555555555';

function response() {
  return {
    statusCode: 200,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('encrypted member links hide routing details, reject tampering, and resolve only the matching shop', async () => {
  const previousKey = process.env.MEMBER_LINK_KEY;
  const previousFetch = globalThis.fetch;
  process.env.MEMBER_LINK_KEY = 'ab'.repeat(32);
  const requests = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url: String(url), body });
    return { ok: true, json: async () => ({
      ok: true, schemaVersion: 2, shopName: 'Test Shop', policy: { maxStamps: 10 }, rewards: [{ id: token, name: 'Coffee', type: 'FREE_ITEM', active: true }],
      member: { token, name: 'Test Member', phone: '09123456789', stamps: 3, spendRemainder: 5000, rewardCredits: 1, claims: [], availableCashback: 0, lifetimeCashback: 0, history: [] }
    }) };
  };
  try {
    let res = response();
    await handler({ method: 'POST', body: { url: shopUrl, token } }, res);
    assert.equal(res.statusCode, 200);
    const code = res.body.code;
    assert.match(code, /^v1\.[A-Za-z0-9_-]+$/);
    assert.equal(code.includes('script.google.com'), false);
    assert.equal(code.includes(token), false);
    assert.equal(requests.length, 0);

    res = response();
    await handler({ method: 'GET', query: { code } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.member.name, 'Test Member');
    assert.equal('token' in res.body.member, false);
    assert.equal('url' in res.body, false);
    assert.equal(res.body.member.spendRemainder, 5000);
    assert.equal(res.body.member.rewardCredits, 1);
    assert.equal(res.body.schemaVersion, 2);
    assert.equal(res.body.rewards[0].name, 'Coffee');
    assert.equal(requests.at(-1).body.action, 'member');

    res = response();
    await handler({ method: 'POST', body: { action: 'claim', code, rewardId: token, requestId: 'a'.repeat(32) } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(requests.at(-1).body.action, 'claim');
    assert.equal(requests.at(-1).body.token, token);
    assert.equal('url' in res.body, false);
    assert.equal('token' in res.body.member, false);

    res = response();
    await handler({ method: 'POST', body: { code, url: shopUrl, pin: 'long-test-pin' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(requests.at(-1).body.action, 'find');
    assert.equal(requests.at(-1).body.pin, 'long-test-pin');

    res = response();
    await handler({ method: 'POST', body: { code, url: 'https://script.google.com/macros/s/other/exec', pin: 'long-test-pin' } }, res);
    assert.equal(res.statusCode, 400);

    res = response();
    const tampered = code.slice(0, -1) + (code.endsWith('A') ? 'B' : 'A');
    await handler({ method: 'GET', query: { code: tampered } }, res);
    assert.equal(res.statusCode, 400);

    res = response();
    await handler({ method: 'POST', body: { url: 'https://example.com', token } }, res);
    assert.equal(res.statusCode, 400);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.MEMBER_LINK_KEY;
    else process.env.MEMBER_LINK_KEY = previousKey;
  }
});
