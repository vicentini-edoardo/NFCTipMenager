import { escHtml } from '../lib/http.js';

export function buildAdminPage(logs, boxes, tipCountMap = {}, alertEmail = '', alertThreshold = 5) {
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
        const data = escHtml(JSON.stringify(r));
        return '<tr>' +
          boxCols.map(c => `<td>${escHtml(r[c] ?? '')}</td>`).join('') +
          `<td><button class="edit-btn" data-box="${data}" onclick="openEditBox(JSON.parse(this.dataset.box))">edit</button></td>` +
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
        const data = escHtml(JSON.stringify(b));
        return `<tr>
          <td><strong>${escHtml(b.box_id)}</strong></td>
          <td>${escHtml(b.tip_model)}</td>
          <td>${escHtml(b.location ?? '—')}</td>
          <td>${escHtml(qty ?? '—')}</td>
          <td>${used}</td>
          <td style="color:${leftNum != null && leftNum <= 0 ? '#c0392b' : leftNum != null && leftNum <= 2 ? '#e67e22' : '#222'};font-weight:${leftNum != null && leftNum <= 2 ? '700' : '400'}">${escHtml(left)}${bar}</td>
          <td><span style="display:inline-block;padding:.1rem .4rem;border-radius:4px;font-size:.75rem;background:${b.status==='active'?'#d4edda':'#f8d7da'};color:${b.status==='active'?'#155724':'#721c24'}">${escHtml(b.status)}</span></td>
          <td style="white-space:nowrap">
            <button class="edit-btn" data-box="${data}" onclick="openEditBox(JSON.parse(this.dataset.box))">edit</button>
            <button class="del-btn" data-box="${escHtml(b.box_id)}" onclick="resetBoxTips(this.dataset.box)">reset tips</button>
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
  <div class="form-grid">
    <div>
      <label>Alert email <span style="color:#888;font-size:.75rem;font-weight:400">— notified at the low-tip threshold</span></label>
      <input id="s-email" type="email" placeholder="e.g. lab@example.com" value="${escHtml(alertEmail)}">
    </div>
    <div>
      <label>Low-tip threshold <span style="color:#888;font-size:.75rem;font-weight:400">— tips remaining that triggers an alert</span></label>
      <input id="s-threshold" type="number" min="0" value="${escHtml(alertThreshold)}">
    </div>
  </div>
  <button class="form-btn" onclick="saveSettings()">Save settings</button>
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

function getKey() {
  if (!_adminKey) {
    _adminKey = prompt('Admin key:') || '';
    if (_adminKey) sessionStorage.setItem('afm_admin_key', _adminKey);
  }
  return _adminKey;
}

function clearKeyIfInvalid(error) {
  if (error === 'invalid admin key') { _adminKey = ''; sessionStorage.removeItem('afm_admin_key'); }
}

async function saveSettings() {
  const email = (document.getElementById('s-email').value || '').trim();
  const threshold = (document.getElementById('s-threshold').value || '').trim();
  const msg = document.getElementById('s-msg');
  const key = getKey();
  if (!key) return;
  msg.className = 'form-msg'; msg.textContent = 'Saving…';
  try {
    const reqs = [
      fetch('/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'alert_email', value: email, adminKey: key }),
      }).then(r => r.json()),
      fetch('/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'alert_threshold', value: threshold, adminKey: key }),
      }).then(r => r.json()),
    ];
    const results = await Promise.all(reqs);
    const bad = results.find(d => !d.ok);
    if (!bad) { msg.className = 'form-msg ok'; msg.textContent = 'Saved.'; }
    else { clearKeyIfInvalid(bad.error); msg.className = 'form-msg err'; msg.textContent = bad.error || 'Failed.'; }
  } catch(e) { msg.className = 'form-msg err'; msg.textContent = 'Network error.'; }
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
      clearKeyIfInvalid(d.error);
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
      clearKeyIfInvalid(d.error);
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
      clearKeyIfInvalid(d.error);
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
      clearKeyIfInvalid(d.error);
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
