// Brevo transactional email helpers.

import { escHtml } from './http.js';

// The verified Brevo sender. Configurable via the SENDER_EMAIL var so it does
// not have to be hardcoded before deploy; falls back to a placeholder.
function sender(env) {
  return { name: 'AFM Tips', email: env.SENDER_EMAIL || 'your-verified-sender@example.com' };
}

export async function brevoSend(env, to, subject, html) {
  if (!env.BREVO_API_KEY) return;
  await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: sender(env),
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });
}

export async function sendLowTipsAlert(env, boxId, tipModel, location, remaining, threshold) {
  const setting = await env.afm_tips_db.prepare('SELECT value FROM settings WHERE key = ?').bind('alert_email').first();
  if (!setting?.value) return;
  const loc = location ? ` at <strong>${escHtml(location)}</strong>` : '';
  await brevoSend(env, setting.value,
    `Low tips alert: Box ${boxId} — ${remaining} tips left`,
    `<p>Box <strong>${escHtml(boxId)}</strong> (${escHtml(tipModel)}) has only <strong>${remaining}</strong> tips remaining${loc}.</p><p>Alert threshold: ${escHtml(threshold)}. Please reorder soon.</p>`
  );
}

export async function sendWelcomeEmail(env, toEmail, adminUrl) {
  await brevoSend(env, toEmail,
    'You are now the AFM Tip Manager',
    `<p>Hello,</p>
    <p>You have been designated as the responsible person for AFM probe tip inventory management.</p>
    <p>You will receive an automatic alert when any tip box reaches its configured low-tip threshold, so you can reorder before supplies run out.</p>
    <p>You can view the current status of all boxes and the full usage history in the admin dashboard:</p>
    <p><a href="${adminUrl}">${adminUrl}</a></p>
    <p style="color:#888;font-size:.85em;margin-top:2em">This message was sent automatically by the AFM Tip Tracker system.</p>`
  );
}

export async function sendTestEmail(env, toEmail, adminUrl) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sender: sender(env),
      to: [{ email: toEmail }],
      subject: '[TEST] AFM Tip Tracker alert',
      htmlContent: `<p>Test email from AFM Tip Tracker. Admin: <a href="${adminUrl}">${adminUrl}</a></p>`,
    }),
  });
  const body = await res.json();
  return { ok: res.ok, status: res.status, brevo: body };
}
