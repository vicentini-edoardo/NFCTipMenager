import { escHtml } from '../lib/http.js';

export function buildTipPage(boxId) {
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
      window._editToken = d.editToken;
      window._tipTotal = d.totalQuantity;
      sessionStorage.setItem('afm_tap_' + BOX_ID, JSON.stringify({ logId: d.logId, editToken: d.editToken, tipNumber: d.tipNumber, user: d.user, tipModel: d.tipModel, boxId: d.boxId, time: d.time, totalQuantity: d.totalQuantity }));
      showConfirm(d.tipNumber, d.user, d.tipModel, d.boxId, t);
    } else if (d.error === 'unregistered') {
      showRegister();
    } else if (res.status === 429) {
      show('<p class="err show">Too many taps. Please wait a moment and try again.</p>');
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
  if (!window._logId || !window._editToken) {
    if (errEl) { errEl.textContent = 'This tap can no longer be edited.'; errEl.className = 'err show'; }
    return;
  }
  try {
    const res = await fetch('/log/set-tip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: window._logId, tipNumber, editToken: window._editToken }),
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
      window._editToken = d.editToken;
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
