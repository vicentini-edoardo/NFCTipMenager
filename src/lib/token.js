// Short-lived, signed edit tokens for the public /log/set-tip endpoint.
//
// When a tap is recorded via /log, the server hands back a token that is an
// HMAC of that log row's id (plus an expiry). To later correct the tip number,
// the client must return the token. The server re-derives the HMAC and only
// accepts the edit for the exact row the user just created, and only until the
// token expires. This lets the anonymous tap flow self-correct without exposing
// every row to anyone who can guess an id.

import { safeEqual } from './http.js';

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

// Falls back to ADMIN_KEY so the feature works even if SIGNING_SECRET is unset.
export function signingSecret(env) {
  return env.SIGNING_SECRET || env.ADMIN_KEY || '';
}

async function hmacHex(secret, data) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function signEditToken(secret, id, ttlMs = DEFAULT_TTL_MS) {
  const exp = Date.now() + ttlMs;
  const sig = await hmacHex(secret, `${id}.${exp}`);
  return `${exp}.${sig}`;
}

export async function verifyEditToken(secret, id, token) {
  if (!secret || !token || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot < 0) return false;
  const exp = Number(token.slice(0, dot));
  const sig = token.slice(dot + 1);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  const expected = await hmacHex(secret, `${id}.${exp}`);
  return safeEqual(expected, sig);
}
