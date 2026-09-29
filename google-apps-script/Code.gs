// LEGACY AHМ v2 MIGRATION ARTIFACT ONLY. Do not use this for new shop onboarding.
// New Ahm v3 shops connect directly through Google Identity Services and the Sheets API.
const MEMBER_TAB = 'Member_Cards';
const LOG_TAB = 'Transaction_Logs';
const CONFIG_TAB = 'Shop_Config';
const REWARD_TAB = 'Reward_Catalog';
const CLAIM_TAB = 'Member_Rewards';
const MEMBER_HEADERS = ['Phone_Number', 'Customer_Name', 'Current_Stamps', 'Available_Cashback', 'Lifetime_Cashback', 'Last_Visit', 'Member_Token', 'Spend_Remainder', 'Reward_Credits', 'Last_Claim_Request_ID'];
const LOG_HEADERS = ['Log_ID', 'Phone_Number', 'Action', 'Delta_Amount', 'Note', 'Timestamp', 'Request_ID'];
const REWARD_HEADERS = ['Reward_ID', 'Name', 'Type', 'Value', 'Max_Discount', 'Description', 'Active', 'Stock_Quantity', 'Last_Stock_Claim_ID'];
const CLAIM_HEADERS = ['Claim_ID', 'Phone_Number', 'Reward_ID', 'Name', 'Type', 'Value', 'Max_Discount', 'Status', 'Selected_At', 'Redeemed_At', 'Request_ID', 'Stock_Limited'];
const DEFAULT_POLICY = { minSpendPerStamp: 10000, maxStamps: 10, cashbackReward: 10000, minWithdrawal: 1000, allowRollover: true };
const SCHEMA_VERSION = 2;

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
    if (result.ok) result.schemaVersion = SCHEMA_VERSION;
  } catch (error) {
    result = { ok: false, error: String(error.message || error) };
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function dispatch_(request) {
  if (!request || typeof request.action !== 'string') throw new Error('Invalid request.');
  if (request.action === 'version') return { ok: true, schemaVersion: SCHEMA_VERSION };
  if (request.action === 'member') {
    const sheets = sheets_(false);
    const row = findRow_(sheets.members, 7, String(request.token || ''));
    if (!row) throw new Error('Member card not found.');
    return { ok: true, member: member_(sheets, row), policy: policy_(sheets.config), rewards: rewards_(sheets.rewards, true), shopName: configValue_(sheets.config, 'shopName') || '' };
  }
  if (request.action === 'claim') {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) throw new Error('Sheet is busy. Try again.');
    try {
      const sheets = sheets_(true);
      finishPreparingClaims_(sheets);
      const result = claimReward_(sheets, request);
      SpreadsheetApp.flush();
      return result;
    } finally { lock.releaseLock(); }
  }
  const expectedPin = PropertiesService.getScriptProperties().getProperty('CASHIER_PIN');
  if (!expectedPin || expectedPin.length < 8) throw new Error('Set a CASHIER_PIN of at least 8 characters in Script properties.');
  if (String(request.pin || '') !== expectedPin) throw new Error('Invalid cashier PIN.');
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Sheet is busy. Try again.');
  try {
    const sheets = sheets_(true);
    if (request.action === 'configure') finishPreparingClaims_(sheets);
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
  if (spreadsheet.getSheetByName('Ahm_Migration_Lock'))
    throw new Error('This shop was migrated to Ahm v3. The legacy deployment is locked.');
  const specs = [[MEMBER_TAB, MEMBER_HEADERS], [LOG_TAB, LOG_HEADERS], [CONFIG_TAB, ['Key', 'Value']], [REWARD_TAB, REWARD_HEADERS], [CLAIM_TAB, CLAIM_HEADERS]];
  let createdRewardCatalog = false;
  const found = specs.map(([name, headers]) => {
    let sheet = spreadsheet.getSheetByName(name);
    if (!sheet && create) {
      sheet = spreadsheet.insertSheet(name);
      sheet.appendRow(headers);
      sheet.setFrozenRows(1);
      if (name === REWARD_TAB) createdRewardCatalog = true;
      if (name === MEMBER_TAB) sheet.getRange('A:A').setNumberFormat('@');
    }
    if (!sheet && name !== REWARD_TAB && name !== CLAIM_TAB) throw new Error('Missing Sheet tab: ' + name + '. Complete setup first.');
    return sheet;
  });
  if (create) {
    if (createdRewardCatalog && configValue_(found[2], 'shopName'))
      found[3].appendRow([Utilities.getUuid(), 'Cashback', 'CASHBACK', policy_(found[2]).cashbackReward, 0, '', true]);
    // Existing shops keep their first seven member columns; new fields are appended.
    for (let column = 8; column <= MEMBER_HEADERS.length; column++)
      if (found[0].getRange(1, column).getValue() !== MEMBER_HEADERS[column - 1])
        found[0].getRange(1, column).setValue(MEMBER_HEADERS[column - 1]);
    for (let column = 8; column <= REWARD_HEADERS.length; column++)
      if (found[3].getRange(1, column).getValue() !== REWARD_HEADERS[column - 1])
        found[3].getRange(1, column).setValue(REWARD_HEADERS[column - 1]);
    if (found[4].getRange(1, 12).getValue() !== CLAIM_HEADERS[11])
      found[4].getRange(1, 12).setValue(CLAIM_HEADERS[11]);
  }
  return { members: found[0], logs: found[1], config: found[2], rewards: found[3], claims: found[4] };
}

function handle_(sheets, request) {
  if (request.action === 'configure') {
    const p = request.policy || {};
    const policy = {
      minSpendPerStamp: positive_(p.minSpendPerStamp, 'Minimum spend'),
      maxStamps: positive_(p.maxStamps, 'Target stamps'),
      cashbackReward: positive_(p.cashbackReward, 'Cashback reward'),
      minWithdrawal: positive_(p.minWithdrawal, 'Minimum withdrawal'),
      allowRollover: true
    };
    if (policy.maxStamps > 30) throw new Error('Target stamps must be at most 30.');
    const shopName = String(request.shopName || '').trim();
    if (!shopName || shopName.length > 100) throw new Error('Invalid shop name.');
    if (Array.isArray(request.rewards) && !request.rewards.some(reward => reward.active !== false)) throw new Error('At least one active reward is required.');
    if (sheets.rewards.getLastRow() === 1 && !Array.isArray(request.rewards)) {
      sheets.rewards.appendRow([Utilities.getUuid(), 'Cashback', 'CASHBACK', policy.cashbackReward, 0, '', true]);
    } else if (Array.isArray(request.rewards)) {
      saveRewards_(sheets.rewards, request.rewards);
    }
    writeConfig_(sheets.config, 'shopName', shopName);
    Object.keys(policy).forEach(key => writeConfig_(sheets.config, key, policy[key]));
    return { ok: true, policy, shopName, rewards: rewards_(sheets.rewards, false) };
  }
  const policy = policy_(sheets.config);
  const phone = normalizePhone_(request.phone || '');
  if (request.action === 'find') {
    const row = request.token ? findRow_(sheets.members, 7, String(request.token)) : findRow_(sheets.members, 1, phone);
    return { ok: true, member: row ? member_(sheets, row) : null, policy, rewards: rewards_(sheets.rewards, false), shopName: configValue_(sheets.config, 'shopName') || '' };
  }
  if (request.action === 'enroll') {
    if (!phone) throw new Error('Enter a valid phone number.');
    const name = String(request.name || '').trim();
    if (!name || name.length > 100) throw new Error('Enter a customer name.');
    let row = findRow_(sheets.members, 1, phone);
    if (!row) {
      sheets.members.appendRow([phone, name, 0, 0, 0, '', Utilities.getUuid(), 0, 0, '']);
      row = sheets.members.getLastRow();
    }
    return { ok: true, member: member_(sheets, row), policy, rewards: rewards_(sheets.rewards, false) };
  }
  if (!phone) throw new Error('Enter a valid phone number.');
  const row = findRow_(sheets.members, 1, phone);
  if (!row) throw new Error('Member card not found.');
  const requestId = String(request.requestId || '');
  if (!/^[a-f0-9]{32}$/i.test(requestId)) throw new Error('A valid request ID is required.');
  const previousLog = findRow_(sheets.logs, 7, requestId);
  if (previousLog) {
    const log = sheets.logs.getRange(previousLog, 1, 1, 7).getValues()[0];
    const expectedAction = request.action === 'stamp' ? 'STAMP_ADD' : request.action === 'withdraw' ? 'CASHBACK_PAYOUT' : 'REWARD_REDEEM';
    if (String(log[1]) !== phone || String(log[2]) !== expectedAction) throw new Error('Request ID was already used for another action.');
    return { ok: true, member: member_(sheets, row), policy, rewards: rewards_(sheets.rewards, false), discount: log[2] === 'REWARD_REDEEM' ? Number(log[3]) : 0 };
  }
  const values = sheets.members.getRange(row, 1, 1, 9).getValues()[0];
  const now = new Date();
  let discount = 0;
  if (request.action === 'stamp') {
    const spend = positive_(request.spend, 'Bill amount');
    const accumulated = Number(values[7] || 0) + spend;
    if (!Number.isSafeInteger(accumulated)) throw new Error('Bill total is too large.');
    const earned = Math.floor(accumulated / policy.minSpendPerStamp);
    values[7] = accumulated % policy.minSpendPerStamp;
    const total = Number(values[2] || 0) + earned;
    const completed = Math.floor(total / policy.maxStamps);
    values[2] = total % policy.maxStamps;
    values[8] = Number(values[8] || 0) + completed;
    values[5] = now;
    sheets.members.getRange(row, 1, 1, 9).setValues([values]);
    log_(sheets.logs, phone, 'STAMP_ADD', earned, 'Bill: ' + spend + ' MMK; remainder: ' + values[7] + ' MMK', now, requestId);
    if (completed) log_(sheets.logs, phone, 'CARD_COMPLETE', completed, 'Reward choices earned', now, requestId + '-reward');
  } else if (request.action === 'withdraw') {
    const amount = positive_(request.amount, 'Withdrawal amount');
    if (amount < policy.minWithdrawal || amount > Number(values[3])) throw new Error('Withdrawal is outside the available balance or minimum.');
    values[3] = Number(values[3]) - amount;
    sheets.members.getRange(row, 1, 1, 9).setValues([values]);
    log_(sheets.logs, phone, 'CASHBACK_PAYOUT', -amount, 'Paid', now, requestId);
  } else if (request.action === 'redeem') {
    const claimRow = findRow_(sheets.claims, 1, String(request.claimId || ''));
    if (!claimRow) throw new Error('Reward not found.');
    const claim = sheets.claims.getRange(claimRow, 1, 1, 11).getValues()[0];
    if (String(claim[1]) !== phone || String(claim[7]) !== 'Pending') throw new Error('Reward is not available for redemption.');
    if (claim[4] === 'PERCENT_DISCOUNT') {
      const bill = positive_(request.spend, 'Bill amount');
      discount = Math.min(Math.floor(bill * Number(claim[5]) / 100), Number(claim[6]));
      if (discount < 1) throw new Error('Bill is too small for this discount.');
    }
    claim[7] = 'Redeemed';
    claim[9] = now;
    sheets.claims.getRange(claimRow, 1, 1, 11).setValues([claim]);
    log_(sheets.logs, phone, 'REWARD_REDEEM', discount, String(claim[3]), now, requestId);
  } else {
    throw new Error('Unknown action.');
  }
  return { ok: true, member: member_(sheets, row), policy, rewards: rewards_(sheets.rewards, false), discount };
}

function rewards_(sheet, activeOnly) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 9).getValues()
    .filter(v => v[0] && (!activeOnly || v[6] === true || v[6] === 'true'))
    .map(v => ({ id: String(v[0]), name: String(v[1]), type: String(v[2]), value: Number(v[3] || 0), maxDiscount: Number(v[4] || 0), description: String(v[5] || ''), active: v[6] === true || v[6] === 'true', stockQuantity: v[7] === '' || v[7] == null ? null : Number(v[7]) }));
}

function saveRewards_(sheet, rewards) {
  if (rewards.length > 30) throw new Error('At most 30 rewards are allowed.');
  const seen = {};
  const prepared = rewards.map(reward => {
    const name = String(reward.name || '').trim();
    const type = String(reward.type || '');
    const value = Number(reward.value || 0);
    const maxDiscount = Number(reward.maxDiscount || 0);
    const stock = reward.stockQuantity === '' || reward.stockQuantity == null ? '' : Number(reward.stockQuantity);
    if (!name || name.length > 100 || !['CASHBACK', 'PERCENT_DISCOUNT', 'FREE_ITEM'].includes(type)) throw new Error('Invalid reward name or type.');
    if (type === 'CASHBACK' && (!Number.isSafeInteger(value) || value < 1 || value > 2147483647)) throw new Error('Cashback must be a positive amount.');
    if (type === 'PERCENT_DISCOUNT' && (!Number.isSafeInteger(value) || value < 1 || value > 100 || !Number.isSafeInteger(maxDiscount) || maxDiscount < 1 || maxDiscount > 2147483647)) throw new Error('Discount needs a percentage and maximum amount.');
    if (stock !== '' && (!Number.isSafeInteger(stock) || stock < 0 || stock > 2147483647)) throw new Error('Stock must be zero or a positive whole number.');
    const id = String(reward.id || Utilities.getUuid());
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('Invalid reward ID.');
    if (seen[id]) throw new Error('Duplicate reward ID.');
    seen[id] = true;
    const row = findRow_(sheet, 1, id);
    const lastStockClaimId = row ? String(sheet.getRange(row, 9).getValue() || '') : '';
    const values = [id, name, type, type === 'FREE_ITEM' ? 0 : value, type === 'PERCENT_DISCOUNT' ? maxDiscount : 0, String(reward.description || '').slice(0, 300), reward.active !== false, stock, lastStockClaimId];
    return values;
  });
  prepared.forEach(values => {
    const row = findRow_(sheet, 1, values[0]);
    if (row) sheet.getRange(row, 1, 1, 9).setValues([values]);
    else sheet.appendRow(values);
  });
  for (let row = 2; row <= sheet.getLastRow(); row++) {
    const id = String(sheet.getRange(row, 1).getValue());
    if (!seen[id]) sheet.getRange(row, 7).setValue(false);
  }
}

function claims_(sheets, phone) {
  if (!sheets.claims || sheets.claims.getLastRow() < 2) return [];
  return sheets.claims.getRange(2, 1, sheets.claims.getLastRow() - 1, 11).getValues()
    .filter(v => String(v[1]) === phone)
    .map(v => ({ id: String(v[0]), name: String(v[3]), type: String(v[4]), value: Number(v[5] || 0), maxDiscount: Number(v[6] || 0), status: String(v[7]), selectedAt: date_(v[8]), redeemedAt: date_(v[9]) }));
}

function claimReward_(sheets, request) {
  const token = String(request.token || '');
  const row = findRow_(sheets.members, 7, token);
  if (!row) throw new Error('Member card not found.');
  const requestId = String(request.requestId || '');
  if (!/^[a-f0-9]{32}$/i.test(requestId)) throw new Error('A valid request ID is required.');
  const phone = String(sheets.members.getRange(row, 1).getValue());
  const existing = findRow_(sheets.claims, 11, requestId);
  if (existing) {
    const claim = sheets.claims.getRange(existing, 1, 1, 12).getValues()[0];
    if (String(claim[1]) !== phone || String(claim[2]) !== String(request.rewardId || '')) throw new Error('Request ID belongs to another reward selection.');
  }
  if (!existing) {
    const reward = rewards_(sheets.rewards, true).find(r => r.id === String(request.rewardId || ''));
    if (!reward) throw new Error('Reward is no longer available.');
    if (reward.stockQuantity !== null && (!Number.isSafeInteger(reward.stockQuantity) || reward.stockQuantity < 1)) throw new Error('Reward is sold out.');
    const values = sheets.members.getRange(row, 1, 1, 10).getValues()[0];
    if (Number(values[8] || 0) < 1) throw new Error('No reward choices available.');
    const now = new Date();
    const claimId = Utilities.getUuid();
    sheets.claims.appendRow([claimId, phone, reward.id, reward.name, reward.type, reward.value, reward.maxDiscount, 'Preparing', now, '', requestId, reward.stockQuantity !== null]);
    finishClaim_(sheets, row, sheets.claims.getLastRow());
  }
  return { ok: true, member: member_(sheets, row), policy: policy_(sheets.config), rewards: rewards_(sheets.rewards, true), shopName: configValue_(sheets.config, 'shopName') || '' };
}

function finishPreparingClaims_(sheets) {
  if (!sheets.claims || sheets.claims.getLastRow() < 2) return;
  for (let claimRow = 2; claimRow <= sheets.claims.getLastRow(); claimRow++) {
    const claim = sheets.claims.getRange(claimRow, 1, 1, 12).getValues()[0];
    if (String(claim[7]) !== 'Preparing') continue;
    const memberRow = findRow_(sheets.members, 1, String(claim[1]));
    if (!memberRow) throw new Error('Member for pending reward was not found.');
    finishClaim_(sheets, memberRow, claimRow);
  }
}

function finishClaim_(sheets, memberRow, claimRow) {
  const claim = sheets.claims.getRange(claimRow, 1, 1, 12).getValues()[0];
  if (claim[7] !== 'Preparing') return;
  const values = sheets.members.getRange(memberRow, 1, 1, 10).getValues()[0];
  const requestId = String(claim[10]);
  if (claim[11] === true || claim[11] === 'true') {
    const rewardRow = findRow_(sheets.rewards, 1, String(claim[2]));
    if (!rewardRow) throw new Error('Reward stock record was not found.');
    const reward = sheets.rewards.getRange(rewardRow, 1, 1, 9).getValues()[0];
    if (String(reward[8] || '') !== requestId) {
      const stock = Number(reward[7]);
      if (!Number.isSafeInteger(stock) || stock < 1) throw new Error('Reward is sold out.');
      reward[7] = stock - 1;
      reward[8] = requestId;
      sheets.rewards.getRange(rewardRow, 1, 1, 9).setValues([reward]);
    }
  }
  if (String(values[9] || '') !== requestId) {
    if (Number(values[8] || 0) < 1) throw new Error('No reward choices available.');
    values[8] = Number(values[8]) - 1;
    if (claim[4] === 'CASHBACK') {
      values[3] = Number(values[3] || 0) + Number(claim[5]);
      values[4] = Number(values[4] || 0) + Number(claim[5]);
    }
    values[9] = requestId;
    sheets.members.getRange(memberRow, 1, 1, 10).setValues([values]);
  }
  if (!findRow_(sheets.logs, 7, requestId))
    log_(sheets.logs, String(claim[1]), 'REWARD_SELECTED', claim[4] === 'CASHBACK' ? Number(claim[5]) : 0, String(claim[3]), claim[8], requestId);
  claim[7] = claim[4] === 'CASHBACK' ? 'Applied' : 'Pending';
  sheets.claims.getRange(claimRow, 1, 1, 12).setValues([claim]);
}

function normalizePhone_(value) {
  const digits = String(value).replace(/[\s+()-]/g, '');
  return /^\d{8,15}$/.test(digits) ? digits : '';
}

function positive_(value, label) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > 2147483647) throw new Error(label + ' must be a positive integer at most 2,147,483,647.');
  return n;
}

function findRow_(sheet, column, value) {
  if (!value || sheet.getLastRow() < 2) return 0;
  const cells = sheet.getRange(2, column, sheet.getLastRow() - 1, 1).getDisplayValues();
  const index = cells.findIndex(row => String(row[0]) === value);
  return index < 0 ? 0 : index + 2;
}

function member_(sheets, row) {
  const v = sheets.members.getRange(row, 1, 1, 9).getValues()[0];
  const phone = String(v[0]);
  const logs = sheets.logs.getLastRow() > 1 ? sheets.logs.getRange(2, 1, sheets.logs.getLastRow() - 1, 7).getValues() : [];
  return {
    phone, name: String(v[1]), stamps: Number(v[2]), availableCashback: Number(v[3]),
    lifetimeCashback: Number(v[4]), lastVisit: date_(v[5]), token: String(v[6]),
    spendRemainder: Number(v[7] || 0), rewardCredits: Number(v[8] || 0), claims: claims_(sheets, phone),
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
