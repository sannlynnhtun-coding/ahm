import { eventToRow, SCHEMA_VERSION } from './ledger.js';

function text(value, max = 256) { return String(value ?? '').trim().slice(0, max); }
function integer(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}
function bool(value, fallback = true) {
  if (value == null || value === '') return fallback;
  return value === true || String(value).toLowerCase() === 'true';
}
function objects(rows = []) {
  if (!rows.length) return [];
  const headers = rows[0].map(header => String(header || ''));
  return rows.slice(1).filter(row => row.some(cell => cell !== '')).map(row =>
    Object.fromEntries(headers.map((header, index) => [header, row[index]])));
}
function settings(rows = []) {
  return Object.fromEntries(rows.slice(1).filter(row => row?.[0]).map(row => [String(row[0]), row[1]]));
}

export function buildMigrationPlan(source, context) {
  const members = objects(source.members);
  const logs = objects(source.logs);
  const config = settings(source.config);
  const claims = objects(source.claims);
  const diagnostics = [];
  const occurredAtUtc = text(context.occurredAtUtc || new Date().toISOString(), 64);
  const rewards = objects(source.rewards).map((row, index) => ({
    id: text(row.Reward_ID || `legacy-reward-${index + 1}`, 128), name: text(row.Name || 'Reward', 160),
    type: text(row.Type || 'CASHBACK', 32).toUpperCase(), value: Math.max(0, integer(row.Value)),
    maxDiscount: Math.max(0, integer(row.Max_Discount)),
    stockQuantity: row.Stock_Quantity === '' || row.Stock_Quantity == null ? null : Math.max(0, integer(row.Stock_Quantity)),
    description: text(row.Description, 500), active: bool(row.Active)
  }));
  const cashbackReward = Math.max(0, integer(config.cashbackReward, 10000));
  const setup = {
    publicShopId: text(context.publicShopId, 128), shopName: text(config.shopName || context.defaultShopName || 'Ahm Shop', 160),
    staffLabel: text(context.actorLabel, 128),
    policy: {
      minSpendPerStamp: Math.max(1, integer(config.minSpendPerStamp, 10000)),
      maxStamps: Math.min(30, Math.max(1, integer(config.maxStamps, 10))),
      cashbackReward,
      minWithdrawal: Math.max(1, integer(config.minWithdrawal, 1000)),
      allowRollover: bool(config.allowRollover)
    },
    rewards: rewards.length ? rewards : [{
      id: 'legacy-cashback', name: 'Cashback', type: 'CASHBACK', value: cashbackReward,
      maxDiscount: 0, stockQuantity: null, description: '', active: true
    }]
  };
  const events = [];
  for (let index = 0; index < members.length; index++) {
    const member = members[index];
    const token = text(member.Member_Token, 128);
    const phone = text(member.Phone_Number, 64);
    if (!token || !phone) {
      diagnostics.push({ row: index + 2, reason: 'INVALID_LEGACY_MEMBER' });
      continue;
    }
    const memberClaims = claims.filter(claim => String(claim.Phone_Number) === String(member.Phone_Number)).map(claim => ({
      id: text(claim.Claim_ID, 128), rewardId: text(claim.Reward_ID, 128), name: text(claim.Name, 160),
      type: text(claim.Type, 32).toUpperCase(), value: integer(claim.Value), maxDiscount: integer(claim.Max_Discount),
      status: text(claim.Status, 32).toUpperCase(), selectedAt: text(claim.Selected_At, 64),
      redeemedAt: text(claim.Redeemed_At, 64), stockLimited: bool(claim.Stock_Limited, false)
    }));
    const history = logs.filter(log => String(log.Phone_Number) === String(member.Phone_Number)).slice(-50).reverse().map(log => ({
      action: text(log.Action, 64), delta: integer(log.Delta_Amount), note: text(log.Note, 512), timestamp: text(log.Timestamp, 64)
    }));
    events.push({
      eventId: `migration-${token}`.slice(0, 128), eventType: 'MIGRATION_SNAPSHOT', memberToken: token,
      phoneNumber: phone, actorLabel: text(context.actorLabel, 128), occurredAtUtc,
      payload: {
        name: text(member.Customer_Name, 160), phone, stamps: Math.max(0, integer(member.Current_Stamps)),
        spendRemainder: Math.max(0, integer(member.Spend_Remainder)), rewardCredits: Math.max(0, integer(member.Reward_Credits)),
        availableCashback: Math.max(0, integer(member.Available_Cashback)), lifetimeCashback: Math.max(0, integer(member.Lifetime_Cashback)),
        lastVisit: text(member.Last_Visit, 64), claims: memberClaims, history
      },
      schemaVersion: SCHEMA_VERSION
    });
  }
  return {
    setup,
    ledgerRows: events.map(event => eventToRow(event)[0]),
    archiveRows: (source.logs || []).map(row => [...row]),
    diagnostics
  };
}
