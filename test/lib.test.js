import { describe, it, expect } from 'vitest';
import { escHtml, csvCell, safeEqual, requireAdminKey, requireBasicAuth } from '../src/lib/http.js';
import { signEditToken, verifyEditToken } from '../src/lib/token.js';

describe('escHtml', () => {
  it('escapes all dangerous characters including single quotes', () => {
    expect(escHtml(`<a href="x" onclick='y'>&`)).toBe('&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;');
  });
  it('handles null/undefined', () => {
    expect(escHtml(null)).toBe('');
    expect(escHtml(undefined)).toBe('');
  });
});

describe('csvCell', () => {
  it('quotes cells containing commas, quotes or newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('he said "hi"')).toBe('"he said ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
  });
  it('leaves plain values and null untouched', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell(null)).toBe('');
  });
});

describe('safeEqual', () => {
  it('matches equal strings and rejects different ones', () => {
    expect(safeEqual('secret', 'secret')).toBe(true);
    expect(safeEqual('secret', 'sacret')).toBe(false);
    expect(safeEqual('secret', 'secret-longer')).toBe(false);
    expect(safeEqual(undefined, undefined)).toBe(true);
  });
});

describe('requireAdminKey', () => {
  const env = { ADMIN_KEY: 'topsecret' };
  it('accepts the correct key', () => {
    expect(requireAdminKey({ adminKey: 'topsecret' }, env)).toBe(true);
  });
  it('rejects wrong or missing keys', () => {
    expect(requireAdminKey({ adminKey: 'nope' }, env)).toBe(false);
    expect(requireAdminKey({}, env)).toBe(false);
    expect(requireAdminKey(null, env)).toBe(false);
  });
});

describe('requireBasicAuth', () => {
  const env = { ADMIN_KEY: 'topsecret' };
  const req = (header) => ({ headers: { get: () => header } });
  it('accepts user:key and key-only forms', () => {
    expect(requireBasicAuth(req('Basic ' + btoa('admin:topsecret')), env)).toBe(true);
    expect(requireBasicAuth(req('Basic ' + btoa('topsecret')), env)).toBe(true);
  });
  it('rejects wrong password and malformed headers', () => {
    expect(requireBasicAuth(req('Basic ' + btoa('admin:wrong')), env)).toBe(false);
    expect(requireBasicAuth(req('Bearer xyz'), env)).toBe(false);
    expect(requireBasicAuth(req(''), env)).toBe(false);
  });
});

describe('edit tokens', () => {
  const secret = 'signing-secret';
  it('round-trips for the same id', async () => {
    const token = await signEditToken(secret, 42);
    expect(await verifyEditToken(secret, 42, token)).toBe(true);
  });
  it('rejects a token used for a different id', async () => {
    const token = await signEditToken(secret, 42);
    expect(await verifyEditToken(secret, 43, token)).toBe(false);
  });
  it('rejects a wrong secret, tampering, and expired tokens', async () => {
    const token = await signEditToken(secret, 42);
    expect(await verifyEditToken('other', 42, token)).toBe(false);
    expect(await verifyEditToken(secret, 42, token + 'x')).toBe(false);
    const expired = await signEditToken(secret, 42, -1000);
    expect(await verifyEditToken(secret, 42, expired)).toBe(false);
  });
  it('rejects empty input', async () => {
    expect(await verifyEditToken(secret, 42, '')).toBe(false);
    expect(await verifyEditToken('', 42, 'x.y')).toBe(false);
  });
});
