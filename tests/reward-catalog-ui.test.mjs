import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('reward catalog renders a table and an accessible add dialog', async () => {
  const page = await read('../src/Ahm/Pages/Home.razor');

  assert.match(page, /<table[^>]*aria-label="Reward catalog"/);
  assert.match(page, /id="add-reward"[^>]*@onclick="OpenAddRewardDialog"/);
  assert.match(page, /<dialog[^>]*id="reward-dialog"[^>]*aria-labelledby="reward-dialog-title"/);
  assert.match(page, /@onsubmit="SaveRewardDraft"/);
  assert.match(page, /Leave blank for unlimited stock/);
});

test('reward dialog helper uses the native modal API and restores focus support', async () => {
  const store = await read('../src/Ahm/wwwroot/js/store.js');

  assert.match(store, /dialog\.showModal\(\)/);
  assert.match(store, /focusById\(id\)/);
});
