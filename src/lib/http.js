// HTTP / formatting helpers shared across handlers.

export function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return (s.includes(',') || s.includes('"') || s.includes('\n'))
    ? '"' + s.replace(/"/g, '""') + '"'
    : s;
}

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

// Parse a JSON body, returning null on malformed input instead of throwing.
export async function parseJson(request) {
  try { return await request.json(); }
  catch { return null; }
}

// Constant-time string comparison to avoid leaking secrets via timing.
export function safeEqual(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(String(a ?? ''));
  const bb = enc.encode(String(b ?? ''));
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

// Admin-key auth for JSON API endpoints.
export function requireAdminKey(body, env) {
  return !!body && safeEqual(body.adminKey, env.ADMIN_KEY);
}

// HTTP Basic auth for browser-facing admin endpoints (/admin, /export/csv).
// Username is ignored; the password must equal ADMIN_KEY.
export function requireBasicAuth(request, env) {
  const header = request.headers.get('Authorization') ?? '';
  if (!header.startsWith('Basic ')) return false;
  let decoded;
  try { decoded = atob(header.slice(6)); }
  catch { return false; }
  const pass = decoded.includes(':') ? decoded.slice(decoded.indexOf(':') + 1) : decoded;
  return safeEqual(pass, env.ADMIN_KEY);
}

// Returns a 401 Response if Basic auth fails, or null if it passes.
export function basicAuthChallenge(request, env) {
  if (requireBasicAuth(request, env)) return null;
  return new Response('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="AFM Admin"' },
  });
}
