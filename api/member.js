import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const scriptPath = /^\/macros\/s\/[\w-]+\/exec$/;
const memberToken = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validScriptUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'script.google.com' && !url.port && !url.username && !url.password && scriptPath.test(url.pathname) && !url.search && !url.hash;
  } catch { return false; }
}

function key() {
  const value = process.env.MEMBER_LINK_KEY || '';
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error('Member link encryption is not configured.');
  return Buffer.from(value, 'hex');
}

function seal(url, token) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ url, token }), 'utf8'), cipher.final()]);
  return 'v1.' + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

function open(code) {
  if (typeof code !== 'string' || !/^v1\.[A-Za-z0-9_-]{40,800}$/.test(code)) throw new Error('Invalid member link.');
  try {
    const data = Buffer.from(code.slice(3), 'base64url');
    if (data.length < 29) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key(), data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    const payload = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8'));
    if (!validScriptUrl(payload.url) || typeof payload.token !== 'string' || !memberToken.test(payload.token)) throw new Error();
    return payload;
  } catch { throw new Error('Invalid member link.'); }
}

async function sheetRequest(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
    redirect: 'follow',
    signal: AbortSignal.timeout(25000)
  });
  if (!response.ok) throw new Error('Could not read the member card.');
  const result = await response.json();
  if (!result.ok || !result.member) throw new Error(result.error || 'Member card not found.');
  return result;
}

function publicMember(member) {
  return {
    name: member.name,
    phone: member.phone,
    stamps: member.stamps,
    availableCashback: member.availableCashback,
    lifetimeCashback: member.lifetimeCashback,
    lastVisit: member.lastVisit,
    history: Array.isArray(member.history) ? member.history.map(item => ({ action: item.action, delta: item.delta, timestamp: item.timestamp })) : []
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed.' });
  try {
    key();
    if (req.method === 'GET') {
      const { url, token } = open(req.query?.code);
      const result = await sheetRequest(url, { action: 'member', token });
      return res.status(200).json({ ok: true, shopName: result.shopName, policy: result.policy, member: publicMember(result.member) });
    }
    const body = req.body;
    if (!body || typeof body !== 'object' || JSON.stringify(body).length > 2000) return res.status(400).json({ ok: false, error: 'Invalid request.' });
    if (body.code) {
      const { url, token } = open(body.code);
      if (body.url !== url || typeof body.pin !== 'string' || !body.pin) return res.status(400).json({ ok: false, error: 'Invalid shop or PIN.' });
      const result = await sheetRequest(url, { action: 'find', token, pin: body.pin });
      return res.status(200).json(result);
    }
    if (!validScriptUrl(body.url) || typeof body.token !== 'string' || !memberToken.test(body.token))
      return res.status(400).json({ ok: false, error: 'Invalid member details.' });
    return res.status(200).json({ ok: true, code: seal(body.url, body.token) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Member link request failed.';
    if (message === 'Member link encryption is not configured.') return res.status(503).json({ ok: false, error: message });
    if (message === 'Invalid member link.') return res.status(400).json({ ok: false, error: message });
    return res.status(400).json({ ok: false, error: message });
  }
}
