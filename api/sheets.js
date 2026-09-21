const allowedActions = new Set(['version', 'configure', 'find', 'enroll', 'stamp', 'withdraw', 'redeem', 'member']);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST required.' });
  const body = req.body;
  if (!body || typeof body !== 'object' || !allowedActions.has(body.action))
    return res.status(400).json({ ok: false, error: 'Invalid request.' });
  let target;
  try { target = new URL(body.url); } catch { return res.status(400).json({ ok: false, error: 'Invalid Apps Script URL.' }); }
  if (target.protocol !== 'https:' || target.hostname !== 'script.google.com' || !/^\/macros\/s\/[\w-]+\/exec$/.test(target.pathname) || target.search)
    return res.status(400).json({ ok: false, error: 'Use a deployed Google Apps Script /exec URL.' });
  if (JSON.stringify(body).length > 12000) return res.status(413).json({ ok: false, error: 'Request too large.' });
  try {
    const response = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow',
      signal: AbortSignal.timeout(25000)
    });
    const content = await response.text();
    if (!response.ok) return res.status(502).json({ ok: false, error: `Apps Script returned HTTP ${response.status}. Check its deployment access.` });
    let result;
    try { result = JSON.parse(content); } catch { return res.status(502).json({ ok: false, error: 'Apps Script did not return JSON. Check its deployment and access settings.' }); }
    return res.status(result.ok ? 200 : 400).json(result);
  } catch {
    return res.status(502).json({ ok: false, error: 'Could not reach Apps Script. Check its URL and deployment.' });
  }
}
