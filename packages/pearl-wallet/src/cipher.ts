/**
 * AES-256-GCM with the WebCrypto API. Browser + Node 22 both ship this. No
 * dependency on Node's `crypto` module — keeps the package safe to bundle in
 * the otc-web Vite build.
 *
 * Each call uses a fresh 12-byte random nonce, packed into the ciphertext as
 * `nonce || tag-bearing-ciphertext`. The format is:
 *
 *   bytes[0..12)    nonce
 *   bytes[12..]     AES-GCM output (ciphertext + 16-byte tag, exactly as the
 *                   WebCrypto encrypt method produces)
 *
 * Anyone with the key + the packed blob can decrypt. No additional
 * authenticated data — the GCM tag covers the ciphertext itself, which is all
 * we need for vault storage. (If we ever need AAD for binding to context, we
 * bump the schema version and migrate.)
 */

const AES_GCM_NONCE_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const AES_GCM_KEY_BYTES = 32;

export async function encryptVaultBlob(plaintext: Uint8Array, vaultKey: Uint8Array): Promise<Uint8Array> {
  assertKey(vaultKey);
  const nonce = randomBytes(AES_GCM_NONCE_BYTES);
  const cryptoKey = await importAesKey(vaultKey);
  const ciphertext = new Uint8Array(
    await cryptoLike().subtle.encrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource },
      cryptoKey,
      plaintext as BufferSource,
    ),
  );
  const blob = new Uint8Array(nonce.length + ciphertext.length);
  blob.set(nonce, 0);
  blob.set(ciphertext, nonce.length);
  return blob;
}

export async function decryptVaultBlob(blob: Uint8Array, vaultKey: Uint8Array): Promise<Uint8Array> {
  assertKey(vaultKey);
  if (blob.length < AES_GCM_NONCE_BYTES + AES_GCM_TAG_BYTES) {
    throw new Error('pearl-wallet vault blob is too short to contain a nonce + tag');
  }
  const nonce = blob.slice(0, AES_GCM_NONCE_BYTES);
  const ciphertext = blob.slice(AES_GCM_NONCE_BYTES);
  const cryptoKey = await importAesKey(vaultKey);
  try {
    const plaintext = await cryptoLike().subtle.decrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource },
      cryptoKey,
      ciphertext as BufferSource,
    );
    return new Uint8Array(plaintext);
  } catch {
    // GCM authentication failure (wrong key, wrong nonce, tampered ciphertext).
    // Generic error — never tell the caller which check failed.
    throw new Error('pearl-wallet vault decryption failed');
  }
}

async function importAesKey(rawKey: Uint8Array): Promise<CryptoKey> {
  return cryptoLike().subtle.importKey('raw', rawKey as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function assertKey(key: Uint8Array): void {
  if (key.length !== AES_GCM_KEY_BYTES) {
    throw new Error(`pearl-wallet AES-256-GCM requires a ${AES_GCM_KEY_BYTES}-byte key, got ${key.length}`);
  }
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  cryptoLike().getRandomValues(out);
  return out;
}

function cryptoLike(): { getRandomValues: (buf: Uint8Array) => Uint8Array; subtle: SubtleCrypto } {
  if (typeof globalThis.crypto?.getRandomValues === 'function' && globalThis.crypto.subtle) {
    return globalThis.crypto;
  }
  throw new Error('pearl-wallet requires a runtime with WebCrypto (node 22+ or any modern browser)');
}
