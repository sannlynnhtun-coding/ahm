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

const context = {
  Utilities: { getUuid: () => '7ff2d90b-9778-43d4-a0a8-0069435b7c0c', formatDate: value => value.toISOString() },
  Session: { getScriptTimeZone: () => 'UTC' }
};
vm.createContext(context);
vm.runInContext(readFileSync(new URL('../google-apps-script/Code.gs', import.meta.url), 'utf8'), context);
const sheets = {
  members: new Sheet(['Phone_Number', 'Customer_Name', 'Current_Stamps', 'Available_Cashback', 'Lifetime_Cashback', 'Last_Visit', 'Member_Token']),
  logs: new Sheet(['Log_ID', 'Phone_Number', 'Action', 'Delta_Amount', 'Note', 'Timestamp', 'Request_ID']),
  config: new Sheet(['Key', 'Value'])
};
context.PropertiesService = { getScriptProperties: () => ({ getProperty: key => ({ CASHIER_PIN: 'long-test-pin', SHEET_ID: 'sheet-123' })[key] }) };
context.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };
context.SpreadsheetApp = {
  openById: id => { assert.equal(id, 'sheet-123'); return { getSheetByName: name => ({ Member_Cards: sheets.members, Transaction_Logs: sheets.logs, Shop_Config: sheets.config })[name] }; },
  flush: () => {}
};
const handle = request => context.handle_(sheets, request);

test('enrollment, reward, idempotency and payout update the ledger once', () => {
  handle({ action: 'configure', shopName: 'Test Shop', policy: { minSpendPerStamp: 10000, maxStamps: 2, cashbackReward: 5000, minWithdrawal: 1000, allowRollover: true } });
  let result = handle({ action: 'enroll', phone: '09798123456', name: 'Ko Zaw' });
  assert.equal(result.member.stamps, 0);
  assert.equal(result.member.token, '7ff2d90b-9778-43d4-a0a8-0069435b7c0c');
  assert.throws(() => handle({ action: 'stamp', phone: '09798123456', spend: 9999, requestId: 'a'.repeat(32) }), /minimum spend/);
  result = handle({ action: 'stamp', phone: '09798123456', spend: 10000, requestId: 'a'.repeat(32) });
  assert.equal(result.member.stamps, 1);
  result = handle({ action: 'stamp', phone: '09798123456', spend: 10000, requestId: 'b'.repeat(32) });
  assert.equal(result.member.stamps, 0);
  assert.equal(result.member.availableCashback, 5000);
  assert.equal(result.member.lifetimeCashback, 5000);
  assert.equal(sheets.logs.getLastRow(), 4);
  result = handle({ action: 'stamp', phone: '09798123456', spend: 10000, requestId: 'b'.repeat(32) });
  assert.equal(result.member.availableCashback, 5000);
  assert.equal(sheets.logs.getLastRow(), 4);
  result = handle({ action: 'withdraw', phone: '09798123456', amount: 3000, requestId: 'c'.repeat(32) });
  assert.equal(result.member.availableCashback, 2000);
  assert.equal(result.member.lifetimeCashback, 5000);
  result = handle({ action: 'withdraw', phone: '09798123456', amount: 3000, requestId: 'c'.repeat(32) });
  assert.equal(result.member.availableCashback, 2000);
  assert.equal(sheets.logs.getLastRow(), 5);
  assert.throws(() => handle({ action: 'withdraw', phone: '09798123456', amount: 3000, requestId: 'd'.repeat(32) }), /available balance/);
  assert.equal(context.dispatch_({ action: 'find', pin: 'long-test-pin', phone: '09798123456' }).member.availableCashback, 2000);
  assert.equal(context.dispatch_({ action: 'member', token: '7ff2d90b-9778-43d4-a0a8-0069435b7c0c' }).member.name, 'Ko Zaw');
});
