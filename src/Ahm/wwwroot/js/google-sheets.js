import { foldLedger, eventToRow, newEvent, SCHEMA_VERSION } from './ledger.js';
import { buildMigrationPlan } from './migration.js';

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TAB_NAMES = ['Ahm_Meta', 'Shop_Config', 'Reward_Catalog', 'Event_Ledger', 'Member_Summary'];
const LEDGER_HEADERS = ['Event_ID', 'Event_Type', 'Member_Token', 'Phone_Number', 'Actor_Label', 'Occurred_At_UTC', 'Payload_JSON', 'Schema_Version'];
const REWARD_HEADERS = ['Reward_ID', 'Name', 'Type', 'Value', 'Max_Discount', 'Stock_Quantity', 'Description', 'Active'];
const SUMMARY_HEADERS = ['Member_Token', 'Phone_Number', 'Customer_Name', 'Current_Stamps', 'Spend_Remainder', 'Reward_Credits', 'Available_Cashback', 'Lifetime_Cashback', 'Last_Visit'];

let config = { clientId: '', apiKey: '', appId: '' };
let accessToken = null;
let expiresAt = 0;
let scripts = new Map();

function value(object, camel, pascal = camel[0].toUpperCase() + camel.slice(1)) {
  return object?.[camel] ?? object?.[pascal];
}

function text(input, max = 256) {
  return String(input ?? '').trim().slice(0, max);
}

function integer(input, fallback = 0) {
  const parsed = Number(input);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function validSheetId(id) {
  return /^[a-zA-Z0-9_-]{20,160}$/.test(String(id || ''));
}

function loadScript(src) {
  if (scripts.has(src)) return scripts.get(src);
  const promise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === 'true') resolve();
      else {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', () => reject(new Error(`Unable to load ${src}`)), { once: true });
      }
      return;
    }
    const tag = document.createElement('script');
    tag.src = src;
    tag.async = true;
    tag.defer = true;
    tag.onload = () => { tag.dataset.loaded = 'true'; resolve(); };
    tag.onerror = () => reject(new Error(`Unable to load ${src}`));
    document.head.appendChild(tag);
  });
  scripts.set(src, promise);
  return promise;
}

function requireConfiguration() {
  if (!config.clientId || !config.apiKey || !config.appId)
    throw new Error('GOOGLE_CONFIG_MISSING');
}

function requireToken() {
  if (!accessToken || Date.now() >= expiresAt - 30_000) {
    accessToken = null;
    expiresAt = 0;
    throw new Error('AUTH_EXPIRED');
  }
  return accessToken;
}

async function authorize() {
  requireConfiguration();
  await loadScript('https://accounts.google.com/gsi/client');
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: config.clientId,
      scope: SCOPE,
      callback: response => {
        if (response?.error || !response?.access_token) {
          reject(new Error(response?.error_description || response?.error || 'GOOGLE_AUTH_FAILED'));
          return;
        }
        accessToken = response.access_token;
        expiresAt = Date.now() + Math.max(0, Number(response.expires_in || 0) * 1000);
        resolve({ connected: true, expiresAt });
      },
      error_callback: response => reject(new Error(response?.message || response?.type || 'GOOGLE_AUTH_CANCELLED'))
    });
    client.requestAccessToken({ prompt: '' });
  });
}

function disconnect() {
  const token = accessToken;
  accessToken = null;
  expiresAt = 0;
  if (token && globalThis.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
}

async function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

export async function apiRequest(url, options = {}, dependencies = {}) {
  const fetcher = dependencies.fetch || fetch;
  const sleeper = dependencies.sleep || delay;
  const token = dependencies.token || requireToken();
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  let lastError;
  for (let attempt = 0; attempt < 4; attempt++) {
    let response;
    try { response = await fetcher(url, { ...options, headers }); }
    catch (error) {
      lastError = error;
      if (attempt === 3) throw error;
      await sleeper(250 * (2 ** attempt));
      continue;
    }
    if (response.status === 401) {
      if (!dependencies.token) { accessToken = null; expiresAt = 0; }
      throw new Error('AUTH_EXPIRED');
    }
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      await sleeper(250 * (2 ** attempt));
      continue;
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const rawMessage = String(body?.error?.message || body?.error || `Google API error ${response.status}`);
      const message = rawMessage.split(token).join('[redacted]');
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    if (response.status === 204) return null;
    return response.json();
  }
  throw lastError || new Error('GOOGLE_API_FAILED');
}

async function loadPicker() {
  requireConfiguration();
  requireToken();
  await loadScript('https://apis.google.com/js/api.js');
  await new Promise((resolve, reject) => {
    try { gapi.load('picker', { callback: resolve, onerror: reject }); }
    catch (error) { reject(error); }
  });
}

async function pickSpreadsheet() {
  await loadPicker();
  return new Promise((resolve, reject) => {
    const view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
      .setIncludeFolders(false)
      .setSelectFolderEnabled(false);
    const picker = new google.picker.PickerBuilder()
      .setAppId(config.appId)
      .setDeveloperKey(config.apiKey)
      .setOAuthToken(requireToken())
      .addView(view)
      .setCallback(data => {
        if (data.action === google.picker.Action.PICKED) {
          const document = data.docs?.[0];
          if (!document?.id) reject(new Error('PICKER_EMPTY'));
          else resolve({ spreadsheetId: document.id, name: document.name || '' });
        } else if (data.action === google.picker.Action.CANCEL) reject(new Error('PICKER_CANCELLED'));
      })
      .build();
    picker.setVisible(true);
  });
}

async function verifyEditable(spreadsheetId) {
  if (!validSheetId(spreadsheetId)) throw new Error('INVALID_SHEET_ID');
  const fields = encodeURIComponent('id,name,mimeType,capabilities(canEdit)');
  const file = await apiRequest(`${DRIVE_API}/${encodeURIComponent(spreadsheetId)}?fields=${fields}&supportsAllDrives=true`);
  if (file.mimeType !== 'application/vnd.google-apps.spreadsheet') throw new Error('NOT_A_GOOGLE_SHEET');
  if (!file.capabilities?.canEdit) throw new Error('SHEET_NOT_EDITABLE');
  return file;
}

function queryRanges(spreadsheetId, ranges) {
  const query = ranges.map(range => `ranges=${encodeURIComponent(range)}`).join('&');
  return `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values:batchGet?majorDimension=ROWS&${query}`;
}

async function readRanges(spreadsheetId, ranges) {
  return apiRequest(queryRanges(spreadsheetId, ranges));
}

async function verifyV3Schema(spreadsheetId) {
  const metadata = await apiRequest(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title`);
  const titles = new Set((metadata.sheets || []).map(sheet => sheet.properties?.title));
  if (TAB_NAMES.some(title => !titles.has(title))) throw new Error('SCHEMA_MISMATCH');
  const meta = await readRanges(spreadsheetId, ['Ahm_Meta!A:B']);
  if (integer(keyValues(meta.valueRanges?.[0]?.values).Schema_Version) !== SCHEMA_VERSION)
    throw new Error('SCHEMA_MISMATCH');
}

async function updateValues(spreadsheetId, data) {
  return apiRequest(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
    method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data })
  });
}

async function clearRange(spreadsheetId, range) {
  return apiRequest(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:clear`, {
    method: 'POST', body: '{}'
  });
}

function keyValues(rows) {
  return Object.fromEntries((rows || []).slice(1).filter(row => row?.[0]).map(row => [String(row[0]), row[1]]));
}

function bool(value, fallback = true) {
  if (value == null || value === '') return fallback;
  return value === true || String(value).toLowerCase() === 'true';
}

function parseRewards(rows) {
  return (rows || []).slice(1).filter(row => row?.[0]).map(row => ({
    id: text(row[0], 128), name: text(row[1], 160), type: text(row[2], 32).toUpperCase(),
    value: integer(row[3]), maxDiscount: integer(row[4]),
    stockQuantity: row[5] === '' || row[5] == null ? null : Math.max(0, integer(row[5])),
    description: text(row[6], 500), active: bool(row[7])
  }));
}

function setupFromRows(spreadsheetId, metadataRows, configRows, rewardRows, fileName = '') {
  const metadata = keyValues(metadataRows);
  const settings = keyValues(configRows);
  if (integer(metadata.Schema_Version) !== SCHEMA_VERSION || !settings.Public_Shop_ID)
    throw new Error('SCHEMA_MISMATCH');
  return {
    spreadsheetId,
    publicShopId: text(settings.Public_Shop_ID, 128),
    shopName: text(settings.Shop_Name || fileName, 160),
    staffLabel: '',
    policy: {
      minSpendPerStamp: Math.max(1, integer(settings.Min_Spend_Per_Stamp, 10000)),
      maxStamps: Math.max(1, integer(settings.Max_Stamps, 10)),
      cashbackReward: Math.max(0, integer(settings.Cashback_Reward, 10000)),
      minWithdrawal: Math.max(1, integer(settings.Min_Withdrawal, 1000)),
      allowRollover: bool(settings.Allow_Rollover)
    },
    rewards: parseRewards(rewardRows)
  };
}

function normalizeSetup(input, spreadsheetId, publicShopId) {
  const policy = value(input, 'policy') || {};
  const rewards = value(input, 'rewards') || [];
  return {
    spreadsheetId: spreadsheetId || text(value(input, 'spreadsheetId'), 160),
    publicShopId: publicShopId || text(value(input, 'publicShopId'), 128),
    shopName: text(value(input, 'shopName'), 160),
    staffLabel: text(value(input, 'staffLabel'), 128),
    policy: {
      minSpendPerStamp: Math.max(1, integer(value(policy, 'minSpendPerStamp'), 10000)),
      maxStamps: Math.min(30, Math.max(1, integer(value(policy, 'maxStamps'), 10))),
      cashbackReward: Math.max(0, integer(value(policy, 'cashbackReward'), 10000)),
      minWithdrawal: Math.max(1, integer(value(policy, 'minWithdrawal'), 1000)),
      allowRollover: value(policy, 'allowRollover') !== false
    },
    rewards: rewards.map(raw => ({
      id: text(value(raw, 'id') || crypto.randomUUID(), 128), name: text(value(raw, 'name'), 160),
      type: text(value(raw, 'type'), 32).toUpperCase(), value: Math.max(0, integer(value(raw, 'value'))),
      maxDiscount: Math.max(0, integer(value(raw, 'maxDiscount'))),
      stockQuantity: value(raw, 'stockQuantity') == null ? null : Math.max(0, integer(value(raw, 'stockQuantity'))),
      description: text(value(raw, 'description'), 500), active: value(raw, 'active') !== false
    }))
  };
}

function configRows(setup) {
  const p = setup.policy;
  return [
    ['Key', 'Value'], ['Schema_Version', SCHEMA_VERSION], ['Shop_Name', setup.shopName],
    ['Public_Shop_ID', setup.publicShopId], ['Min_Spend_Per_Stamp', p.minSpendPerStamp],
    ['Max_Stamps', p.maxStamps], ['Cashback_Reward', p.cashbackReward],
    ['Min_Withdrawal', p.minWithdrawal], ['Allow_Rollover', p.allowRollover]
  ];
}

function rewardRows(setup) {
  return [REWARD_HEADERS, ...setup.rewards.map(r => [r.id, r.name, r.type, r.value, r.maxDiscount, r.stockQuantity ?? '', r.description, r.active])];
}

async function initializeSchema(spreadsheetId, setup, createdSheets = []) {
  const createdAt = new Date().toISOString();
  await updateValues(spreadsheetId, [
    { range: 'Ahm_Meta!A1:B5', values: [['Key', 'Value'], ['Schema_Version', SCHEMA_VERSION], ['Ledger_Order', 'SHEET_ROW_ORDER'], ['Created_At_UTC', createdAt], ['Source_Of_Truth', 'Event_Ledger']] },
    { range: 'Shop_Config!A1:B20', values: configRows(setup) },
    { range: 'Reward_Catalog!A1:H500', values: rewardRows(setup) },
    { range: 'Event_Ledger!A1:H1', values: [LEDGER_HEADERS] },
    { range: 'Member_Summary!A1:I1', values: [SUMMARY_HEADERS] }
  ]);
  await apiRequest(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: 'POST', body: JSON.stringify({ requests: createdSheets.map(sheet => ({
      updateSheetProperties: { properties: { sheetId: sheet.properties.sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' }
    })) })
  }).catch(() => null);
}

async function createShop(input, publicShopIdOverride = '') {
  const publicShopId = publicShopIdOverride || crypto.randomUUID();
  const setup = normalizeSetup(input, '', publicShopId);
  if (!setup.shopName) throw new Error('SHOP_NAME_REQUIRED');
  if (!setup.rewards.some(reward => reward.active)) throw new Error('ACTIVE_REWARD_REQUIRED');
  const created = await apiRequest(SHEETS_API, {
    method: 'POST', body: JSON.stringify({
      properties: { title: `Ahm — ${setup.shopName}` },
      sheets: TAB_NAMES.map(title => ({ properties: { title } }))
    })
  });
  setup.spreadsheetId = created.spreadsheetId;
  await initializeSchema(setup.spreadsheetId, setup, created.sheets || []);
  return loadShop(setup.spreadsheetId, setup.staffLabel);
}

async function loadShop(spreadsheetId, staffLabel = '') {
  const file = await verifyEditable(spreadsheetId);
  await verifyV3Schema(spreadsheetId);
  const response = await readRanges(spreadsheetId, ['Ahm_Meta!A:B', 'Shop_Config!A:B', 'Reward_Catalog!A:H', 'Event_Ledger!A:H']);
  const ranges = response.valueRanges || [];
  const setup = setupFromRows(spreadsheetId, ranges[0]?.values, ranges[1]?.values, ranges[2]?.values, file.name);
  setup.staffLabel = text(staffLabel, 128);
  const folded = foldLedger(ranges[3]?.values || [], setup.rewards);
  return { setup, members: folded.members, diagnostics: folded.diagnostics, stockUsed: folded.stockUsed };
}

async function connectExisting(staffLabel = '') {
  const picked = await pickSpreadsheet();
  return loadShop(picked.spreadsheetId, staffLabel);
}

async function saveConfiguration(input) {
  const setup = normalizeSetup(input);
  await verifyEditable(setup.spreadsheetId);
  await verifyV3Schema(setup.spreadsheetId);
  await Promise.all([
    clearRange(setup.spreadsheetId, 'Shop_Config!A:B'),
    clearRange(setup.spreadsheetId, 'Reward_Catalog!A:H')
  ]);
  await updateValues(setup.spreadsheetId, [
    { range: 'Shop_Config!A1:B20', values: configRows(setup) },
    { range: 'Reward_Catalog!A1:H500', values: rewardRows(setup) }
  ]);
  return loadShop(setup.spreadsheetId, setup.staffLabel);
}

async function rebuildSummary(spreadsheetId, members) {
  const values = [SUMMARY_HEADERS, ...members.map(m => [m.token, m.phone, m.name, m.stamps, m.spendRemainder, m.rewardCredits, m.availableCashback, m.lifetimeCashback, m.lastVisit])];
  try {
    await clearRange(spreadsheetId, 'Member_Summary!A:I');
    await updateValues(spreadsheetId, [{ range: 'Member_Summary!A1:I50000', values }]);
  } catch { /* derived cache is best effort; Event_Ledger remains authoritative */ }
}

async function appendEvent(spreadsheetId, event, staffLabel = '') {
  if (!validSheetId(spreadsheetId)) throw new Error('INVALID_SHEET_ID');
  await verifyEditable(spreadsheetId);
  await verifyV3Schema(spreadsheetId);
  const row = eventToRow(event);
  const range = encodeURIComponent('Event_Ledger!A:H');
  await apiRequest(`${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST', body: JSON.stringify({ majorDimension: 'ROWS', values: row })
  });
  const state = await loadShop(spreadsheetId, staffLabel);
  await rebuildSummary(spreadsheetId, state.members);
  return state;
}

function makeEvent(input) {
  return newEvent(
    text(value(input, 'eventType'), 64).toUpperCase(), text(value(input, 'memberToken'), 128),
    text(value(input, 'phoneNumber'), 64), text(value(input, 'actorLabel'), 128), value(input, 'payload') || {},
    text(value(input, 'eventId'), 128) || undefined
  );
}

async function legacyPublicShopId(gasUrl) {
  const response = await fetch('/api/member', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'legacy-shop-id', url: text(gasUrl, 2048) })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.publicShopId) throw new Error(result.error || 'LEGACY_ID_FAILED');
  return result.publicShopId;
}

async function resolveLegacyPath(gasUrl, token) {
  const response = await fetch('/api/member', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'legacy-path', url: text(gasUrl, 2048), token: text(token, 128) })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.path) throw new Error(result.error || 'LEGACY_PATH_FAILED');
  return result.path;
}

async function migrateLegacy(gasUrl, actorLabel = '') {
  const picked = await pickSpreadsheet();
  await verifyEditable(picked.spreadsheetId);
  const oldMetadata = await apiRequest(`${SHEETS_API}/${encodeURIComponent(picked.spreadsheetId)}?fields=sheets.properties`);
  const oldTitles = new Set((oldMetadata.sheets || []).map(sheet => sheet.properties.title));
  if (['Member_Cards', 'Transaction_Logs', 'Shop_Config'].some(title => !oldTitles.has(title)))
    throw new Error('LEGACY_SCHEMA_MISMATCH');
  const legacyRanges = [
    ['members', 'Member_Cards!A:J', 'Member_Cards'], ['logs', 'Transaction_Logs!A:G', 'Transaction_Logs'],
    ['config', 'Shop_Config!A:B', 'Shop_Config'], ['rewards', 'Reward_Catalog!A:I', 'Reward_Catalog'],
    ['claims', 'Member_Rewards!A:L', 'Member_Rewards']
  ].filter(([, , title]) => oldTitles.has(title));
  const response = await readRanges(picked.spreadsheetId, legacyRanges.map(([, range]) => range));
  const source = Object.fromEntries(legacyRanges.map(([key], index) => [key, response.valueRanges?.[index]?.values || []]));
  const publicShopId = await legacyPublicShopId(gasUrl);
  const plan = buildMigrationPlan(source, { publicShopId, actorLabel, defaultShopName: picked.name, occurredAtUtc: new Date().toISOString() });
  const newState = await createShop(plan.setup, publicShopId);
  const rows = plan.ledgerRows;
  if (rows.length) {
    const range = encodeURIComponent('Event_Ledger!A:H');
    await apiRequest(`${SHEETS_API}/${encodeURIComponent(newState.setup.spreadsheetId)}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST', body: JSON.stringify({ majorDimension: 'ROWS', values: rows })
    });
  }
  const newMetadata = await apiRequest(`${SHEETS_API}/${encodeURIComponent(newState.setup.spreadsheetId)}?fields=sheets.properties`);
  const addArchive = await apiRequest(`${SHEETS_API}/${encodeURIComponent(newState.setup.spreadsheetId)}:batchUpdate`, {
    method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: 'Legacy_Transaction_Logs' } } }] })
  }).catch(() => null);
  if (plan.archiveRows.length && (addArchive || newMetadata)) {
    await updateValues(newState.setup.spreadsheetId, [{ range: 'Legacy_Transaction_Logs!A1:G50000', values: plan.archiveRows }]);
  }
  const legacyNames = new Set((oldMetadata.sheets || []).map(sheet => sheet.properties.title));
  const renameRequests = (oldMetadata.sheets || []).filter(sheet => ['Member_Cards', 'Transaction_Logs', 'Shop_Config', 'Reward_Catalog', 'Member_Rewards'].includes(sheet.properties.title)).map(sheet => {
    let title = `Legacy_${sheet.properties.title}`;
    if (legacyNames.has(title)) title = `Legacy_${Date.now()}_${sheet.properties.title}`;
    return { updateSheetProperties: { properties: { sheetId: sheet.properties.sheetId, title }, fields: 'title' } };
  });
  if (!legacyNames.has('Ahm_Migration_Lock'))
    renameRequests.unshift({ addSheet: { properties: { title: 'Ahm_Migration_Lock' } } });
  if (renameRequests.length) await apiRequest(`${SHEETS_API}/${encodeURIComponent(picked.spreadsheetId)}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: renameRequests }) });
  return loadShop(newState.setup.spreadsheetId, actorLabel);
}

function configure(options) {
  config = {
    clientId: text(value(options, 'clientId'), 512),
    apiKey: text(value(options, 'apiKey'), 512),
    appId: text(value(options, 'appId'), 128)
  };
  return { configured: Boolean(config.clientId && config.apiKey && config.appId) };
}

function connectionState() {
  return { configured: Boolean(config.clientId && config.apiKey && config.appId), connected: Boolean(accessToken && Date.now() < expiresAt - 30_000), expiresAt };
}

const publicApi = {
  configure, authorize, disconnect, connectionState, pickSpreadsheet, connectExisting,
  createShop, loadShop, saveConfiguration, appendEvent, makeEvent, migrateLegacy, resolveLegacyPath
};

if (typeof window !== 'undefined') window.ahmGoogle = publicApi;

export { configure, authorize, disconnect, pickSpreadsheet, connectExisting, createShop, loadShop, saveConfiguration, appendEvent, makeEvent, migrateLegacy, validSheetId };
