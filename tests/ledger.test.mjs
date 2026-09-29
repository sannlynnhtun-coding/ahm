import test from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA_VERSION, eventToRow, foldLedger } from '../src/Ahm/wwwroot/js/ledger.js';

const tokenA = '11111111-2222-4333-8444-555555555555';
const tokenB = '11111111-2222-4333-8444-666666666666';

function event(eventId, eventType, memberToken, payload = {}, overrides = {}) {
  return {
    eventId,
    eventType,
    memberToken,
    phoneNumber: overrides.phoneNumber ?? '',
    actorLabel: overrides.actorLabel ?? 'Counter 1',
    occurredAtUtc: overrides.occurredAtUtc ?? '2026-09-29T01:00:00.000Z',
    payload,
    schemaVersion: overrides.schemaVersion ?? SCHEMA_VERSION
  };
}

function migrated(eventId, memberToken, phoneNumber, values = {}) {
  return event(eventId, 'MIGRATION_SNAPSHOT', memberToken, {
    name: values.name ?? 'Member',
    stamps: values.stamps ?? 0,
    spendRemainder: values.spendRemainder ?? 0,
    rewardCredits: values.rewardCredits ?? 0,
    availableCashback: values.availableCashback ?? 0,
    lifetimeCashback: values.lifetimeCashback ?? 0,
    claims: values.claims ?? [],
    history: values.history ?? []
  }, { phoneNumber });
}

function purchase(eventId, memberToken, amount, minSpendPerStamp = 10_000, maxStamps = 3) {
  return event(eventId, 'PURCHASE_RECORDED', memberToken, {
    amount,
    policy: { minSpendPerStamp, maxStamps, allowRollover: true }
  });
}

test('fold uses the first event ID and enrollment in Sheet row order', () => {
  const rows = [
    event('enroll-a', 'MEMBER_ENROLLED', tokenA, { name: 'First name' }, {
      phoneNumber: '09111111111', occurredAtUtc: '2026-09-29T03:00:00.000Z'
    }),
    event('enroll-a', 'PURCHASE_RECORDED', tokenA, {
      amount: 30_000, policy: { minSpendPerStamp: 10_000, maxStamps: 3 }
    }, { occurredAtUtc: '2026-09-29T00:00:00.000Z' }),
    event('enroll-duplicate-token', 'MEMBER_ENROLLED', tokenA, { name: 'Changed name' }, {
      phoneNumber: '09222222222'
    }),
    event('enroll-duplicate-phone', 'MEMBER_ENROLLED', tokenB, { name: 'Other token' }, {
      phoneNumber: '09111111111'
    })
  ];

  const result = foldLedger(rows);

  assert.equal(result.acceptedEventCount, 1);
  assert.equal(result.members.length, 1);
  assert.deepEqual(result.members[0], {
    token: tokenA,
    phone: '09111111111',
    name: 'First name',
    stamps: 0,
    spendRemainder: 0,
    rewardCredits: 0,
    availableCashback: 0,
    lifetimeCashback: 0,
    lastVisit: '2026-09-29T03:00:00.000Z',
    claims: [],
    history: [{ action: 'MEMBER_ENROLLED', delta: 0, note: 'Member enrolled', timestamp: '2026-09-29T03:00:00.000Z' }]
  });
  assert.deepEqual(result.diagnostics.map(item => item.reason), [
    'DUPLICATE_EVENT_ID', 'DUPLICATE_ENROLLMENT', 'DUPLICATE_ENROLLMENT'
  ]);
});

test('purchase policy snapshots preserve carried spend and multiple card completions', () => {
  const result = foldLedger([
    migrated('snapshot-a', tokenA, '09111111111'),
    purchase('purchase-a1', tokenA, 25_000),
    purchase('purchase-a2', tokenA, 5_000),
    migrated('snapshot-b', tokenB, '09222222222'),
    purchase('purchase-b1', tokenB, 75_000)
  ]);

  const memberA = result.members.find(member => member.token === tokenA);
  const memberB = result.members.find(member => member.token === tokenB);
  assert.deepEqual(
    { stamps: memberA.stamps, remainder: memberA.spendRemainder, credits: memberA.rewardCredits },
    { stamps: 0, remainder: 0, credits: 1 }
  );
  assert.deepEqual(
    { stamps: memberB.stamps, remainder: memberB.spendRemainder, credits: memberB.rewardCredits },
    { stamps: 1, remainder: 5_000, credits: 2 }
  );
  assert.equal(memberA.history[0].action, 'PURCHASE_RECORDED');
  assert.equal(memberA.history[0].delta, 1);
  assert.equal(result.diagnostics.length, 0);
});

test('finite reward stock is awarded by row order rather than timestamp', () => {
  const reward = {
    id: 'coffee', name: 'Coffee', type: 'FREE_ITEM', value: 0,
    maxDiscount: 0, stockQuantity: 1, active: true
  };
  const base = [
    migrated('snapshot-a', tokenA, '09111111111', { rewardCredits: 1 }),
    migrated('snapshot-b', tokenB, '09222222222', { rewardCredits: 1 })
  ];
  const selectionA = event('select-a', 'REWARD_SELECTED', tokenA, { claimId: 'claim-a', reward }, {
    occurredAtUtc: '2026-09-29T03:00:00.000Z'
  });
  const selectionB = event('select-b', 'REWARD_SELECTED', tokenB, { claimId: 'claim-b', reward }, {
    occurredAtUtc: '2026-09-29T02:00:00.000Z'
  });

  const aFirst = foldLedger([...base, selectionA, selectionB]);
  assert.equal(aFirst.members.find(member => member.token === tokenA).claims[0].id, 'claim-a');
  assert.equal(aFirst.members.find(member => member.token === tokenB).claims.length, 0);
  assert.equal(aFirst.members.find(member => member.token === tokenB).rewardCredits, 1);
  assert.equal(aFirst.diagnostics.at(-1).reason, 'REWARD_SOLD_OUT');

  const bFirst = foldLedger([...base, selectionB, selectionA]);
  assert.equal(bFirst.members.find(member => member.token === tokenB).claims[0].id, 'claim-b');
  assert.equal(bFirst.members.find(member => member.token === tokenA).claims.length, 0);
});

test('redemption uses the selected reward snapshot and cannot be applied twice', () => {
  const result = foldLedger([
    migrated('snapshot', tokenA, '09111111111', { rewardCredits: 1 }),
    event('select', 'REWARD_SELECTED', tokenA, {
      claimId: 'discount-claim',
      reward: {
        id: 'discount', name: 'Original 10% discount', type: 'PERCENT_DISCOUNT',
        value: 10, maxDiscount: 1_000, stockQuantity: null, active: true
      }
    }),
    event('redeem', 'REWARD_REDEEMED', tokenA, { claimId: 'discount-claim', billAmount: 25_000 }),
    event('redeem-again', 'REWARD_REDEEMED', tokenA, { claimId: 'discount-claim', billAmount: 25_000 })
  ], [{
    id: 'discount', name: 'Changed to 50%', type: 'PERCENT_DISCOUNT', value: 50,
    maxDiscount: 10_000, stockQuantity: 0, active: false
  }]);

  const member = result.members[0];
  assert.deepEqual(member.claims[0], {
    id: 'discount-claim',
    name: 'Original 10% discount',
    type: 'PERCENT_DISCOUNT',
    value: 10,
    maxDiscount: 1_000,
    status: 'REDEEMED',
    selectedAt: '2026-09-29T01:00:00.000Z',
    redeemedAt: '2026-09-29T01:00:00.000Z'
  });
  assert.equal(member.history[0].action, 'REWARD_REDEEMED');
  assert.equal(member.history[0].delta, -1_000);
  assert.equal(result.diagnostics.at(-1).reason, 'DUPLICATE_OR_UNKNOWN_REDEMPTION');
});

test('cashback mutations validate balances and malformed events do not stop later rows', () => {
  const oversizedPayload = JSON.stringify({ note: 'x'.repeat(20_001) });
  const result = foldLedger([
    { eventId: '', eventType: 'MEMBER_ENROLLED', memberToken: tokenB, payload: {}, schemaVersion: SCHEMA_VERSION },
    migrated('snapshot', tokenA, '09111111111', { rewardCredits: 1 }),
    event('bad-json', 'PURCHASE_RECORDED', tokenA, '{'),
    event('unsafe-money', 'PURCHASE_RECORDED', tokenA, {
      amount: Number.MAX_SAFE_INTEGER + 1,
      policy: { minSpendPerStamp: 10_000, maxStamps: 3 }
    }),
    event('oversized', 'PURCHASE_RECORDED', tokenA, oversizedPayload),
    event('cashback', 'REWARD_SELECTED', tokenA, {
      reward: { id: 'cash', name: 'Cashback', type: 'CASHBACK', value: 5_000, stockQuantity: null }
    }),
    event('below-minimum', 'CASHBACK_PAID', tokenA, { amount: 500, minWithdrawal: 1_000 }),
    event('payout', 'CASHBACK_PAID', tokenA, { amount: 3_000, minWithdrawal: 1_000 }),
    event('over-balance', 'CASHBACK_PAID', tokenA, { amount: 3_000, minWithdrawal: 1_000 }),
    purchase('valid-after-errors', tokenA, 10_000)
  ]);

  const member = result.members[0];
  assert.equal(member.availableCashback, 2_000);
  assert.equal(member.lifetimeCashback, 5_000);
  assert.equal(member.stamps, 1);
  assert.equal(result.acceptedEventCount, 4);
  assert.deepEqual(result.diagnostics.map(item => item.reason), [
    'INVALID_EVENT', 'MALFORMED_PAYLOAD', 'UNSAFE_NUMBER', 'MALFORMED_PAYLOAD',
    'INVALID_CASHBACK_PAYOUT', 'INVALID_CASHBACK_PAYOUT'
  ]);
});

test('eventToRow emits the immutable eight-column v3 wire format', () => {
  const row = eventToRow(event('event-1', 'purchase_recorded', tokenA, { amount: 12_500 }, {
    phoneNumber: '09111111111', actorLabel: 'Owner'
  }));

  assert.equal(row.length, 1);
  assert.deepEqual(row[0].slice(0, 6), [
    'event-1', 'PURCHASE_RECORDED', tokenA, '09111111111', 'Owner', '2026-09-29T01:00:00.000Z'
  ]);
  assert.deepEqual(JSON.parse(row[0][6]), { amount: 12_500 });
  assert.equal(row[0][7], 3);
  assert.throws(() => eventToRow(event('too-large', 'PURCHASE_RECORDED', tokenA, { note: 'x'.repeat(20_001) })), /PAYLOAD_TOO_LARGE/);
});
