import test from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest } from '../src/Ahm/wwwroot/js/google-sheets.js';

function jsonResponse(status, body = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

test('apiRequest sends the bearer token only in the authorization header', async () => {
  const calls = [];
  const token = 'memory-only-access-token';
  const body = JSON.stringify({ values: [['event-id', 'PURCHASE_RECORDED']] });
  const result = await apiRequest('https://sheets.googleapis.com/v4/spreadsheets/sheet-id/values/Event_Ledger:append', {
    method: 'POST', body
  }, {
    token,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(200, { updates: { updatedRows: 1 } });
    }
  });

  assert.deepEqual(result, { updates: { updatedRows: 1 } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.get('Authorization'), `Bearer ${token}`);
  assert.equal(calls[0].options.headers.get('Content-Type'), 'application/json');
  assert.equal(calls[0].url.includes(token), false);
  assert.equal(calls[0].options.body.includes(token), false);
});

test('apiRequest retries quota and service-unavailable responses with exponential delays', async () => {
  const statuses = [429, 503, 200];
  const delays = [];
  const bodies = [];
  const requestBody = JSON.stringify({ values: [['stable-event-id']] });

  const result = await apiRequest('https://sheets.googleapis.com/v4/test', {
    method: 'POST', body: requestBody
  }, {
    token: 'token',
    sleep: async milliseconds => delays.push(milliseconds),
    fetch: async (_url, options) => {
      bodies.push(options.body);
      const status = statuses.shift();
      return jsonResponse(status, status === 200 ? { ok: true } : { error: { message: 'retry' } });
    }
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(delays, [250, 500]);
  assert.deepEqual(bodies, [requestBody, requestBody, requestBody]);
});

test('apiRequest retries transient network errors without changing the request', async () => {
  let attempts = 0;
  const delays = [];
  const optionsSeen = [];
  const result = await apiRequest('https://sheets.googleapis.com/v4/test', {
    method: 'POST', body: '{"eventId":"same-on-retry"}'
  }, {
    token: 'token',
    sleep: async milliseconds => delays.push(milliseconds),
    fetch: async (_url, options) => {
      attempts++;
      optionsSeen.push(options.body);
      if (attempts === 1) throw new TypeError('network unavailable');
      return jsonResponse(200, { recovered: true });
    }
  });

  assert.deepEqual(result, { recovered: true });
  assert.deepEqual(delays, [250]);
  assert.deepEqual(optionsSeen, ['{"eventId":"same-on-retry"}', '{"eventId":"same-on-retry"}']);
});

test('apiRequest does not retry authentication or permission failures', async () => {
  for (const [status, expectedMessage] of [[401, 'AUTH_EXPIRED'], [403, 'Permission denied']]) {
    let attempts = 0;
    const delays = [];
    await assert.rejects(
      apiRequest('https://sheets.googleapis.com/v4/test', {}, {
        token: 'token',
        sleep: async milliseconds => delays.push(milliseconds),
        fetch: async () => {
          attempts++;
          return jsonResponse(status, { error: { message: 'Permission denied' } });
        }
      }),
      error => {
        assert.equal(error.message, expectedMessage);
        if (status === 403) assert.equal(error.status, 403);
        return true;
      }
    );
    assert.equal(attempts, 1);
    assert.deepEqual(delays, []);
  }
});

test('apiRequest stops after four retryable responses', async () => {
  let attempts = 0;
  const delays = [];
  await assert.rejects(
    apiRequest('https://sheets.googleapis.com/v4/test', {}, {
      token: 'token',
      sleep: async milliseconds => delays.push(milliseconds),
      fetch: async () => {
        attempts++;
        return jsonResponse(429, { error: { message: 'Quota exceeded' } });
      }
    }),
    error => error.message === 'Quota exceeded' && error.status === 429
  );
  assert.equal(attempts, 4);
  assert.deepEqual(delays, [250, 500, 1_000]);
});

test('apiRequest returns null for an empty successful response', async () => {
  const result = await apiRequest('https://sheets.googleapis.com/v4/test', {}, {
    token: 'token', fetch: async () => new Response(null, { status: 204 })
  });
  assert.equal(result, null);
});
