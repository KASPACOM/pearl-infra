import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PEARL_WALLET_TOTP_DEFAULTS,
  buildTotpProvisioningUri,
  consumeBackupCode,
  generateTotpBackupCodes,
  generateTotpCode,
  generateTotpSecret,
  verifyTotpCode,
} from '../dist/index.js';

// RFC 6238 test vectors, Appendix B. Secret "12345678901234567890" (ASCII)
// produces these codes for HMAC-SHA1 at specific timestamps. We pin a subset
// — the rest exercise SHA-256/-512 which we deliberately don't expose to
// users (every authenticator app supports SHA-1, fewer support 256/512).
const RFC_SECRET = new TextEncoder().encode('12345678901234567890');
const RFC_VECTORS: ReadonlyArray<readonly [number, string]> = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
];

test('generateTotpCode matches the RFC 6238 reference vectors at 8 digits', () => {
  for (const [t, expected] of RFC_VECTORS) {
    const got = generateTotpCode(RFC_SECRET, t, { digits: 8, stepSeconds: 30, algorithm: 'SHA1' });
    assert.equal(got, expected, `t=${t}: expected ${expected}, got ${got}`);
  }
});

test('generateTotpCode produces 6-digit codes by default (matches Google Authenticator)', () => {
  const code = generateTotpCode(RFC_SECRET, 1111111109);
  assert.match(code, /^[0-9]{6}$/);
});

test('generateTotpCode zero-pads short codes so the digit count is always D', () => {
  // Pinned: the RFC-secret produces "026920" at t=900 — a code with a
  // leading zero that MUST NOT be silently dropped to "26920".
  assert.equal(generateTotpCode(RFC_SECRET, 900), '026920');
});

test('verifyTotpCode accepts the current code and ±1 step of skew', () => {
  const secret = generateTotpSecret();
  const t = 1_700_000_000;
  const current = generateTotpCode(secret, t);
  const previous = generateTotpCode(secret, t - 30);
  const next = generateTotpCode(secret, t + 30);
  assert.equal(verifyTotpCode(secret, t, current), true);
  assert.equal(verifyTotpCode(secret, t, previous), true);
  assert.equal(verifyTotpCode(secret, t, next), true);
});

test('verifyTotpCode rejects ±2 steps of skew', () => {
  const secret = generateTotpSecret();
  const t = 1_700_000_000;
  const farPast = generateTotpCode(secret, t - 60);
  const farFuture = generateTotpCode(secret, t + 60);
  assert.equal(verifyTotpCode(secret, t, farPast), false);
  assert.equal(verifyTotpCode(secret, t, farFuture), false);
});

test('verifyTotpCode rejects malformed input', () => {
  const secret = generateTotpSecret();
  assert.equal(verifyTotpCode(secret, 1_700_000_000, ''), false);
  assert.equal(verifyTotpCode(secret, 1_700_000_000, '12345'), false); // 5 digits
  assert.equal(verifyTotpCode(secret, 1_700_000_000, '1234567'), false); // 7 digits
  assert.equal(verifyTotpCode(secret, 1_700_000_000, '12345a'), false); // non-numeric
});

test('verifyTotpCode tolerates whitespace from copy-paste', () => {
  const secret = generateTotpSecret();
  const t = 1_700_000_000;
  const code = generateTotpCode(secret, t);
  // Insert spaces — what some authenticator UIs show.
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  assert.equal(verifyTotpCode(secret, t, spaced), true);
});

test('generateTotpSecret produces 20 random bytes (independent draws)', () => {
  const a = generateTotpSecret();
  const b = generateTotpSecret();
  assert.equal(a.length, 20);
  assert.equal(b.length, 20);
  assert.notDeepEqual(a, b);
});

test('buildTotpProvisioningUri matches the otpauth:// format', () => {
  const secret = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  const uri = buildTotpProvisioningUri({
    accountLabel: 'user@oyster',
    issuer: 'Oysters',
    secret,
  });
  assert.ok(uri.startsWith('otpauth://totp/'));
  assert.ok(uri.includes('Oysters%3Auser%40oyster'));
  assert.ok(uri.includes('issuer=Oysters'));
  assert.ok(uri.includes('algorithm=SHA1'));
  assert.ok(uri.includes('digits=6'));
  assert.ok(uri.includes('period=30'));
  assert.ok(uri.includes('secret=AEBAGBAFAYDQQCIKBMGA2DQPCAIREEYU')); // base32 of the secret
});

test('PEARL_WALLET_TOTP_DEFAULTS uses what every major authenticator supports', () => {
  assert.deepEqual(PEARL_WALLET_TOTP_DEFAULTS, { digits: 6, stepSeconds: 30, algorithm: 'SHA1' });
});

// ---------- backup codes ----------

test('generateTotpBackupCodes returns 8 distinct codes with hashes', () => {
  const codes = generateTotpBackupCodes();
  assert.equal(codes.length, 8);
  const seen = new Set(codes.map((c) => c.code));
  assert.equal(seen.size, 8);
  for (const { hash } of codes) {
    assert.match(hash, /^[0-9a-f]{64}$/);
  }
});

test('consumeBackupCode matches the right entry by SHA-256(code)', () => {
  const codes = generateTotpBackupCodes();
  const hashes = codes.map((c) => c.hash);
  for (const { code, hash } of codes) {
    const matched = consumeBackupCode(code, hashes);
    assert.equal(matched, hash);
  }
});

test('consumeBackupCode rejects wrong codes', () => {
  const codes = generateTotpBackupCodes();
  const hashes = codes.map((c) => c.hash);
  assert.equal(consumeBackupCode('WRONG-CODE', hashes), undefined);
  assert.equal(consumeBackupCode('', hashes), undefined);
});

test('consumeBackupCode is case-insensitive and tolerates whitespace', () => {
  const codes = generateTotpBackupCodes();
  const hashes = codes.map((c) => c.hash);
  const firstCode = codes[0]!.code;
  const lower = firstCode.toLowerCase();
  const spaced = `${firstCode.slice(0, 4)}  ${firstCode.slice(4)}`;
  assert.ok(consumeBackupCode(lower, hashes));
  assert.ok(consumeBackupCode(spaced, hashes));
});
