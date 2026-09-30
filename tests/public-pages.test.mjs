import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('raw homepage identifies Ahm and explains its Google data use without login', async () => {
  const homepage = await read('../src/Ahm/wwwroot/index.html');

  assert.match(homepage, /<h1[^>]*>Ahm\s+— a staff-assisted loyalty workspace/i);
  assert.match(homepage, /available without signing in/i);
  assert.match(homepage, /drive\.file/);
  assert.match(homepage, /href="\/privacy"/);
  assert.match(homepage, /not sold, used for advertising or credit decisions/i);
  assert.match(homepage, /<meta name="google-site-verification" content="[A-Za-z0-9_-]+" \/>/);
});

test('privacy policy covers Google verification disclosures', async () => {
  const privacy = await read('../src/Ahm/wwwroot/privacy.html');

  for (const disclosure of [
    'Google user data Ahm accesses',
    'How Google user data is used',
    'Storage and retention',
    'Sharing and disclosure',
    'Security',
    'Google API Limited Use',
    'deletion requests'
  ]) {
    assert.match(privacy, new RegExp(disclosure, 'i'));
  }

  assert.match(privacy, /drive\.file/);
  assert.match(privacy, /does not use Google APIs to generate or process non-consensual intimate imagery/i);
  assert.match(privacy, /sannlynnhtun\.developer@gmail\.com/i);
});

test('Vercel serves dedicated public legal pages', async () => {
  const config = JSON.parse(await read('../vercel.json'));
  const rewrites = new Map(config.rewrites.map(({ source, destination }) => [source, destination]));

  assert.equal(rewrites.get('/privacy'), '/privacy.html');
  assert.equal(rewrites.get('/terms'), '/terms.html');
});
