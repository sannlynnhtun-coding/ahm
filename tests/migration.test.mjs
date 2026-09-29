import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMigrationPlan } from '../src/Ahm/wwwroot/js/migration.js';
import { foldLedger } from '../src/Ahm/wwwroot/js/ledger.js';

const token = '11111111-2222-4333-8444-555555555555';

function source() {
  return {
    members: [
      ['Phone_Number', 'Customer_Name', 'Current_Stamps', 'Available_Cashback', 'Lifetime_Cashback', 'Last_Visit', 'Member_Token', 'Spend_Remainder', 'Reward_Credits'],
      ['09111111111', 'Mya', 2, 4000, 9000, '2026-09-01', token, 2500, 1]
    ],
    logs: [
      ['Log_ID', 'Phone_Number', 'Action', 'Delta_Amount', 'Note', 'Timestamp', 'Request_ID'],
      [1, '09111111111', 'STAMP_ADD', 2, 'Old purchase', '2026-09-01', 'request-1']
    ],
    config: [
      ['Key', 'Value'], ['shopName', 'Legacy Tea'], ['minSpendPerStamp', 10000], ['maxStamps', 10],
      ['cashbackReward', 5000], ['minWithdrawal', 1000], ['allowRollover', true]
    ],
    rewards: [
      ['Reward_ID', 'Name', 'Type', 'Value', 'Max_Discount', 'Description', 'Active', 'Stock_Quantity'],
      ['reward-1', 'Tea', 'FREE_ITEM', 0, 0, 'One tea', true, 5]
    ],
    claims: [
      ['Claim_ID', 'Phone_Number', 'Reward_ID', 'Name', 'Type', 'Value', 'Max_Discount', 'Status', 'Selected_At', 'Redeemed_At', 'Request_ID', 'Stock_Limited'],
      ['claim-1', '09111111111', 'reward-1', 'Tea', 'FREE_ITEM', 0, 0, 'Pending', '2026-09-01', '', 'request-2', true]
    ]
  };
}

test('v2 migration plan preserves member tokens, balances, claims, rewards and history', () => {
  const input = source();
  const original = structuredClone(input);
  const plan = buildMigrationPlan(input, {
    publicShopId: 'legacy_shop', actorLabel: 'Owner phone', defaultShopName: 'Fallback',
    occurredAtUtc: '2026-09-29T00:00:00.000Z'
  });

  assert.deepEqual(input, original);
  assert.equal(plan.setup.shopName, 'Legacy Tea');
  assert.equal(plan.setup.rewards[0].id, 'reward-1');
  assert.equal(plan.ledgerRows[0][0], `migration-${token}`);
  assert.equal(plan.ledgerRows[0][2], token);
  assert.deepEqual(plan.archiveRows, input.logs);

  const folded = foldLedger(plan.ledgerRows, plan.setup.rewards);
  const member = folded.members[0];
  assert.equal(member.token, token);
  assert.equal(member.stamps, 2);
  assert.equal(member.spendRemainder, 2500);
  assert.equal(member.rewardCredits, 1);
  assert.equal(member.availableCashback, 4000);
  assert.equal(member.lifetimeCashback, 9000);
  assert.equal(member.claims[0].status, 'PENDING');
  assert.equal(member.claims[0].value, 0);
  assert.equal(member.history[0].note, 'Old purchase');
  assert.equal(folded.stockUsed['reward-1'], 1);
});

test('pre-extension v2 rows default new state and invalid members are diagnosed', () => {
  const input = source();
  input.members = [
    input.members[0].slice(0, 7),
    ['09222222222', 'Old Member', 7, 1000, 2000, '2025-01-01', token],
    ['09333333333', 'Missing Token', 0, 0, 0, '', '']
  ];
  input.rewards = [];
  input.claims = [];

  const plan = buildMigrationPlan(input, {
    publicShopId: 'legacy_shop', actorLabel: 'Owner', occurredAtUtc: '2026-09-29T00:00:00.000Z'
  });
  const member = foldLedger(plan.ledgerRows, plan.setup.rewards).members[0];

  assert.equal(member.token, token);
  assert.equal(member.spendRemainder, 0);
  assert.equal(member.rewardCredits, 0);
  assert.equal(plan.setup.rewards[0].id, 'legacy-cashback');
  assert.deepEqual(plan.diagnostics, [{ row: 3, reason: 'INVALID_LEGACY_MEMBER' }]);
});

test('migration snapshot IDs are stable and duplicate snapshots fold only once', () => {
  const input = source();
  const context = { publicShopId: 'legacy_shop', actorLabel: 'Owner', occurredAtUtc: '2026-09-29T00:00:00.000Z' };
  const first = buildMigrationPlan(input, context);
  const second = buildMigrationPlan(input, context);

  assert.equal(first.ledgerRows[0][0], second.ledgerRows[0][0]);
  const folded = foldLedger([...first.ledgerRows, ...second.ledgerRows], first.setup.rewards);
  assert.equal(folded.members.length, 1);
  assert.equal(folded.diagnostics[0].reason, 'DUPLICATE_EVENT_ID');
});
