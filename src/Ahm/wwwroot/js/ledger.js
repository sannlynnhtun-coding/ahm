export const SCHEMA_VERSION = 3;

export const EVENT_TYPES = Object.freeze([
  'MEMBER_ENROLLED',
  'PURCHASE_RECORDED',
  'REWARD_SELECTED',
  'REWARD_REDEEMED',
  'CASHBACK_PAID'
]);

const MAX_PAYLOAD_LENGTH = 20_000;

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function clean(value, max = 256) {
  return String(value ?? '').trim().slice(0, max);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function parsePayload(value) {
  if (value && typeof value === 'object') return clone(value);
  const text = String(value ?? '');
  if (!text || text.length > MAX_PAYLOAD_LENGTH) throw new Error('invalid payload');
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid payload');
  return parsed;
}

function containsUnsafeNumber(value) {
  if (typeof value === 'number') return !Number.isSafeInteger(value);
  if (Array.isArray(value)) return value.some(containsUnsafeNumber);
  if (value && typeof value === 'object') return Object.values(value).some(containsUnsafeNumber);
  return false;
}

function emptyMember(token, phone = '') {
  return {
    token: clean(token, 128),
    phone: clean(phone, 64),
    name: '',
    stamps: 0,
    spendRemainder: 0,
    rewardCredits: 0,
    availableCashback: 0,
    lifetimeCashback: 0,
    lastVisit: '',
    claims: [],
    history: []
  };
}

function addHistory(member, action, delta, note, timestamp) {
  member.history.unshift({ action, delta: number(delta), note: clean(note, 512), timestamp: clean(timestamp, 64) });
  if (member.history.length > 50) member.history.length = 50;
}

function rewardKey(reward) {
  return clean(reward.id || reward.rewardId || reward.name, 128);
}

function normalizeReward(source) {
  const rawType = clean(source.type || source.rewardType, 32).toUpperCase();
  const type = rawType === 'ITEM' ? 'FREE_ITEM' : rawType;
  if (!['CASHBACK', 'PERCENT_DISCOUNT', 'FREE_ITEM'].includes(type)) throw new Error('unsupported reward');
  return {
    id: rewardKey(source),
    name: clean(source.name || source.rewardName, 160),
    type,
    value: Math.max(0, number(source.value ?? source.rewardValue)),
    maxDiscount: Math.max(0, number(source.maxDiscount ?? source.cap)),
    stockQuantity: source.stockQuantity == null || source.stockQuantity === '' ? null : Math.max(0, number(source.stockQuantity)),
    description: clean(source.description, 500),
    active: source.active !== false && String(source.active).toLowerCase() !== 'false'
  };
}

function rowToEvent(row) {
  if (Array.isArray(row)) {
    return {
      eventId: clean(row[0], 128), eventType: clean(row[1], 64).toUpperCase(),
      memberToken: clean(row[2], 128), phoneNumber: clean(row[3], 64),
      actorLabel: clean(row[4], 128), occurredAtUtc: clean(row[5], 64),
      payload: row[6], schemaVersion: number(row[7])
    };
  }
  return {
    eventId: clean(row.eventId ?? row.Event_ID, 128),
    eventType: clean(row.eventType ?? row.Event_Type, 64).toUpperCase(),
    memberToken: clean(row.memberToken ?? row.Member_Token, 128),
    phoneNumber: clean(row.phoneNumber ?? row.Phone_Number, 64),
    actorLabel: clean(row.actorLabel ?? row.Actor_Label, 128),
    occurredAtUtc: clean(row.occurredAtUtc ?? row.Occurred_At_UTC, 64),
    payload: row.payload ?? row.Payload_JSON,
    schemaVersion: number(row.schemaVersion ?? row.Schema_Version)
  };
}

function diagnostic(list, index, event, reason) {
  list.push({ row: index + 2, eventId: event.eventId, eventType: event.eventType, reason });
}

/** Deterministically folds ledger rows in Sheet row order. The first Event_ID wins. */
export function foldLedger(inputRows, rewardCatalog = []) {
  const rows = Array.isArray(inputRows) ? inputRows : [];
  const membersByToken = new Map();
  const tokensByPhone = new Map();
  const usedEventIds = new Set();
  let acceptedEventCount = 0;
  const selectedStock = new Map();
  const diagnostics = [];
  const catalog = new Map();

  for (const raw of rewardCatalog || []) {
    try {
      const reward = normalizeReward(raw);
      if (reward.id) catalog.set(reward.id, reward);
    } catch { /* malformed catalog rows are not ledger events */ }
  }

  for (let index = 0; index < rows.length; index++) {
    const raw = rows[index];
    if (index === 0 && Array.isArray(raw) && clean(raw[0]) === 'Event_ID') continue;
    const event = rowToEvent(raw);

    if (!event.eventId || !EVENT_TYPES.includes(event.eventType) || event.schemaVersion !== SCHEMA_VERSION) {
      diagnostic(diagnostics, index, event, 'INVALID_EVENT');
      continue;
    }
    if (usedEventIds.has(event.eventId)) {
      diagnostic(diagnostics, index, event, 'DUPLICATE_EVENT_ID');
      continue;
    }
    usedEventIds.add(event.eventId);

    let payload;
    try { payload = parsePayload(event.payload); }
    catch {
      diagnostic(diagnostics, index, event, 'MALFORMED_PAYLOAD');
      continue;
    }
    if (containsUnsafeNumber(payload)) {
      diagnostic(diagnostics, index, event, 'UNSAFE_NUMBER');
      continue;
    }

    const member = membersByToken.get(event.memberToken);

    if (event.eventType === 'MEMBER_ENROLLED') {
      const phone = event.phoneNumber || clean(payload.phone, 64);
      if (!event.memberToken || !phone || membersByToken.has(event.memberToken) || tokensByPhone.has(phone)) {
        diagnostic(diagnostics, index, event, 'DUPLICATE_ENROLLMENT');
        continue;
      }
      const enrolled = emptyMember(event.memberToken, phone);
      enrolled.name = clean(payload.name, 160);
      enrolled.lastVisit = event.occurredAtUtc;
      addHistory(enrolled, 'MEMBER_ENROLLED', 0, 'Member enrolled', event.occurredAtUtc);
      membersByToken.set(enrolled.token, enrolled);
      tokensByPhone.set(phone, enrolled.token);
      acceptedEventCount++;
      continue;
    }

    if (!member) {
      diagnostic(diagnostics, index, event, 'MEMBER_NOT_FOUND');
      continue;
    }

    if (event.eventType === 'PURCHASE_RECORDED') {
      const amount = number(payload.amount);
      const policy = payload.policy || {};
      const minSpend = number(policy.minSpendPerStamp);
      const maxStamps = number(policy.maxStamps);
      if (amount <= 0 || minSpend <= 0 || maxStamps <= 0) {
        diagnostic(diagnostics, index, event, 'INVALID_PURCHASE');
        continue;
      }
      const totalSpend = member.spendRemainder + amount;
      const earnedStamps = Math.floor(totalSpend / minSpend);
      member.spendRemainder = policy.allowRollover === false ? 0 : totalSpend % minSpend;
      const stampTotal = member.stamps + earnedStamps;
      const completedCards = Math.floor(stampTotal / maxStamps);
      member.stamps = stampTotal % maxStamps;
      member.rewardCredits += completedCards;
      member.lastVisit = event.occurredAtUtc;
      addHistory(member, 'PURCHASE_RECORDED', earnedStamps, `Purchase ${amount}`, event.occurredAtUtc);
      acceptedEventCount++;
      continue;
    }

    if (event.eventType === 'REWARD_SELECTED') {
      let reward;
      try { reward = normalizeReward(payload.reward || payload); }
      catch {
        diagnostic(diagnostics, index, event, 'INVALID_REWARD_SNAPSHOT');
        continue;
      }
      const key = rewardKey(reward);
      const selected = selectedStock.get(key) || 0;
      if (member.rewardCredits < 1) {
        diagnostic(diagnostics, index, event, 'INSUFFICIENT_REWARD_CREDITS');
        continue;
      }
      if (!key || (reward.stockQuantity != null && selected >= reward.stockQuantity)) {
        diagnostic(diagnostics, index, event, 'REWARD_SOLD_OUT');
        continue;
      }
      selectedStock.set(key, selected + 1);
      member.rewardCredits--;
      if (reward.type === 'CASHBACK') {
        member.availableCashback += reward.value;
        member.lifetimeCashback += reward.value;
        addHistory(member, 'REWARD_SELECTED', reward.value, reward.name, event.occurredAtUtc);
      } else {
        member.claims.push({
          id: clean(payload.claimId || event.eventId, 128), name: reward.name, type: reward.type,
          value: reward.value, maxDiscount: reward.maxDiscount, status: 'PENDING',
          selectedAt: event.occurredAtUtc, redeemedAt: ''
        });
        addHistory(member, 'REWARD_SELECTED', -1, reward.name, event.occurredAtUtc);
      }
      member.lastVisit = event.occurredAtUtc;
      acceptedEventCount++;
      continue;
    }

    if (event.eventType === 'REWARD_REDEEMED') {
      const claimId = clean(payload.claimId, 128);
      const claim = member.claims.find(item => item.id === claimId);
      if (!claim || claim.status !== 'PENDING') {
        diagnostic(diagnostics, index, event, 'DUPLICATE_OR_UNKNOWN_REDEMPTION');
        continue;
      }
      let discount = 0;
      if (claim.type === 'PERCENT_DISCOUNT') {
        const billAmount = Math.max(0, number(payload.billAmount));
        if (billAmount <= 0) {
          diagnostic(diagnostics, index, event, 'INVALID_REDEMPTION');
          continue;
        }
        discount = Math.floor(billAmount * claim.value / 100);
        if (claim.maxDiscount > 0) discount = Math.min(discount, claim.maxDiscount);
      }
      claim.status = 'REDEEMED';
      claim.redeemedAt = event.occurredAtUtc;
      addHistory(member, 'REWARD_REDEEMED', -discount, claim.name, event.occurredAtUtc);
      member.lastVisit = event.occurredAtUtc;
      acceptedEventCount++;
      continue;
    }

    if (event.eventType === 'CASHBACK_PAID') {
      const amount = number(payload.amount);
      const minimum = Math.max(0, number(payload.minWithdrawal));
      if (amount <= 0 || amount < minimum || amount > member.availableCashback) {
        diagnostic(diagnostics, index, event, 'INVALID_CASHBACK_PAYOUT');
        continue;
      }
      member.availableCashback -= amount;
      member.lastVisit = event.occurredAtUtc;
      addHistory(member, 'CASHBACK_PAID', -amount, 'Cashback paid', event.occurredAtUtc);
      acceptedEventCount++;
    }
  }

  const members = Array.from(membersByToken.values());
  return {
    members,
    diagnostics,
    acceptedEventCount,
    stockUsed: Object.fromEntries(selectedStock)
  };
}

export function eventToRow(event) {
  const payloadJson = JSON.stringify(event.payload || {});
  if (payloadJson.length > MAX_PAYLOAD_LENGTH) throw new Error('PAYLOAD_TOO_LARGE');
  return [[
    clean(event.eventId, 128), clean(event.eventType, 64).toUpperCase(),
    clean(event.memberToken, 128), clean(event.phoneNumber, 64), clean(event.actorLabel, 128),
    clean(event.occurredAtUtc, 64), payloadJson, SCHEMA_VERSION
  ]];
}

export function newEvent(eventType, memberToken, phoneNumber, actorLabel, payload, eventId) {
  return {
    eventId: eventId || crypto.randomUUID(), eventType, memberToken, phoneNumber, actorLabel,
    occurredAtUtc: new Date().toISOString(), payload: clone(payload || {}), schemaVersion: SCHEMA_VERSION
  };
}

if (typeof window !== 'undefined') {
  window.ahmLedger = { SCHEMA_VERSION, EVENT_TYPES, foldLedger, eventToRow, newEvent };
}
