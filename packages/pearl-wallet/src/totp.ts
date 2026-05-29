import { hmac } from '@noble/hashes/hmac';
import { sha1 } from '@noble/hashes/sha1';
import { sha256 } from '@noble/hashes/sha2';

/**
 * RFC 6238 TOTP (Time-based One-Time Password). Generates and verifies the
 * 6-digit codes shown by authenticator apps (Google Authenticator, Authy,
 * 1Password, etc).
 *
 * Defaults match what every major authenticator app expects:
 *   - 30-second step window
 *   - 6-digit code
 *   - HMAC-SHA1 (RFC 6238 baseline; most apps don't support SHA-256/-512)
 *
 * The TOTP secret is stored encrypted inside the wallet vault. We never
 * persist it in the clear, and we never expose it to React component state
 * after the initial QR-code reveal.
 */

const DEFAULTS = {
  digits: 6,
  stepSeconds: 30,
  algorithm: 'SHA1' as const,
};

export interface PearlTotpParams {
  digits: number;
  stepSeconds: number;
  algorithm: 'SHA1' | 'SHA256';
}

export const PEARL_WALLET_TOTP_DEFAULTS: PearlTotpParams = { ...DEFAULTS };

/**
 * Generates a random 20-byte secret suitable for TOTP. Returned as raw bytes;
 * callers encode to base32 for the provisioning URI / QR code.
 */
export function generateTotpSecret(): Uint8Array {
  const secret = new Uint8Array(20);
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    throw new Error('pearl-wallet TOTP requires crypto.getRandomValues');
  }
  globalThis.crypto.getRandomValues(secret);
  return secret;
}

/**
 * RFC 6238 TOTP code for a given Unix timestamp + secret. Returns the digits
 * as a zero-padded string (e.g. "012345"). The default 6 digits + 30 s step +
 * HMAC-SHA1 matches all major authenticator apps.
 */
export function generateTotpCode(
  secret: Uint8Array,
  unixSeconds: number,
  params: PearlTotpParams = PEARL_WALLET_TOTP_DEFAULTS,
): string {
  const counter = Math.floor(unixSeconds / params.stepSeconds);
  const counterBytes = new Uint8Array(8);
  // Big-endian 64-bit counter. Top bytes are 0 for any sane timestamp; we
  // still fill the full 8 bytes so HMAC matches the RFC byte layout.
  let n = counter;
  for (let i = 7; i >= 0; i -= 1) {
    counterBytes[i] = n & 0xff;
    n = Math.floor(n / 256);
  }
  const hmacFn = params.algorithm === 'SHA1' ? sha1 : sha256;
  const mac = hmac(hmacFn, secret, counterBytes);
  // Dynamic truncation per RFC 4226 §5.3.
  const offset = mac[mac.length - 1]! & 0x0f;
  const binCode =
    ((mac[offset]! & 0x7f) << 24) |
    ((mac[offset + 1]! & 0xff) << 16) |
    ((mac[offset + 2]! & 0xff) << 8) |
    (mac[offset + 3]! & 0xff);
  const modulus = 10 ** params.digits;
  return (binCode % modulus).toString().padStart(params.digits, '0');
}

/**
 * Verifies a user-entered code against the secret, allowing ±1 step of clock
 * skew. The ±1 window is the RFC 6238 recommendation — strict enough to not
 * meaningfully extend the attack window, lenient enough that minor device
 * clock drift doesn't lock users out.
 */
export function verifyTotpCode(
  secret: Uint8Array,
  unixSeconds: number,
  code: string,
  params: PearlTotpParams = PEARL_WALLET_TOTP_DEFAULTS,
): boolean {
  const normalised = code.replace(/\s+/g, '');
  if (!/^[0-9]+$/.test(normalised) || normalised.length !== params.digits) return false;
  for (const drift of [-1, 0, 1]) {
    if (constantTimeEquals(normalised, generateTotpCode(secret, unixSeconds + drift * params.stepSeconds, params))) {
      return true;
    }
  }
  return false;
}

/**
 * Standard otpauth:// provisioning URI per the Google Authenticator
 * key-uri-format spec. Authenticator apps scan this as a QR code.
 *
 * @param accountLabel  shown in the user's authenticator list, e.g. "user@oyster"
 * @param issuer        the brand name, e.g. "Oysters"
 */
export function buildTotpProvisioningUri(input: {
  accountLabel: string;
  issuer: string;
  secret: Uint8Array;
  params?: PearlTotpParams;
}): string {
  const params = input.params ?? PEARL_WALLET_TOTP_DEFAULTS;
  const base32Secret = encodeBase32(input.secret);
  const labelEnc = encodeURIComponent(`${input.issuer}:${input.accountLabel}`);
  const queryParts = [
    `secret=${base32Secret}`,
    `issuer=${encodeURIComponent(input.issuer)}`,
    `algorithm=${params.algorithm}`,
    `digits=${params.digits}`,
    `period=${params.stepSeconds}`,
  ];
  return `otpauth://totp/${labelEnc}?${queryParts.join('&')}`;
}

// ---------- internals ----------

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let result = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    result += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  // No padding — authenticator apps tolerate omission, and most QR codes
  // skip it for shorter URIs.
  return result;
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Generates 8 single-use backup codes of the form "XXXX-XXXX" (8 base32 chars).
 * Each one is independent random entropy. The caller persists their SHA-256
 * hashes in the vault; the user is shown the cleartext exactly once at
 * enrollment.
 */
export function generateTotpBackupCodes(count = 8): { code: string; hash: string }[] {
  const result: { code: string; hash: string }[] = [];
  for (let i = 0; i < count; i += 1) {
    const bytes = new Uint8Array(8);
    globalThis.crypto.getRandomValues(bytes);
    const code = `${encodeBase32(bytes.slice(0, 4))}-${encodeBase32(bytes.slice(4))}`.slice(0, 9);
    const hash = bytesToHex(sha256(new TextEncoder().encode(code)));
    result.push({ code, hash });
  }
  return result;
}

/** Verify a user-entered backup code against the stored hash list (constant
 * time). Returns the matched hash so the caller can remove it from the vault
 * (single-use semantics). */
export function consumeBackupCode(
  enteredCode: string,
  storedHashes: readonly string[],
): string | undefined {
  const normalised = enteredCode.toUpperCase().replace(/\s+/g, '');
  const hash = bytesToHex(sha256(new TextEncoder().encode(normalised)));
  for (const stored of storedHashes) {
    if (constantTimeEquals(hash, stored)) return stored;
  }
  return undefined;
}

function bytesToHex(bytes: Uint8Array): string {
  let result = '';
  for (const byte of bytes) result += byte.toString(16).padStart(2, '0');
  return result;
}
