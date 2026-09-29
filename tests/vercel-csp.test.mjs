import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const config = JSON.parse(
  await readFile(new URL('../vercel.json', import.meta.url), 'utf8')
);

function contentSecurityPolicy() {
  return config.headers
    .flatMap(rule => rule.headers ?? [])
    .find(header => header.key.toLowerCase() === 'content-security-policy')
    ?.value;
}

function directives(policy) {
  return new Map(
    policy.split(';').map(value => {
      const [name, ...sources] = value.trim().split(/\s+/);
      return [name, new Set(sources)];
    })
  );
}

test('Vercel Toolbar resources are allowed by the deployment CSP', () => {
  const policy = contentSecurityPolicy();
  assert.ok(policy, 'Content-Security-Policy header is configured');

  const csp = directives(policy);
  const expectedSources = {
    'script-src': ['https://vercel.live'],
    'connect-src': ['https://vercel.live', 'wss://ws-us3.pusher.com'],
    'img-src': ['https://vercel.live', 'https://vercel.com'],
    'frame-src': ['https://vercel.live'],
    'style-src': ['https://vercel.live'],
    'font-src': ['https://vercel.live', 'https://assets.vercel.com']
  };

  for (const [directive, sources] of Object.entries(expectedSources)) {
    assert.ok(csp.has(directive), `${directive} is configured`);
    for (const source of sources) {
      assert.ok(csp.get(directive).has(source), `${directive} allows ${source}`);
    }
  }
});
