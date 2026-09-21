import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

class Sheet {
  constructor(headers) { this.rows = [headers]; }
  getLastRow() { return this.rows.length; }
  appendRow(row) { this.rows.push([...row]); }
  getRange(row, column, rowCount = 1, columnCount = 1) {
    const cells = () => Array.from({ length: rowCount }, (_, r) => Array.from({ length: columnCount }, (_, c) => this.rows[row - 1 + r][column - 1 + c]));
    return {
      getValues: cells,
      getDisplayValues: () => cells().map(line => line.map(value => String(value))),
      getValue: () => cells()[0][0],
      setValue: value => { this.rows[row - 1][column - 1] = value; },
      setValues: values => values.forEach((line, r) => line.forEach((value, c) => { this.rows[row - 1 + r][column - 1 + c] = value; }))
    };
  }
}

let uuidCounter = 0;
const context = {
  Utilities: { getUuid: () => `7ff2d90b-9778-43d4-a0a8-${(0x69435b7c0c + uuidCounter++).toString(16).padStart(12, '0')}`, formatDate: value => value.toISOString() },
  Session: { getScriptTimeZone: () => 'UTC' }
};
vm.createContext(context);
vm.runInContext(readFileSync(new URL('../google-apps-script/Code.gs', import.meta.url), 'utf8'), context);
const sheets = {
  members: new Sheet(['Phone_Number', 'Customer_Name', 'Current_Stamps', 'Available_Cashback', 'Lifetime_Cashback', 'Last_Visit', 'Member_Token']),
  logs: new Sheet(['Log_ID', 'Phone_Number', 'Action', 'Delta_Amount', 'Note', 'Timestamp', 'Request_ID']),
  config: new Sheet(['Key', 'Value']),
  rewards: new Sheet(['Reward_ID', 'Name', 'Type', 'Value', 'Max_Discount', 'Description', 'Active']),
  claims: new Sheet(['Claim_ID', 'Phone_Number', 'Reward_ID', 'Name', 'Type', 'Value', 'Max_Discount', 'Status', 'Selected_At', 'Redeemed_At', 'Request_ID'])
};
context.PropertiesService = { getScriptProperties: () => ({ getProperty: key => ({ CASHIER_PIN: 'long-test-pin', SHEET_ID: 'sheet-123' })[key] }) };
context.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };
context.SpreadsheetApp = {
  openById: id => { assert.equal(id, 'sheet-123'); return { getSheetByName: name => ({ Member_Cards: sheets.members, Transaction_Logs: sheets.logs, Shop_Config: sheets.config, Reward_Catalog: sheets.rewards, Member_Rewards: sheets.claims })[name] }; },
  flush: () => {}
};
const handle = request => context.handle_(sheets, request);

test('spend remainder, reward choices, redemption and idempotency', () => {
  assert.equal(context.dispatch_({ action: 'version' }).schemaVersion, 2);
  const cashbackId = '11111111-2222-4333-8444-555555555555';
  const discountId = '11111111-2222-4333-8444-666666666666';
  const freeId = '11111111-2222-4333-8444-777777777777';
  handle({ action: 'configure', shopName: 'Test Shop', policy: { minSpendPerStamp: 10000, maxStamps: 3, cashbackReward: 5000, minWithdrawal: 1000, allowRollover: true }, rewards: [
    { id: cashbackId, name: 'Cashback', type: 'CASHBACK', value: 5000, active: true },
    { id: discountId, name: '10% off', type: 'PERCENT_DISCOUNT', value: 10, maxDiscount: 1000, active: true },
    { id: freeId, name: 'Coffee', type: 'FREE_ITEM', active: true }
  ] });
  let result = handle({ action: 'enroll', phone: '09798123456', name: 'Ko Zaw' });
  assert.equal(result.member.stamps, 0);
  assert.equal(result.member.token, '7ff2d90b-9778-43d4-a0a8-0069435b7c0c');
  result = handle({ action: 'stamp', phone: '09798123456', spend: 25000, requestId: 'a'.repeat(32) });
  assert.equal(result.member.stamps, 2);
  assert.equal(result.member.spendRemainder, 5000);
  assert.equal(result.member.rewardCredits, 0);
  result = handle({ action: 'stamp', phone: '09798123456', spend: 5000, requestId: 'b'.repeat(32) });
  assert.equal(result.member.stamps, 0);
  assert.equal(result.member.spendRemainder, 0);
  assert.equal(result.member.rewardCredits, 1);
  assert.equal(result.member.availableCashback, 0);
  result = handle({ action: 'stamp', phone: '09798123456', spend: 5000, requestId: 'b'.repeat(32) });
  assert.equal(result.member.rewardCredits, 1);
  assert.equal(sheets.logs.getLastRow(), 4);
  const token = result.member.token;
  result = context.claimReward_(sheets, { token, rewardId: cashbackId, requestId: 'c'.repeat(32) });
  assert.equal(result.member.rewardCredits, 0);
  assert.equal(result.member.availableCashback, 5000);
  assert.equal(result.member.lifetimeCashback, 5000);
  result = context.claimReward_(sheets, { token, rewardId: cashbackId, requestId: 'c'.repeat(32) });
  assert.equal(result.member.availableCashback, 5000);
  result = handle({ action: 'withdraw', phone: '09798123456', amount: 3000, requestId: 'd'.repeat(32) });
  assert.equal(result.member.availableCashback, 2000);
  assert.equal(result.member.lifetimeCashback, 5000);
  result = handle({ action: 'withdraw', phone: '09798123456', amount: 3000, requestId: 'd'.repeat(32) });
  assert.equal(result.member.availableCashback, 2000);
  assert.throws(() => handle({ action: 'withdraw', phone: '09798123456', amount: 3000, requestId: 'e'.repeat(32) }), /available balance/);

  result = handle({ action: 'stamp', phone: '09798123456', spend: 30000, requestId: 'f'.repeat(32) });
  assert.equal(result.member.rewardCredits, 1);
  result = context.claimReward_(sheets, { token, rewardId: discountId, requestId: '1'.repeat(32) });
  assert.equal(result.member.claims.at(-1).status, 'Pending');
  const discountClaim = result.member.claims.at(-1).id;
  handle({ action: 'configure', shopName: 'Test Shop', policy: { minSpendPerStamp: 10000, maxStamps: 3, cashbackReward: 5000, minWithdrawal: 1000, allowRollover: true }, rewards: [
    { id: cashbackId, name: 'Cashback', type: 'CASHBACK', value: 5000, active: true },
    { id: discountId, name: '20% off', type: 'PERCENT_DISCOUNT', value: 20, maxDiscount: 5000, active: false },
    { id: freeId, name: 'Coffee', type: 'FREE_ITEM', active: true }
  ] });
  result = handle({ action: 'redeem', phone: '09798123456', claimId: discountClaim, spend: 25000, requestId: '2'.repeat(32) });
  assert.equal(result.discount, 1000);
  assert.equal(result.member.claims.at(-1).status, 'Redeemed');
  result = handle({ action: 'redeem', phone: '09798123456', claimId: discountClaim, spend: 25000, requestId: '2'.repeat(32) });
  assert.equal(result.discount, 1000);
  assert.equal(sheets.logs.rows.filter(log => log[6] === '2'.repeat(32)).length, 1);
  assert.throws(() => handle({ action: 'redeem', phone: '09798123456', claimId: discountClaim, spend: 25000, requestId: '3'.repeat(32) }), /not available/);

  result = handle({ action: 'stamp', phone: '09798123456', spend: 30000, requestId: '4'.repeat(32) });
  result = context.claimReward_(sheets, { token, rewardId: freeId, requestId: '5'.repeat(32) });
  assert.equal(result.member.claims.at(-1).status, 'Pending');
  result = handle({ action: 'redeem', phone: '09798123456', claimId: result.member.claims.at(-1).id, requestId: '6'.repeat(32) });
  assert.equal(result.member.claims.at(-1).status, 'Redeemed');
  handle({ action: 'stamp', phone: '09798123456', spend: 30000, requestId: '7'.repeat(32) });
  const recoveringId = '8'.repeat(32);
  const beforeRecovery = sheets.members.getRange(2, 1, 1, 10).getValues()[0];
  sheets.claims.appendRow(['7ff2d90b-9778-43d4-a0a8-0069435b7c99', '09798123456', cashbackId, 'Cashback', 'CASHBACK', 5000, 0, 'Preparing', new Date(), '', recoveringId]);
  beforeRecovery[8] = 0;
  beforeRecovery[3] += 5000;
  beforeRecovery[4] += 5000;
  beforeRecovery[9] = recoveringId;
  sheets.members.getRange(2, 1, 1, 10).setValues([beforeRecovery]);
  result = context.claimReward_(sheets, { token, rewardId: cashbackId, requestId: recoveringId });
  assert.equal(result.member.availableCashback, 7000);
  assert.equal(result.member.rewardCredits, 0);
  assert.equal(result.member.claims.at(-1).status, 'Applied');
  assert.equal(sheets.logs.rows.filter(log => log[6] === recoveringId).length, 1);
  assert.equal(context.dispatch_({ action: 'find', pin: 'long-test-pin', phone: '09798123456' }).member.availableCashback, 7000);
  assert.equal(context.dispatch_({ action: 'member', token: '7ff2d90b-9778-43d4-a0a8-0069435b7c0c' }).member.name, 'Ko Zaw');
  assert.equal(sheets.members.rows[0][7], 'Spend_Remainder');
  assert.equal(sheets.members.rows[0][9], 'Last_Claim_Request_ID');

  handle({ action: 'enroll', phone: '09798123457', name: 'Ma Su' });
  result = handle({ action: 'stamp', phone: '09798123457', spend: 12000, requestId: '9'.repeat(32) });
  assert.equal(result.member.stamps, 1);
  assert.equal(result.member.spendRemainder, 2000);
  handle({ action: 'configure', shopName: 'Test Shop', policy: { minSpendPerStamp: 3000, maxStamps: 3, cashbackReward: 5000, minWithdrawal: 1000, allowRollover: true }, rewards: [
    { id: cashbackId, name: 'Cashback', type: 'CASHBACK', value: 5000, active: true },
    { id: discountId, name: '10% off', type: 'PERCENT_DISCOUNT', value: 10, maxDiscount: 1000, active: true },
    { id: freeId, name: 'Coffee', type: 'FREE_ITEM', active: true }
  ] });
  result = handle({ action: 'stamp', phone: '09798123457', spend: 1000, requestId: '0'.repeat(32) });
  assert.equal(result.member.stamps, 2);
  assert.equal(result.member.spendRemainder, 0);
});
