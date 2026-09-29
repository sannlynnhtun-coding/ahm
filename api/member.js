import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const scriptPath = /^\/macros\/s\/[\w-]+\/exec$/;
const legacyMemberToken = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validScriptUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'script.google.com' && !url.port &&
      !url.username && !url.password && scriptPath.test(url.pathname) && !url.search && !url.hash;
  } catch { return false; }
}

function key() {
  const value = process.env.MEMBER_LINK_KEY || '';
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error('Member link encryption is not configured.');
  return Buffer.from(value, 'hex');
}

// Retained only to generate fixtures and validate old links. New Ahm clients never create encrypted links.
export function sealLegacyCode(url, token) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify({ url, token }), 'utf8'), cipher.final()]);
  return 'v1.' + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

export function openLegacyCode(code) {
  if (typeof code !== 'string' || !/^v1\.[A-Za-z0-9_-]{40,800}$/.test(code)) throw new Error('Invalid member link.');
  try {
    const data = Buffer.from(code.slice(3), 'base64url');
    if (data.length < 29) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key(), data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    const payload = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8'));
    if (!validScriptUrl(payload.url) || typeof payload.token !== 'string' || !legacyMemberToken.test(payload.token)) throw new Error();
    return payload;
  } catch { throw new Error('Invalid member link.'); }
}

export function derivePublicShopId(url) {
  if (!validScriptUrl(url)) throw new Error('Invalid Apps Script URL.');
  const subkey = createHmac('sha256', key()).update('ahm-public-shop-id-subkey-v1').digest();
  const parsed = new URL(url);
  const canonicalUrl = `${parsed.protocol}//${parsed.hostname}${parsed.pathname}`;
  const digest = createHmac('sha256', subkey).update(canonicalUrl, 'utf8').digest('base64url').slice(0, 24);
  return `legacy_${digest}`;
}

function pathFor(url, token) {
  return `/member?s=${encodeURIComponent(derivePublicShopId(url))}&t=${encodeURIComponent(token)}`;
}

function json(res, status, body) { return res.status(status).json(body); }

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  try {
    key();
    if (req.method === 'GET') {
      const { url, token } = openLegacyCode(req.query?.code);
      const location = pathFor(url, token);
      res.status(302);
      res.setHeader('Location', location);
      if (typeof res.end === 'function') return res.end();
      res.body = null;
      return;
    }
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Method not allowed.' });
    const body = req.body;
    if (!body || typeof body !== 'object' || JSON.stringify(body).length > 3000)
      return json(res, 400, { ok: false, error: 'Invalid request.' });
    if (body.action === 'legacy-shop-id' && validScriptUrl(body.url))
      return json(res, 200, { ok: true, publicShopId: derivePublicShopId(body.url) });
    if (body.action === 'legacy-path' && validScriptUrl(body.url) && legacyMemberToken.test(String(body.token || '')))
      return json(res, 200, { ok: true, path: pathFor(body.url, body.token) });
    return json(res, 410, { ok: false, error: 'Legacy member mutations and link creation are no longer supported.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Member link request failed.';
    return json(res, message === 'Member link encryption is not configured.' ? 503 : 400, { ok: false, error: message });
  }
}
