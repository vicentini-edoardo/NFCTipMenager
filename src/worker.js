import {
  json, parseJson, csvCell,
  requireAdminKey, basicAuthChallenge,
} from './lib/http.js';
import { signingSecret, signEditToken, verifyEditToken } from './lib/token.js';
import { sendLowTipsAlert, sendWelcomeEmail, sendTestEmail } from './lib/email.js';
import { buildTipPage } from './pages/tip.js';
import { buildAdminPage } from './pages/admin.js';

const DEFAULT_ALERT_THRESHOLD = 5;

async function getSetting(env, key) {
  const row = await env.afm_tips_db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row?.value ?? null;
}

async function getAlertThreshold(env) {
  const raw = await getSetting(env, 'alert_threshold');
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_ALERT_THRESHOLD;
}

async function route(request, env, ctx) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;

  // --- Public tap page -------------------------------------------------------
  if (method === 'GET' && pathname.startsWith('/t/')) {
    const boxId = pathname.slice(3);
    if (!boxId) return new Response('Not found', { status: 404 });
    return new Response(buildTipPage(boxId), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // --- Record a tap (public, rate-limited) -----------------------------------
  if (method === 'POST' && pathname === '/log') {
    const body = await parseJson(request);
    if (!body) return json({ ok: false, error: 'invalid json' });
    const { boxId, user } = body;
    if (!boxId || !user) return json({ ok: false, error: 'missing fields' });

    if (env.RATE_LIMITER) {
      const { success } = await env.RATE_LIMITER.limit({ key: `log:${boxId}` });
      if (!success) return json({ ok: false, error: 'rate limited' }, { status: 429 });
    }

    const [box, threshold] = await Promise.all([
      env.afm_tips_db.prepare('SELECT * FROM boxes WHERE box_id = ?').bind(boxId).first(),
      getAlertThreshold(env),
    ]);
    if (!box) return json({ ok: false, error: 'unregistered' });

    const now = new Date().toISOString();
    // Atomic: assign the next tip number and insert in a single statement so
    // concurrent taps cannot collide on the same number.
    const inserted = await env.afm_tips_db.prepare(
      `INSERT INTO usage_log (timestamp, box_id, tip_model, username, tip_number)
       SELECT ?, ?, ?, ?, COALESCE(MAX(tip_number), 0) + 1 FROM usage_log WHERE box_id = ?
       RETURNING id, tip_number`
    ).bind(now, boxId, box.tip_model, user, boxId).first();
    const tipNumber = inserted.tip_number;

    const remaining = box.quantity != null ? box.quantity - tipNumber : null;
    if (remaining != null && remaining <= threshold && !box.alerted_at) {
      ctx.waitUntil((async () => {
        await sendLowTipsAlert(env, boxId, box.tip_model, box.location, remaining, threshold);
        await env.afm_tips_db.prepare('UPDATE boxes SET alerted_at = ? WHERE box_id = ?').bind(now, boxId).run();
      })());
    }

    const editToken = await signEditToken(signingSecret(env), inserted.id);
    return json({ ok: true, user, time: now, tipModel: box.tip_model, boxId, tipNumber, totalQuantity: box.quantity, logId: inserted.id, editToken });
  }

  // --- User self-correct of their own tip number (token-gated) ---------------
  if (method === 'POST' && pathname === '/log/set-tip') {
    const body = await parseJson(request);
    if (!body) return json({ ok: false, error: 'invalid json' });
    const { id, tipNumber, editToken } = body;
    if (!id || tipNumber == null || tipNumber < 1) return json({ ok: false, error: 'missing fields' });
    if (!await verifyEditToken(signingSecret(env), id, editToken)) {
      return json({ ok: false, error: 'invalid or expired token' }, { status: 403 });
    }
    try {
      await env.afm_tips_db.prepare('UPDATE usage_log SET tip_number = ? WHERE id = ?').bind(tipNumber, id).run();
    } catch (e) {
      return json({ ok: false, error: 'tip number already used for this box' });
    }
    return json({ ok: true });
  }

  // --- Admin: correct any log entry ------------------------------------------
  if (method === 'POST' && pathname === '/log/correct') {
    const body = await parseJson(request);
    if (!body) return json({ ok: false, error: 'invalid json' });
    if (!requireAdminKey(body, env)) return json({ ok: false, error: 'invalid admin key' });
    const { id, tipNumber } = body;
    if (!id || tipNumber == null) return json({ ok: false, error: 'missing fields' });
    try {
      await env.afm_tips_db.prepare('UPDATE usage_log SET tip_number = ? WHERE id = ?').bind(tipNumber, id).run();
    } catch (e) {
      return json({ ok: false, error: 'tip number already used for this box' });
    }
    return json({ ok: true });
  }

  // --- Admin: insert a missed entry ------------------------------------------
  if (method === 'POST' && pathname === '/log/add') {
    const body = await parseJson(request);
    if (!body) return json({ ok: false, error: 'invalid json' });
    if (!requireAdminKey(body, env)) return json({ ok: false, error: 'invalid admin key' });
    const { boxId, username, tipNumber, timestamp } = body;
    if (!boxId || !username) return json({ ok: false, error: 'missing fields' });
    const box = await env.afm_tips_db.prepare('SELECT * FROM boxes WHERE box_id = ?').bind(boxId).first();
    if (!box) return json({ ok: false, error: 'box not registered' });
    const ts = timestamp || new Date().toISOString();
    try {
      await env.afm_tips_db.prepare(
        'INSERT INTO usage_log (timestamp, box_id, tip_model, username, tip_number) VALUES (?, ?, ?, ?, ?)'
      ).bind(ts, boxId, box.tip_model, username, tipNumber || null).run();
    } catch (e) {
      return json({ ok: false, error: 'tip number already used for this box' });
    }
    return json({ ok: true });
  }

  // --- Admin: register a new box ---------------------------------------------
  if (method === 'POST' && pathname === '/register') {
    const body = await parseJson(request);
    if (!body) return json({ ok: false, error: 'invalid json' });
    if (!requireAdminKey(body, env)) return json({ ok: false, error: 'invalid admin key' });
    const { boxId, tipModel, lot, quantity, purchaseDate, registeredBy, location } = body;
    if (!boxId || !tipModel) return json({ ok: false, error: 'missing fields' });
    const now = new Date().toISOString();
    try {
      await env.afm_tips_db.prepare(
        'INSERT INTO boxes (box_id, tip_model, lot, quantity, purchase_date, status, registered_by, registered_at, location) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(boxId, tipModel, lot || null, quantity || null, purchaseDate || null, 'active', registeredBy || null, now, location || null).run();
      return json({ ok: true });
    } catch (e) {
      return json({ ok: false, error: e.message });
    }
  }

  // --- Admin: update box metadata --------------------------------------------
  if (method === 'POST' && pathname === '/box/update') {
    const body = await parseJson(request);
    if (!body) return json({ ok: false, error: 'invalid json' });
    if (!requireAdminKey(body, env)) return json({ ok: false, error: 'invalid admin key' });
    const { boxId, tipModel, lot, quantity, purchaseDate, status, registeredBy, location } = body;
    if (!boxId) return json({ ok: false, error: 'missing boxId' });
    // Changing quantity is treated as a refill: re-arm the low-tip alert.
    await env.afm_tips_db.prepare(
      'UPDATE boxes SET tip_model=?, lot=?, quantity=?, purchase_date=?, status=?, registered_by=?, location=?, alerted_at=NULL WHERE box_id=?'
    ).bind(tipModel || null, lot || null, quantity != null && quantity !== '' ? Number(quantity) : null, purchaseDate || null, status || 'active', registeredBy || null, location || null, boxId).run();
    return json({ ok: true });
  }

  // --- Admin: reset (delete) a box's usage log -------------------------------
  if (method === 'POST' && pathname === '/box/reset-tips') {
    const body = await parseJson(request);
    if (!body) return json({ ok: false, error: 'invalid json' });
    if (!requireAdminKey(body, env)) return json({ ok: false, error: 'invalid admin key' });
    const { boxId } = body;
    if (!boxId) return json({ ok: false, error: 'missing boxId' });
    await env.afm_tips_db.batch([
      env.afm_tips_db.prepare('DELETE FROM usage_log WHERE box_id = ?').bind(boxId),
      env.afm_tips_db.prepare('UPDATE boxes SET alerted_at = NULL WHERE box_id = ?').bind(boxId),
    ]);
    return json({ ok: true });
  }

  // --- Admin: send a test email (Basic auth) ---------------------------------
  if (method === 'POST' && pathname === '/settings/test-email') {
    const challenge = basicAuthChallenge(request, env);
    if (challenge) return challenge;
    const toEmail = await getSetting(env, 'alert_email');
    if (!toEmail) return json({ ok: false, error: 'No alert_email configured in settings' });
    if (!env.BREVO_API_KEY) return json({ ok: false, error: 'BREVO_API_KEY secret not set' });
    const adminUrl = new URL('/admin', request.url).href;
    const result = await sendTestEmail(env, toEmail, adminUrl);
    return json(result);
  }

  // --- Admin: save a setting value -------------------------------------------
  if (method === 'POST' && pathname === '/settings') {
    const body = await parseJson(request);
    if (!body) return json({ ok: false, error: 'invalid json' });
    if (!requireAdminKey(body, env)) return json({ ok: false, error: 'invalid admin key' });
    const { key, value } = body;
    if (!key) return json({ ok: false, error: 'missing key' });
    await env.afm_tips_db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, value || null).run();
    if (key === 'alert_email' && value) {
      const adminUrl = new URL('/admin', request.url).href;
      ctx.waitUntil(sendWelcomeEmail(env, value, adminUrl));
    }
    return json({ ok: true });
  }

  // --- Admin dashboard (Basic auth) ------------------------------------------
  if (method === 'GET' && pathname === '/admin') {
    const challenge = basicAuthChallenge(request, env);
    if (challenge) return challenge;
    const [logs, boxes, tipCounts, alertEmail, alertThreshold] = await Promise.all([
      env.afm_tips_db.prepare('SELECT * FROM usage_log ORDER BY timestamp DESC LIMIT 500').all(),
      env.afm_tips_db.prepare('SELECT * FROM boxes ORDER BY registered_at DESC').all(),
      env.afm_tips_db.prepare('SELECT box_id, COUNT(*) AS tips_used FROM usage_log GROUP BY box_id').all(),
      getSetting(env, 'alert_email'),
      getAlertThreshold(env),
    ]);
    const tipCountMap = {};
    for (const r of tipCounts.results) tipCountMap[r.box_id] = r.tips_used;
    return new Response(buildAdminPage(logs.results, boxes.results, tipCountMap, alertEmail ?? '', alertThreshold), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // --- Admin: CSV export (Basic auth) ----------------------------------------
  if (method === 'GET' && pathname === '/export/csv') {
    const challenge = basicAuthChallenge(request, env);
    if (challenge) return challenge;
    const type = url.searchParams.get('type') || 'logs';
    let csvText, filename;
    if (type === 'boxes') {
      const boxes = await env.afm_tips_db.prepare('SELECT * FROM boxes ORDER BY registered_at DESC').all();
      const cols = ['box_id', 'tip_model', 'lot', 'quantity', 'purchase_date', 'status', 'registered_by', 'registered_at', 'location'];
      csvText = cols.join(',') + '\n' + boxes.results.map(r => cols.map(c => csvCell(r[c])).join(',')).join('\n');
      filename = 'afm-boxes.csv';
    } else {
      const logs = await env.afm_tips_db.prepare('SELECT * FROM usage_log ORDER BY timestamp DESC').all();
      const cols = ['id', 'timestamp', 'box_id', 'tip_model', 'username', 'tip_number', 'note'];
      csvText = cols.join(',') + '\n' + logs.results.map(r => cols.map(c => csvCell(r[c])).join(',')).join('\n');
      filename = 'afm-logs.csv';
    }
    return new Response(csvText, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  }

  return new Response('Not found', { status: 404 });
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (e) {
      return json({ ok: false, error: 'server error' }, { status: 500 });
    }
  },
};
