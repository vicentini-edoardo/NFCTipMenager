function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? '"' + s.replace(/"/g, '""') + '"'
    : s;
}

function json(data, extra = {}) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function brevoSend(env, to, subject, html) {
  if (!env.BREVO_API_KEY) return;
  await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: { name: 'AFM Tips', email: 'your-verified-sender@example.com' },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });
}

async function sendLowTipsAlert(env, boxId, tipModel, location, remaining) {
  const setting = await env.afm_tips_db.prepare('SELECT value FROM settings WHERE key = ?').bind('alert_email').first();
  if (!setting?.value) return;
  const loc = location ? ` at <strong>${escHtml(location)}</strong>` : '';
  await brevoSend(env, setting.value,
    `Low tips alert: Box ${boxId} — ${remaining} tips left`,
    `<p>Box <strong>${escHtml(boxId)}</strong> (${escHtml(tipModel)}) has only <strong>${remaining}</strong> tips remaining${loc}.</p><p>Please reorder soon.</p>`
  );
}

async function sendWelcomeEmail(env, toEmail, adminUrl) {
  await brevoSend(env, toEmail,
    'You are now the AFM Tip Manager',
    `<p>Hello,</p>
    <p>You have been designated as the responsible person for AFM probe tip inventory management.</p>
    <p>You will receive an automatic alert when any tip box reaches <strong>5 remaining tips</strong>, so you can reorder before supplies run out.</p>
    <p>You can view the current status of all boxes and the full usage history in the admin dashboard:</p>
    <p><a href="${adminUrl}">${adminUrl}</a></p>
    <p style="color:#888;font-size:.85em;margin-top:2em">This message was sent automatically by the AFM Tip Tracker system.</p>`
  );
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname, method } = { pathname: url.pathname, method: request.method };

    if (method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (method === 'GET' && pathname.startsWith('/t/')) {
      const boxId = pathname.slice(3);
      if (!boxId) return new Response('Not found', { status: 404 });
      return new Response(buildTipPage(boxId), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    if (method === 'POST' && pathname === '/log') {
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid json' }, CORS); }
      const { boxId, user } = body;
      if (!boxId || !user) return json({ ok: false, error: 'missing fields' }, CORS);
      const box = await env.afm_tips_db.prepare('SELECT * FROM boxes WHERE box_id = ?').bind(boxId).first();
      if (!box) return json({ ok: false, error: 'unregistered' }, CORS);
      const now = new Date().toISOString();
      const countRow = await env.afm_tips_db.prepare(
        'SELECT COALESCE(MAX(tip_number), 0) + 1 AS next_tip FROM usage_log WHERE box_id = ?'
      ).bind(boxId).first();
      const tipNumber = countRow.next_tip;
      const inserted = await env.afm_tips_db.prepare(
        'INSERT INTO usage_log (timestamp, box_id, tip_model, username, tip_number) VALUES (?, ?, ?, ?, ?) RETURNING id'
      ).bind(now, boxId, box.tip_model, user, tipNumber).first();
      if (box.quantity != null && box.quantity - tipNumber === 5) {
        ctx.waitUntil(sendLowTipsAlert(env, boxId, box.tip_model, box.location, 5));
      }
      return json({ ok: true, user, time: now, tipModel: box.tip_model, boxId, tipNumber, totalQuantity: box.quantity, logId: inserted?.id ?? null }, CORS);
    }

    if (method === 'POST' && pathname === '/log/set-tip') {
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid json' }, CORS); }
      const { id, tipNumber } = body;
      if (!id || tipNumber == null || tipNumber < 1) return json({ ok: false, error: 'missing fields' }, CORS);
      await env.afm_tips_db.prepare('UPDATE usage_log SET tip_number = ? WHERE id = ?').bind(tipNumber, id).run();
      return json({ ok: true }, CORS);
    }

    if (method === 'POST' && pathname === '/log/correct') {
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid json' }, CORS); }
      const { id, tipNumber, adminKey } = body;
      if (adminKey !== env.ADMIN_KEY) return json({ ok: false, error: 'invalid admin key' }, CORS);
      if (!id || tipNumber == null) return json({ ok: false, error: 'missing fields' }, CORS);
      await env.afm_tips_db.prepare('UPDATE usage_log SET tip_number = ? WHERE id = ?').bind(tipNumber, id).run();
      return json({ ok: true }, CORS);
    }

    if (method === 'POST' && pathname === '/log/add') {
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid json' }, CORS); }
      const { boxId, username, tipNumber, timestamp, adminKey } = body;
      if (adminKey !== env.ADMIN_KEY) return json({ ok: false, error: 'invalid admin key' }, CORS);
      if (!boxId || !username) return json({ ok: false, error: 'missing fields' }, CORS);
      const box = await env.afm_tips_db.prepare('SELECT * FROM boxes WHERE box_id = ?').bind(boxId).first();
      if (!box) return json({ ok: false, error: 'box not registered' }, CORS);
      const ts = timestamp || new Date().toISOString();
      await env.afm_tips_db.prepare(
        'INSERT INTO usage_log (timestamp, box_id, tip_model, username, tip_number) VALUES (?, ?, ?, ?, ?)'
      ).bind(ts, boxId, box.tip_model, username, tipNumber || null).run();
      return json({ ok: true }, CORS);
    }

    if (method === 'POST' && pathname === '/register') {
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid json' }, CORS); }
      const { boxId, tipModel, lot, quantity, purchaseDate, registeredBy, adminKey, location } = body;
      if (adminKey !== env.ADMIN_KEY) return json({ ok: false, error: 'invalid admin key' }, CORS);
      if (!boxId || !tipModel) return json({ ok: false, error: 'missing fields' }, CORS);
      const now = new Date().toISOString();
      try {
        await env.afm_tips_db.prepare(
          'INSERT INTO boxes (box_id, tip_model, lot, quantity, purchase_date, status, registered_by, registered_at, location) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(boxId, tipModel, lot || null, quantity || null, purchaseDate || null, 'active', registeredBy || null, now, location || null).run();
        return json({ ok: true }, CORS);
      } catch (e) {
        return json({ ok: false, error: e.message }, CORS);
      }
    }

    if (method === 'GET' && pathname === '/admin') {
      const authHeader = request.headers.get('Authorization') ?? '';
      if (!authHeader.startsWith('Basic ')) {
        return new Response('Unauthorized', {
          status: 401,
          headers: { 'WWW-Authenticate': 'Basic realm="AFM Admin"' },
        });
      }
      const decoded = atob(authHeader.slice(6));
      const pass = decoded.includes(':') ? decoded.slice(decoded.indexOf(':') + 1) : decoded;
      if (pass !== env.ADMIN_KEY) {
        return new Response('Unauthorized', {
          status: 401,
          headers: { 'WWW-Authenticate': 'Basic realm="AFM Admin"' },
        });
      }
      const [logs, boxes, tipCounts, alertEmailRow] = await Promise.all([
        env.afm_tips_db.prepare('SELECT * FROM usage_log ORDER BY timestamp DESC LIMIT 500').all(),
        env.afm_tips_db.prepare('SELECT * FROM boxes ORDER BY registered_at DESC').all(),
        env.afm_tips_db.prepare('SELECT box_id, COALESCE(MAX(tip_number), 0) AS tips_used FROM usage_log GROUP BY box_id').all(),
        env.afm_tips_db.prepare('SELECT value FROM settings WHERE key = ?').bind('alert_email').first(),
      ]);
      const tipCountMap = {};
      for (const r of tipCounts.results) tipCountMap[r.box_id] = r.tips_used;
      return new Response(buildAdminPage(logs.results, boxes.results, tipCountMap, alertEmailRow?.value ?? ''), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    if (method === 'POST' && pathname === '/box/update') {
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid json' }, CORS); }
      const { boxId, tipModel, lot, quantity, purchaseDate, status, registeredBy, location, adminKey } = body;
      if (adminKey !== env.ADMIN_KEY) return json({ ok: false, error: 'invalid admin key' }, CORS);
      if (!boxId) return json({ ok: false, error: 'missing boxId' }, CORS);
      await env.afm_tips_db.prepare(
        'UPDATE boxes SET tip_model=?, lot=?, quantity=?, purchase_date=?, status=?, registered_by=?, location=? WHERE box_id=?'
      ).bind(tipModel || null, lot || null, quantity != null && quantity !== '' ? Number(quantity) : null, purchaseDate || null, status || null, registeredBy || null, location || null, boxId).run();
      return json({ ok: true }, CORS);
    }

    if (method === 'POST' && pathname === '/box/reset-tips') {
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid json' }, CORS); }
      const { boxId, adminKey } = body;
      if (adminKey !== env.ADMIN_KEY) return json({ ok: false, error: 'invalid admin key' }, CORS);
      if (!boxId) return json({ ok: false, error: 'missing boxId' }, CORS);
      await env.afm_tips_db.prepare('DELETE FROM usage_log WHERE box_id = ?').bind(boxId).run();
      return json({ ok: true }, CORS);
    }

    if (method === 'POST' && pathname === '/settings/test-email') {
      const authHeader = request.headers.get('Authorization') ?? '';
      if (!authHeader.startsWith('Basic ')) return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="AFM Admin"' } });
      const decoded = atob(authHeader.slice(6));
      const pass = decoded.includes(':') ? decoded.slice(decoded.indexOf(':') + 1) : decoded;
      if (pass !== env.ADMIN_KEY) return new Response('Unauthorized', { status: 401 });
      const setting = await env.afm_tips_db.prepare('SELECT value FROM settings WHERE key = ?').bind('alert_email').first();
      const toEmail = setting?.value;
      if (!toEmail) return json({ ok: false, error: 'No alert_email configured in settings' }, CORS);
      if (!env.BREVO_API_KEY) return json({ ok: false, error: 'BREVO_API_KEY secret not set' }, CORS);
      const adminUrl = new URL('/admin', request.url).href;
      const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: { name: 'AFM Tips', email: 'your-verified-sender@example.com' },
          to: [{ email: toEmail }],
          subject: '[TEST] AFM Tip Tracker alert',
          htmlContent: `<p>Test email from AFM Tip Tracker. Admin: <a href="${adminUrl}">${adminUrl}</a></p>`,
        }),
      });
      const brevoBody = await brevoRes.json();
      return json({ ok: brevoRes.ok, status: brevoRes.status, brevo: brevoBody }, CORS);
    }

    if (method === 'POST' && pathname === '/settings') {
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, error: 'invalid json' }, CORS); }
      const { key, value, adminKey } = body;
      if (adminKey !== env.ADMIN_KEY) return json({ ok: false, error: 'invalid admin key' }, CORS);
      if (!key) return json({ ok: false, error: 'missing key' }, CORS);
      await env.afm_tips_db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, value || null).run();
      if (key === 'alert_email' && value) {
        const adminUrl = new URL('/admin', request.url).href;
        ctx.waitUntil(sendWelcomeEmail(env, value, adminUrl));
      }
      return json({ ok: true }, CORS);
    }

    if (method === 'GET' && pathname === '/export/csv') {
      const authHeader = request.headers.get('Authorization') ?? '';
      if (!authHeader.startsWith('Basic ')) {
        return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="AFM Admin"' } });
      }
      const decoded = atob(authHeader.slice(6));
      const pass = decoded.includes(':') ? decoded.slice(decoded.indexOf(':') + 1) : decoded;
      if (pass !== env.ADMIN_KEY) {
        return new Response('Unauthorized', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="AFM Admin"' } });
      }
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
  },
};

function buildTipPage(boxId) {
  const safeBoxId = escHtml(boxId);
  const jsonBoxId = JSON.stringify(boxId);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#1a1a2e">
<title>AFM Tip Tracker</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#1a1a2e;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem}
.card{background:#fff;border-radius:16px;padding:2rem;max-width:380px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,.35)}
.hdr{font-size:1rem;color:#777;font-weight:500;margin-bottom:.25rem}
.boxid{font-size:.8rem;color:#aaa;font-family:monospace;margin-bottom:1.5rem}
.icon{font-size:3.5rem;text-align:center;margin:.75rem 0}
.title{font-size:1.4rem;font-weight:700;text-align:center;color:#1a1a2e;margin-bottom:.5rem}
.sub{font-size:.9rem;color:#555;text-align:center;margin-bottom:.2rem}
.tipnum{font-size:1.1rem;font-weight:700;text-align:center;color:#6c63ff;margin:.4rem 0 .2rem;cursor:pointer}
.tipnum:hover{text-decoration:underline}
.tipnum-edit{display:flex;align-items:center;justify-content:center;gap:.4rem;margin:.4rem 0 .2rem}
.tipnum-edit input{width:4.5rem;padding:.3rem .4rem;border:2px solid #6c63ff;border-radius:6px;font-size:1rem;font-weight:700;color:#6c63ff;text-align:center;outline:none}
.tipnum-edit button{padding:.3rem .6rem;background:#6c63ff;color:#fff;border:none;border-radius:6px;font-size:.85rem;font-weight:600;cursor:pointer}
.tipnum-edit .cx{background:none;color:#aaa;border:1px solid #ddd}
.meta{font-size:.78rem;color:#aaa;text-align:center;margin-top:.4rem}
.err{color:#c0392b;font-size:.875rem;margin-top:.6rem;display:none}
.err.show{display:block}
label{display:block;font-size:.83rem;color:#666;margin:.9rem 0 .2rem}
input{width:100%;padding:.6rem .75rem;border:1.5px solid #ddd;border-radius:8px;font-size:1rem;outline:none;transition:border-color .15s}
input:focus{border-color:#6c63ff}
button{width:100%;margin-top:1.1rem;padding:.75rem;background:#6c63ff;color:#fff;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer;transition:background .15s}
button:hover{background:#574fd6}
button:disabled{background:#bbb;cursor:default}
.ghost{background:none;color:#6c63ff;font-weight:400;font-size:.83rem;margin-top:.75rem;padding:0;text-decoration:underline}
.ghost:hover{background:none;color:#574fd6}
.spin-wrap{text-align:center;padding:1.5rem 0}
.spin{display:inline-block;width:1.4rem;height:1.4rem;border:2.5px solid #eee;border-top-color:#6c63ff;border-radius:50%;animation:spin .7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
hr{border:none;border-top:1px solid #eee;margin:1.2rem 0}
</style>
</head>
<body>
<div class="card">
  <div class="hdr">AFM Tip Tracker</div>
  <div class="boxid">Box: ${safeBoxId}</div>
  <div id="content"><div class="spin-wrap"><div class="spin"></div></div></div>
</div>
<script>
const BOX_ID = ${jsonBoxId};
const SK = 'afm_username';

function el(id) { return document.getElementById(id); }
function show(html) { el('content').innerHTML = html; }
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function setErr(msg) {
  const e = el('err');
  if (!e) return;
  e.textContent = msg;
  e.className = 'err' + (msg ? ' show' : '');
}

async function logUsage(user) {
  show('<div class="spin-wrap"><div class="spin"></div></div>');
  try {
    const res = await fetch('/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boxId: BOX_ID, user }),
    });
    const d = await res.json();
    if (d.ok) {
      const t = new Date(d.time).toLocaleString();
      window._logId = d.logId;
      window._tipTotal = d.totalQuantity;
      sessionStorage.setItem('afm_tap_' + BOX_ID, JSON.stringify({ logId: d.logId, tipNumber: d.tipNumber, user: d.user, tipModel: d.tipModel, boxId: d.boxId, time: d.time, totalQuantity: d.totalQuantity }));
      showConfirm(d.tipNumber, d.user, d.tipModel, d.boxId, t);
    } else if (d.error === 'unregistered') {
      showRegister();
    } else {
      show('<p class="err show">Error: ' + esc(d.error || 'Unknown error') + '</p>');
    }
  } catch (e) {
    show('<p class="err show">Network error. Check connection and try again.</p>');
  }
}

function showNameForm() {
  show(
    '<div class="title" style="text-align:left;font-size:1.1rem;margin-bottom:.3rem">Who are you?</div>' +
    '<p class="sub" style="text-align:left;margin-bottom:.75rem;font-size:.85rem">Name is saved on this device for future taps.</p>' +
    '<label for="uname">Your name</label>' +
    '<input id="uname" type="text" autocomplete="name" placeholder="e.g. Alice" autofocus>' +
    '<div id="err" class="err"></div>' +
    '<button id="nbtn" onclick="submitName()">Log tap →</button>'
  );
  el('uname').focus();
  el('uname').addEventListener('keydown', function(e) { if (e.key === 'Enter') submitName(); });
}

function submitName() {
  const inp = el('uname');
  const user = inp ? inp.value.trim() : '';
  if (!user) { setErr('Enter your name.'); return; }
  localStorage.setItem(SK, user);
  logUsage(user);
}

function changeName() {
  sessionStorage.removeItem('afm_tap_' + BOX_ID);
  localStorage.removeItem(SK);
  showNameForm();
}

function showConfirm(tipNum, user, tipModel, boxId, t) {
  const tipLabel = window._tipTotal
    ? 'Tip #' + tipNum + ' of ' + window._tipTotal
    : 'Tip #' + tipNum;
  show(
    '<div class="icon">✓</div>' +
    '<div class="title">Tip taken</div>' +
    '<div class="tipnum" id="tipnum-display" title="Tap to change tip number" onclick="editTipNum(' + tipNum + ')">' + esc(tipLabel) + '</div>' +
    '<div class="sub"><strong>' + esc(user) + '</strong></div>' +
    '<div class="sub">Model: ' + esc(tipModel) + '</div>' +
    '<div class="sub">Box: ' + esc(boxId) + '</div>' +
    '<div class="meta">' + esc(t) + '</div>' +
    '<div id="tipnum-err" class="err"></div>' +
    '<hr>' +
    '<button class="ghost" onclick="changeName()">Not you? Change name</button>'
  );
}

function editTipNum(current) {
  const total = window._tipTotal ? ' of ' + window._tipTotal : '';
  const display = document.getElementById('tipnum-display');
  if (!display) return;
  display.outerHTML =
    '<div class="tipnum-edit" id="tipnum-edit">' +
    '<input type="number" id="tipnum-inp" min="1" value="' + current + '">' +
    '<button onclick="saveTipNum()">Save</button>' +
    '<button class="cx" onclick="cancelTipNum(' + current + ')">✕</button>' +
    '</div>';
  const inp = document.getElementById('tipnum-inp');
  if (inp) { inp.focus(); inp.select(); }
  inp.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') saveTipNum();
    if (e.key === 'Escape') cancelTipNum(current);
  });
}

async function saveTipNum() {
  const inp = document.getElementById('tipnum-inp');
  const tipNumber = inp ? parseInt(inp.value, 10) : null;
  const errEl = document.getElementById('tipnum-err');
  if (!tipNumber || tipNumber < 1) {
    if (inp) inp.style.borderColor = '#c0392b';
    return;
  }
  if (!window._logId) {
    if (errEl) { errEl.textContent = 'Cannot correct: log ID missing.'; errEl.className = 'err show'; }
    return;
  }
  try {
    const res = await fetch('/log/set-tip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: window._logId, tipNumber }),
    });
    const d = await res.json();
    if (d.ok) {
      const total = window._tipTotal ? ' of ' + window._tipTotal : '';
      const edit = document.getElementById('tipnum-edit');
      if (edit) edit.outerHTML =
        '<div class="tipnum" id="tipnum-display" title="Tap to change tip number" onclick="editTipNum(' + tipNumber + ')">Tip #' + tipNumber + total + '</div>';
    } else {
      if (errEl) { errEl.textContent = d.error || 'Failed.'; errEl.className = 'err show'; }
    }
  } catch(e) {
    if (errEl) { errEl.textContent = 'Network error.'; errEl.className = 'err show'; }
  }
}

function cancelTipNum(current) {
  const total = window._tipTotal ? ' of ' + window._tipTotal : '';
  const edit = document.getElementById('tipnum-edit');
  if (edit) edit.outerHTML =
    '<div class="tipnum" id="tipnum-display" title="Tap to change tip number" onclick="editTipNum(' + current + ')">Tip #' + current + total + '</div>';
}

function showRegister() {
  show(
    '<div class="icon" style="font-size:2.2rem">⚠️</div>' +
    '<div class="title" style="font-size:1.1rem">Box not registered</div>' +
    '<p class="sub" style="margin-bottom:.5rem;font-size:.83rem">Admin: fill in the form below to register this box.</p>' +
    '<label for="tm">Tip model <span style="color:#c0392b">*</span></label>' +
    '<input id="tm" type="text" placeholder="e.g. OTESPA-R3">' +
    '<label for="lt">Lot number</label>' +
    '<input id="lt" type="text" placeholder="optional">' +
    '<label for="qy">Quantity</label>' +
    '<input id="qy" type="number" placeholder="e.g. 10" min="1">' +
    '<label for="pd">Purchase date</label>' +
    '<input id="pd" type="date">' +
    '<label for="loc">Location</label>' +
    '<input id="loc" type="text" placeholder="e.g. Lab A, Shelf 2">' +
    '<label for="rb">Registered by</label>' +
    '<input id="rb" type="text" placeholder="Your name">' +
    '<label for="ak">Admin key <span style="color:#c0392b">*</span></label>' +
    '<input id="ak" type="password" placeholder="Admin key">' +
    '<div id="err" class="err"></div>' +
    '<button onclick="submitRegister()">Register box</button>'
  );
}

async function submitRegister() {
  const tipModel = (el('tm').value || '').trim();
  const lot = (el('lt').value || '').trim();
  const qty = (el('qy').value || '').trim();
  const purchaseDate = el('pd').value || '';
  const location = (el('loc').value || '').trim();
  const registeredBy = (el('rb').value || '').trim();
  const adminKey = el('ak').value || '';
  if (!tipModel) { setErr('Tip model is required.'); return; }
  if (!adminKey) { setErr('Admin key is required.'); return; }
  setErr('');
  try {
    const res = await fetch('/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        boxId: BOX_ID, tipModel, lot,
        quantity: qty ? parseInt(qty, 10) : null,
        purchaseDate, location, registeredBy, adminKey,
      }),
    });
    const d = await res.json();
    if (d.ok) {
      const user = localStorage.getItem(SK);
      if (user) logUsage(user); else showNameForm();
    } else {
      setErr(d.error || 'Registration failed.');
    }
  } catch (e) {
    setErr('Network error.');
  }
}

(function init() {
  const cached = sessionStorage.getItem('afm_tap_' + BOX_ID);
  if (cached) {
    try {
      const d = JSON.parse(cached);
      window._logId = d.logId;
      window._tipTotal = d.totalQuantity;
      showConfirm(d.tipNumber, d.user, d.tipModel, d.boxId, new Date(d.time).toLocaleString());
      return;
    } catch(e) { sessionStorage.removeItem('afm_tap_' + BOX_ID); }
  }
  const user = localStorage.getItem(SK);
  if (user) logUsage(user); else showNameForm();
})();
</script>
</body>
</html>`;
}

function buildAdminPage(logs, boxes, tipCountMap = {}, alertEmail = '') {
  const logRows = (logs && logs.length)
    ? logs.map(r => `<tr>
        <td>${escHtml(r.id ?? '')}</td>
        <td>${escHtml(r.timestamp ?? '')}</td>
        <td>${escHtml(r.box_id ?? '')}</td>
        <td>${escHtml(r.tip_model ?? '')}</td>
        <td>${escHtml(r.username ?? '')}</td>
        <td class="tipnum-cell" data-id="${escHtml(r.id ?? '')}">
          <span class="tipnum-val">${escHtml(r.tip_number ?? '—')}</span>
          <button class="edit-btn" onclick="editTip(this, ${escHtml(r.id ?? '')}, ${escHtml(r.tip_number ?? 0)})">edit</button>
        </td>
        <td>${escHtml(r.note ?? '')}</td>
      </tr>`).join('')
    : `<tr><td colspan="7" style="color:#aaa;padding:.75rem;text-align:center">No data</td></tr>`;

  const boxCols = ['box_id', 'tip_model', 'lot', 'quantity', 'purchase_date', 'status', 'registered_by', 'registered_at', 'location'];
  const boxRows = (boxes && boxes.length)
    ? boxes.map(r => {
        const data = JSON.stringify(r).replace(/'/g, '&#39;');
        return '<tr>' +
          boxCols.map(c => `<td>${escHtml(r[c] ?? '')}</td>`).join('') +
          `<td><button class="edit-btn" onclick='openEditBox(${data})'>edit</button></td>` +
          '</tr>';
      }).join('')
    : `<tr><td colspan="${boxCols.length + 1}" style="color:#aaa;padding:.75rem;text-align:center">No data</td></tr>`;

  const summaryRows = (boxes && boxes.length)
    ? boxes.map(b => {
        const used = tipCountMap[b.box_id] ?? 0;
        const qty = b.quantity ?? null;
        const left = qty != null ? qty - used : '—';
        const leftNum = qty != null ? qty - used : null;
        const pct = (qty && qty > 0) ? Math.max(0, Math.round((used / qty) * 100)) : null;
        const barColor = leftNum != null && leftNum <= 0 ? '#c0392b' : leftNum != null && leftNum <= 2 ? '#e67e22' : '#27ae60';
        const bar = pct != null
          ? `<div style="background:#eee;border-radius:4px;height:6px;width:80px;display:inline-block;vertical-align:middle;margin-left:.4rem"><div style="background:${barColor};height:6px;border-radius:4px;width:${Math.min(100,pct)}%"></div></div>`
          : '';
        const data = JSON.stringify(b).replace(/'/g, '&#39;');
        return `<tr>
          <td><strong>${escHtml(b.box_id)}</strong></td>
          <td>${escHtml(b.tip_model)}</td>
          <td>${escHtml(b.location ?? '—')}</td>
          <td>${escHtml(qty ?? '—')}</td>
          <td>${used}</td>
          <td style="color:${leftNum != null && leftNum <= 0 ? '#c0392b' : leftNum != null && leftNum <= 2 ? '#e67e22' : '#222'};font-weight:${leftNum != null && leftNum <= 2 ? '700' : '400'}">${escHtml(left)}${bar}</td>
          <td><span style="display:inline-block;padding:.1rem .4rem;border-radius:4px;font-size:.75rem;background:${b.status==='active'?'#d4edda':'#f8d7da'};color:${b.status==='active'?'#155724':'#721c24'}">${escHtml(b.status)}</span></td>
          <td style="white-space:nowrap">
            <button class="edit-btn" onclick='openEditBox(${data})'>edit</button>
            <button class="del-btn" onclick="resetBoxTips('${escHtml(b.box_id)}')">reset tips</button>
          </td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="8" style="color:#aaa;padding:.75rem;text-align:center">No boxes registered</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AFM Admin</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f6f9;color:#222;padding:1rem}
h1{font-size:1.3rem;margin-bottom:1.5rem;color:#1a1a2e}
h2{font-size:1rem;margin:1.5rem 0 .5rem;color:#555;text-transform:uppercase;letter-spacing:.04em;font-weight:600}
.badge{background:#6c63ff;color:#fff;border-radius:10px;padding:.1rem .45rem;font-size:.75rem;margin-left:.4rem;vertical-align:middle}
.wrap{overflow-x:auto;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,.08);margin-bottom:1.5rem}
table{width:100%;border-collapse:collapse;font-size:.83rem;min-width:600px}
th{background:#1a1a2e;color:#fff;padding:.6rem .75rem;text-align:left;white-space:nowrap}
td{padding:.5rem .75rem;border-bottom:1px solid #eee;vertical-align:middle;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
tr:last-child td{border-bottom:none}
tr:nth-child(even) td{background:#fafafa}
.edit-btn{background:none;border:1px solid #6c63ff;color:#6c63ff;border-radius:4px;padding:.1rem .4rem;font-size:.75rem;cursor:pointer;margin-left:.2rem}
.edit-btn:hover{background:#6c63ff;color:#fff}
.del-btn{background:none;border:1px solid #c0392b;color:#c0392b;border-radius:4px;padding:.1rem .4rem;font-size:.75rem;cursor:pointer;margin-left:.2rem}
.del-btn:hover{background:#c0392b;color:#fff}
.csv-btn{display:inline-block;padding:.3rem .75rem;background:#fff;border:1.5px solid #6c63ff;color:#6c63ff;border-radius:6px;font-size:.8rem;font-weight:600;cursor:pointer;text-decoration:none;margin-bottom:.5rem}
.csv-btn:hover{background:#6c63ff;color:#fff}
.modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100;align-items:center;justify-content:center}
.modal.open{display:flex}
.modal-box{background:#fff;border-radius:12px;padding:1.5rem;max-width:520px;width:92%;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.2)}
.modal-box h3{font-size:1rem;font-weight:700;color:#1a1a2e;margin-bottom:1rem;text-transform:uppercase;letter-spacing:.04em}
.modal-btns{display:flex;gap:.5rem;margin-top:1rem;flex-wrap:wrap}
.inline-edit{display:flex;gap:.3rem;align-items:center}
.inline-edit input{width:4rem;padding:.2rem .4rem;border:1.5px solid #6c63ff;border-radius:4px;font-size:.85rem}
.save-btn{background:#6c63ff;color:#fff;border:none;border-radius:4px;padding:.2rem .5rem;font-size:.75rem;cursor:pointer}
.cancel-btn{background:none;border:1px solid #aaa;color:#666;border-radius:4px;padding:.2rem .5rem;font-size:.75rem;cursor:pointer}
.section{background:#fff;border-radius:10px;padding:1.25rem;box-shadow:0 2px 8px rgba(0,0,0,.08);margin-bottom:1.5rem}
.section h3{font-size:.9rem;font-weight:600;color:#1a1a2e;margin-bottom:.9rem;text-transform:uppercase;letter-spacing:.04em}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:.5rem .75rem}
@media(max-width:480px){.form-grid{grid-template-columns:1fr}}
.form-grid label{font-size:.8rem;color:#666;margin-bottom:.1rem;display:block}
.form-grid input,.form-grid select{width:100%;padding:.45rem .6rem;border:1.5px solid #ddd;border-radius:6px;font-size:.9rem}
.form-grid input:focus,.form-grid select:focus{outline:none;border-color:#6c63ff}
.form-btn{margin-top:.75rem;padding:.55rem 1.2rem;background:#6c63ff;color:#fff;border:none;border-radius:6px;font-size:.9rem;font-weight:600;cursor:pointer}
.form-btn:hover{background:#574fd6}
.form-btn.sec{background:#fff;border:1.5px solid #aaa;color:#555}
.form-btn.sec:hover{background:#f0f0f0}
.form-msg{font-size:.83rem;margin-top:.5rem;min-height:1.2em}
.form-msg.ok{color:#27ae60}
.form-msg.err{color:#c0392b}
</style>
</head>
<body>
<h1>AFM Tip Tracker — Admin</h1>

<div class="section">
  <h3>Settings</h3>
  <div class="form-grid" style="grid-template-columns:1fr">
    <div>
      <label>Alert email <span style="color:#888;font-size:.75rem;font-weight:400">— notified when a box hits 5 tips remaining</span></label>
      <div style="display:flex;gap:.5rem;align-items:center">
        <input id="s-email" type="email" placeholder="e.g. lab@example.com" value="${escHtml(alertEmail)}" style="flex:1">
        <button class="form-btn" style="margin:0;white-space:nowrap" onclick="saveAlertEmail()">Save</button>
      </div>
    </div>
  </div>
  <div id="s-msg" class="form-msg"></div>
</div>

<h2>Box summary <span class="badge">${boxes.length}</span></h2>
<div class="wrap">
<table>
<thead><tr>
  <th>Box ID</th><th>Tip model</th><th>Location</th><th>Qty</th><th>Used</th><th>Remaining</th><th>Status</th><th>Actions</th>
</tr></thead>
<tbody>${summaryRows}</tbody>
</table>
</div>

<h2>Usage log <span class="badge">${logs.length}</span></h2>
<a class="csv-btn" href="/export/csv?type=logs" download>↓ Download CSV</a>
<div class="wrap">
<table>
<thead><tr>
  <th>id</th><th>timestamp</th><th>box_id</th><th>tip_model</th><th>username</th><th>tip #</th><th>note</th>
</tr></thead>
<tbody>${logRows}</tbody>
</table>
</div>

<div class="section">
  <h3>Add missed entry</h3>
  <div class="form-grid">
    <div><label>Box ID *</label><input id="a-box" type="text" placeholder="e.g. box-001"></div>
    <div><label>Username *</label><input id="a-user" type="text" placeholder="e.g. Alice"></div>
    <div><label>Tip # (optional)</label><input id="a-tipnum" type="number" min="1" placeholder="auto if blank"></div>
    <div><label>Timestamp (optional)</label><input id="a-ts" type="datetime-local"></div>
    <div><label>Admin key *</label><input id="a-key" type="password" placeholder="Admin key"></div>
  </div>
  <button class="form-btn" onclick="addEntry()">Add entry</button>
  <div id="add-msg" class="form-msg"></div>
</div>

<h2>Registered boxes <span class="badge">${boxes.length}</span></h2>
<a class="csv-btn" href="/export/csv?type=boxes" download>↓ Download CSV</a>
<div class="wrap">
<table>
<thead><tr>${boxCols.map(c => `<th>${escHtml(c)}</th>`).join('')}<th>Actions</th></tr></thead>
<tbody>${boxRows}</tbody>
</table>
</div>

<!-- Edit box modal -->
<div class="modal" id="box-modal">
  <div class="modal-box">
    <h3>Edit Box</h3>
    <div class="form-grid">
      <div><label>Box ID</label><input id="eb-boxid" type="text" disabled style="background:#f4f6f9;color:#888"></div>
      <div><label>Tip model *</label><input id="eb-tipmodel" type="text" placeholder="e.g. OTESPA-R3"></div>
      <div><label>Lot</label><input id="eb-lot" type="text" placeholder="optional"></div>
      <div><label>Quantity</label><input id="eb-qty" type="number" min="1" placeholder="optional"></div>
      <div><label>Purchase date</label><input id="eb-date" type="date"></div>
      <div><label>Status</label>
        <select id="eb-status"><option value="active">active</option><option value="inactive">inactive</option></select>
      </div>
      <div><label>Registered by</label><input id="eb-regby" type="text" placeholder="optional"></div>
      <div><label>Location</label><input id="eb-loc" type="text" placeholder="optional"></div>
    </div>
    <div id="eb-msg" class="form-msg"></div>
    <div class="modal-btns">
      <button class="form-btn" onclick="saveBox()">Save changes</button>
      <button class="form-btn sec" onclick="closeBoxModal()">Cancel</button>
    </div>
  </div>
</div>

<script>
let _adminKey = sessionStorage.getItem('afm_admin_key') || '';

async function saveAlertEmail() {
  const email = (document.getElementById('s-email').value || '').trim();
  const msg = document.getElementById('s-msg');
  const key = getKey();
  if (!key) return;
  msg.className = 'form-msg'; msg.textContent = 'Saving…';
  try {
    const res = await fetch('/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'alert_email', value: email, adminKey: key }),
    });
    const d = await res.json();
    if (d.ok) { msg.className = 'form-msg ok'; msg.textContent = 'Saved.'; }
    else {
      if (d.error === 'invalid admin key') { _adminKey = ''; sessionStorage.removeItem('afm_admin_key'); }
      msg.className = 'form-msg err'; msg.textContent = d.error || 'Failed.';
    }
  } catch(e) { msg.className = 'form-msg err'; msg.textContent = 'Network error.'; }
}

function getKey() {
  if (!_adminKey) {
    _adminKey = prompt('Admin key:') || '';
    if (_adminKey) sessionStorage.setItem('afm_admin_key', _adminKey);
  }
  return _adminKey;
}

function editTip(btn, id, current) {
  const cell = btn.parentElement;
  cell.innerHTML =
    '<div class="inline-edit">' +
    '<input type="number" min="1" value="' + (current || '') + '" id="ei-' + id + '">' +
    '<button class="save-btn" onclick="saveTip(' + id + ')">Save</button>' +
    '<button class="cancel-btn" onclick="cancelEdit(' + id + ',' + (current||0) + ')">✕</button>' +
    '</div>';
  const inp = document.getElementById('ei-' + id);
  if (inp) { inp.focus(); inp.select(); }
  inp.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') saveTip(id);
    if (e.key === 'Escape') cancelEdit(id, current);
  });
}

async function saveTip(id) {
  const inp = document.getElementById('ei-' + id);
  const tipNumber = inp ? parseInt(inp.value, 10) : null;
  if (!tipNumber || tipNumber < 1) { inp && (inp.style.borderColor = '#c0392b'); return; }
  const key = getKey();
  if (!key) return;
  try {
    const res = await fetch('/log/correct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, tipNumber, adminKey: key }),
    });
    const d = await res.json();
    if (d.ok) {
      const cell = document.getElementById('ei-' + id).closest('td');
      cell.innerHTML = '<span class="tipnum-val">' + tipNumber + '</span>' +
        '<button class="edit-btn" onclick="editTip(this,' + id + ',' + tipNumber + ')">edit</button>';
    } else {
      if (d.error === 'invalid admin key') { _adminKey = ''; sessionStorage.removeItem('afm_admin_key'); }
      alert(d.error || 'Failed');
    }
  } catch(e) { alert('Network error'); }
}

function cancelEdit(id, current) {
  const cell = document.getElementById('ei-' + id).closest('td');
  cell.innerHTML = '<span class="tipnum-val">' + (current || '—') + '</span>' +
    '<button class="edit-btn" onclick="editTip(this,' + id + ',' + (current||0) + ')">edit</button>';
}

function openEditBox(box) {
  document.getElementById('eb-boxid').value = box.box_id || '';
  document.getElementById('eb-tipmodel').value = box.tip_model || '';
  document.getElementById('eb-lot').value = box.lot || '';
  document.getElementById('eb-qty').value = box.quantity != null ? box.quantity : '';
  document.getElementById('eb-date').value = box.purchase_date ? box.purchase_date.slice(0, 10) : '';
  document.getElementById('eb-status').value = box.status || 'active';
  document.getElementById('eb-regby').value = box.registered_by || '';
  document.getElementById('eb-loc').value = box.location || '';
  document.getElementById('eb-msg').textContent = '';
  document.getElementById('eb-msg').className = 'form-msg';
  document.getElementById('box-modal').className = 'modal open';
}

function closeBoxModal() {
  document.getElementById('box-modal').className = 'modal';
}

document.getElementById('box-modal').addEventListener('click', function(e) {
  if (e.target === this) closeBoxModal();
});

async function saveBox() {
  const boxId = document.getElementById('eb-boxid').value;
  const tipModel = document.getElementById('eb-tipmodel').value.trim();
  const msg = document.getElementById('eb-msg');
  if (!tipModel) { msg.className = 'form-msg err'; msg.textContent = 'Tip model required.'; return; }
  const key = getKey();
  if (!key) return;
  msg.className = 'form-msg'; msg.textContent = 'Saving…';
  try {
    const res = await fetch('/box/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        boxId, tipModel,
        lot: document.getElementById('eb-lot').value.trim() || null,
        quantity: document.getElementById('eb-qty').value !== '' ? parseInt(document.getElementById('eb-qty').value, 10) : null,
        purchaseDate: document.getElementById('eb-date').value || null,
        status: document.getElementById('eb-status').value,
        registeredBy: document.getElementById('eb-regby').value.trim() || null,
        location: document.getElementById('eb-loc').value.trim() || null,
        adminKey: key,
      }),
    });
    const d = await res.json();
    if (d.ok) {
      msg.className = 'form-msg ok'; msg.textContent = 'Saved. Reloading…';
      setTimeout(() => location.reload(), 800);
    } else {
      if (d.error === 'invalid admin key') { _adminKey = ''; sessionStorage.removeItem('afm_admin_key'); }
      msg.className = 'form-msg err'; msg.textContent = d.error || 'Failed.';
    }
  } catch(e) { msg.className = 'form-msg err'; msg.textContent = 'Network error.'; }
}

async function resetBoxTips(boxId) {
  if (!confirm('Delete ALL usage log entries for box "' + boxId + '"? This cannot be undone.')) return;
  const key = getKey();
  if (!key) return;
  try {
    const res = await fetch('/box/reset-tips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boxId, adminKey: key }),
    });
    const d = await res.json();
    if (d.ok) { alert('Tips reset. Reloading…'); location.reload(); }
    else {
      if (d.error === 'invalid admin key') { _adminKey = ''; sessionStorage.removeItem('afm_admin_key'); }
      alert(d.error || 'Failed');
    }
  } catch(e) { alert('Network error'); }
}

async function addEntry() {
  const boxId = (document.getElementById('a-box').value || '').trim();
  const username = (document.getElementById('a-user').value || '').trim();
  const tipNum = document.getElementById('a-tipnum').value;
  const tsRaw = document.getElementById('a-ts').value;
  const adminKey = document.getElementById('a-key').value || getKey();
  const msg = document.getElementById('add-msg');

  if (!boxId || !username) { msg.className = 'form-msg err'; msg.textContent = 'Box ID and username required.'; return; }
  if (!adminKey) return;

  let timestamp = null;
  if (tsRaw) {
    timestamp = new Date(tsRaw).toISOString();
  }

  msg.className = 'form-msg'; msg.textContent = 'Saving…';
  try {
    const res = await fetch('/log/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        boxId, username,
        tipNumber: tipNum ? parseInt(tipNum, 10) : null,
        timestamp,
        adminKey,
      }),
    });
    const d = await res.json();
    if (d.ok) {
      msg.className = 'form-msg ok';
      msg.textContent = 'Entry added. Reload to see it in the table.';
      document.getElementById('a-box').value = '';
      document.getElementById('a-user').value = '';
      document.getElementById('a-tipnum').value = '';
      document.getElementById('a-ts').value = '';
    } else {
      msg.className = 'form-msg err';
      msg.textContent = d.error || 'Failed.';
    }
  } catch(e) {
    msg.className = 'form-msg err';
    msg.textContent = 'Network error.';
  }
}
</script>
</body>
</html>`;
}
