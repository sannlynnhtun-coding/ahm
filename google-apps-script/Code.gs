// Paste this into a script bound to a shop-owned Google Sheet.
// Set CASHIER_PIN in Project Settings > Script properties, then run initializeAhm once before deploying.
const MEMBER_TAB = 'Member_Cards';
const LOG_TAB = 'Transaction_Logs';
const CONFIG_TAB = 'Shop_Config';
const MEMBER_HEADERS = ['Phone_Number', 'Customer_Name', 'Current_Stamps', 'Available_Cashback', 'Lifetime_Cashback', 'Last_Visit', 'Member_Token'];
const LOG_HEADERS = ['Log_ID', 'Phone_Number', 'Action', 'Delta_Amount', 'Note', 'Timestamp', 'Request_ID'];
const DEFAULT_POLICY = { minSpendPerStamp: 10000, maxStamps: 10, cashbackReward: 10000, minWithdrawal: 1000, allowRollover: true };

function initializeAhm() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Run initializeAhm from the Apps Script editor opened through your Google Sheet.');
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', spreadsheet.getId());
  return spreadsheet.getUrl();
}

function doPost(e) {
  let result;
  try {
    const request = JSON.parse(e.postData.contents);
    result = dispatch_(request);
  } catch (error) {
    result = { ok: false, error: String(error.message || error) };
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function dispatch_(request) {
  if (!request || typeof request.action !== 'string') throw new Error('Invalid request.');
  if (request.action === 'member') {
    const sheets = sheets_(false);
    const row = findRow_(sheets.members, 7, String(request.token || ''));
    if (!row) throw new Error('Member card not found.');
    return { ok: true, member: member_(sheets, row), policy: policy_(sheets.config), shopName: configValue_(sheets.config, 'shopName') || '' };
  }
  const expectedPin = PropertiesService.getScriptProperties().getProperty('CASHIER_PIN');
  if (!expectedPin || expectedPin.length < 8) throw new Error('Set a CASHIER_PIN of at least 8 characters in Script properties.');
  if (String(request.pin || '') !== expectedPin) throw new Error('Invalid cashier PIN.');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Sheet is busy. Try again.');
  try {
    const sheets = sheets_(request.action === 'configure');
    const result = handle_(sheets, request);
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

function sheets_(create) {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!sheetId) throw new Error('Run initializeAhm from the Apps Script editor before deploying.');
  const spreadsheet = SpreadsheetApp.openById(sheetId);
  const specs = [[MEMBER_TAB, MEMBER_HEADERS], [LOG_TAB, LOG_HEADERS], [CONFIG_TAB, ['Key', 'Value']]];
  const found = specs.map(([name, headers]) => {
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet && create) {
      sheet = spreadsheet.insertSheet(name);
      sheet.appendRow(headers);
      sheet.setFrozenRows(1);
      if (name === MEMBER_TAB) sheet.getRange('A:A').setNumberFormat('@');
    }
    if (!sheet) throw new Error('Missing Sheet tab: ' + name + '. Complete setup first.');
    return sheet;
  });
  return { members: found[0], logs: found[1], config: found[2] };
}

function handle_(sheets, request) {
  if (request.action === 'configure') {
    const p = request.policy || {};
    const policy = {
      minSpendPerStamp: positive_(p.minSpendPerStamp, 'Minimum spend'),
      maxStamps: positive_(p.maxStamps, 'Target stamps'),
      cashbackReward: positive_(p.cashbackReward, 'Cashback reward'),
      minWithdrawal: positive_(p.minWithdrawal, 'Minimum withdrawal'),
      allowRollover: p.allowRollover === true
    };
    if (policy.maxStamps > 30) throw new Error('Target stamps must be at most 30.');
    const shopName = String(request.shopName || '').trim();
    if (!shopName || shopName.length > 100) throw new Error('Invalid shop name.');
    writeConfig_(sheets.config, 'shopName', shopName);
    Object.keys(policy).forEach(key => writeConfig_(sheets.config, key, policy[key]));
    return { ok: true, policy, shopName };
  }
  const policy = policy_(sheets.config);
  const phone = normalizePhone_(request.phone || '');
  if (request.action === 'find') {
    const row = request.token ? findRow_(sheets.members, 7, String(request.token)) : findRow_(sheets.members, 1, phone);
    return { ok: true, member: row ? member_(sheets, row) : null, policy };
  }
  if (request.action === 'enroll') {
    if (!phone) throw new Error('Enter a valid phone number.');
    const name = String(request.name || '').trim();
    if (!name || name.length > 100) throw new Error('Enter a customer name.');
    let row = findRow_(sheets.members, 1, phone);
    if (!row) {
      sheets.members.appendRow([phone, name, 0, 0, 0, '', Utilities.getUuid()]);
      row = sheets.members.getLastRow();
    }
    return { ok: true, member: member_(sheets, row), policy };
  }
  if (!phone) throw new Error('Enter a valid phone number.');
  const row = findRow_(sheets.members, 1, phone);
  if (!row) throw new Error('Member card not found.');
  const requestId = String(request.requestId || '');
  if (!/^[a-f0-9]{32}$/i.test(requestId)) throw new Error('A valid request ID is required.');
  if (findRow_(sheets.logs, 7, requestId)) return { ok: true, member: member_(sheets, row), policy };
  const values = sheets.members.getRange(row, 1, 1, 7).getValues()[0];
  const now = new Date();
  if (request.action === 'stamp') {
    const spend = positive_(request.spend, 'Bill amount');
    if (spend < policy.minSpendPerStamp) throw new Error('Bill is below the minimum spend.');
    const total = Number(values[2]) + 1;
    const completed = Math.floor(total / policy.maxStamps);
    values[2] = completed ? (policy.allowRollover ? total % policy.maxStamps : 0) : total;
    values[3] = Number(values[3]) + completed * policy.cashbackReward;
    values[4] = Number(values[4]) + completed * policy.cashbackReward;
    values[5] = now;
    sheets.members.getRange(row, 1, 1, 7).setValues([values]);
    log_(sheets.logs, phone, 'STAMP_ADD', 1, 'Bill: ' + spend + ' MMK', now, requestId);
    if (completed) log_(sheets.logs, phone, 'CARD_COMPLETE', completed * policy.cashbackReward, 'Card complete', now, requestId + '-reward');
  } else if (request.action === 'withdraw') {
    const amount = positive_(request.amount, 'Withdrawal amount');
    if (amount < policy.minWithdrawal || amount > Number(values[3])) throw new Error('Withdrawal is outside the available balance or minimum.');
    values[3] = Number(values[3]) - amount;
    sheets.members.getRange(row, 1, 1, 7).setValues([values]);
    log_(sheets.logs, phone, 'CASHBACK_PAYOUT', -amount, 'Paid', now, requestId);
  } else {
    throw new Error('Unknown action.');
  }
  return { ok: true, member: member_(sheets, row), policy };
}

function normalizePhone_(value) {
  const digits = String(value).replace(/[\s+()-]/g, '');
  return /^\d{8,15}$/.test(digits) ? digits : '';
}

function positive_(value, label) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(label + ' must be a positive integer.');
  return n;
}

function findRow_(sheet, column, value) {
  if (!value || sheet.getLastRow() < 2) return 0;
  const cells = sheet.getRange(2, column, sheet.getLastRow() - 1, 1).getDisplayValues();
  const index = cells.findIndex(row => String(row[0]) === value);
  return index < 0 ? 0 : index + 2;
}

function member_(sheets, row) {
  const v = sheets.members.getRange(row, 1, 1, 7).getValues()[0];
  const phone = String(v[0]);
  const logs = sheets.logs.getLastRow() > 1 ? sheets.logs.getRange(2, 1, sheets.logs.getLastRow() - 1, 7).getValues() : [];
  return {
    phone, name: String(v[1]), stamps: Number(v[2]), availableCashback: Number(v[3]),
    lifetimeCashback: Number(v[4]), lastVisit: date_(v[5]), token: String(v[6]),
    history: logs.filter(log => String(log[1]) === phone).slice(-20).reverse().map(log => ({ action: String(log[2]), delta: Number(log[3]), note: String(log[4]), timestamp: date_(log[5]) }))
  };
}

function log_(sheet, phone, action, delta, note, when, requestId) {
  sheet.appendRow([sheet.getLastRow(), phone, action, delta, note, when, requestId]);
}

function date_(value) {
  return value instanceof Date ? Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') : String(value || '');
}

function configValue_(sheet, key) {
  const row = findRow_(sheet, 1, key);
  return row ? sheet.getRange(row, 2).getValue() : null;
}

function writeConfig_(sheet, key, value) {
  const row = findRow_(sheet, 1, key);
  if (row) sheet.getRange(row, 2).setValue(value);
  else sheet.appendRow([key, value]);
}

function policy_(sheet) {
  const result = {};
  Object.keys(DEFAULT_POLICY).forEach(key => {
    const value = configValue_(sheet, key);
    result[key] = value === null ? DEFAULT_POLICY[key] : key === 'allowRollover' ? value === true || value === 'true' : Number(value);
  });
  return result;
}
