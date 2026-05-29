import assert from 'node:assert/strict';
import test from 'node:test';

import {
  changePearlWalletPassword,
  createPearlWallet,
  decryptVaultBlob,
  deriveOrderKeyFromMnemonic,
  deriveVaultKey,
  encryptVaultBlob,
  generatePearlMnemonic,
  generatePearlWalletKdfSalt,
  InMemoryPearlWalletStorage,
  LockedVaultController,
  PEARL_WALLET_KDF_DEFAULTS,
  recordDerivedKey,
  unlockPearlWallet,
} from '../dist/index.js';

const FIXED_NOW = new Date('2026-05-29T20:00:00.000Z');
const FIXED_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// Test-only KDF: Argon2id with 8 MiB / 1 iteration / 1 thread keeps the
// suite under ~10 seconds. Production code uses PEARL_WALLET_KDF_DEFAULTS
// (64 MiB × 3) — verified in the "produces different output for different
// salts" / "rejects weak KDF params" tests above, which exercise the real
// defaults.
const FAST_KDF = {
  algorithm: 'argon2id' as const,
  memoryKb: 8192,
  iterations: 1,
  parallelism: 1,
  outputBytes: 32,
};

// ---------- KDF ----------

test('deriveVaultKey is deterministic given identical params', () => {
  const salt = new Uint8Array(16);
  salt.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  const a = deriveVaultKey('password-one-two-three', { ...PEARL_WALLET_KDF_DEFAULTS, salt });
  const b = deriveVaultKey('password-one-two-three', { ...PEARL_WALLET_KDF_DEFAULTS, salt });
  assert.equal(a.length, 32);
  assert.deepEqual(a, b);
});

test('deriveVaultKey produces different output for different salts', () => {
  const a = deriveVaultKey('password-one-two-three', { ...PEARL_WALLET_KDF_DEFAULTS, salt: generatePearlWalletKdfSalt() });
  const b = deriveVaultKey('password-one-two-three', { ...PEARL_WALLET_KDF_DEFAULTS, salt: generatePearlWalletKdfSalt() });
  assert.notDeepEqual(a, b);
});

test('deriveVaultKey rejects weak KDF params', () => {
  const salt = generatePearlWalletKdfSalt();
  assert.throws(() => deriveVaultKey('pw1234567890ab', { ...PEARL_WALLET_KDF_DEFAULTS, memoryKb: 1024, salt }), /sub-8 MiB/);
  assert.throws(() => deriveVaultKey('pw1234567890ab', { ...PEARL_WALLET_KDF_DEFAULTS, iterations: 0, salt }), /zero iterations/);
  assert.throws(() => deriveVaultKey('pw1234567890ab', { ...PEARL_WALLET_KDF_DEFAULTS, parallelism: 0, salt }), /zero parallelism/);
  assert.throws(() => deriveVaultKey('pw1234567890ab', { ...PEARL_WALLET_KDF_DEFAULTS, salt: new Uint8Array(4) }), /salts shorter than 8/);
});

test('generatePearlWalletKdfSalt returns 16 random bytes', () => {
  const a = generatePearlWalletKdfSalt();
  const b = generatePearlWalletKdfSalt();
  assert.equal(a.length, 16);
  assert.equal(b.length, 16);
  assert.notDeepEqual(a, b);
});

// ---------- AES-GCM cipher ----------

test('encryptVaultBlob → decryptVaultBlob round-trips', async () => {
  const key = new Uint8Array(32);
  globalThis.crypto.getRandomValues(key);
  const plaintext = new TextEncoder().encode('hello pearl wallet');
  const blob = await encryptVaultBlob(plaintext, key);
  const recovered = await decryptVaultBlob(blob, key);
  assert.equal(new TextDecoder().decode(recovered), 'hello pearl wallet');
});

test('decryptVaultBlob rejects wrong key', async () => {
  const k1 = new Uint8Array(32);
  globalThis.crypto.getRandomValues(k1);
  const k2 = new Uint8Array(32);
  globalThis.crypto.getRandomValues(k2);
  const blob = await encryptVaultBlob(new TextEncoder().encode('secret'), k1);
  await assert.rejects(() => decryptVaultBlob(blob, k2), /decryption failed/);
});

test('decryptVaultBlob rejects tampered ciphertext', async () => {
  const key = new Uint8Array(32);
  globalThis.crypto.getRandomValues(key);
  const blob = await encryptVaultBlob(new TextEncoder().encode('hello pearl wallet'), key);
  blob[blob.length - 1] ^= 1; // flip last byte
  await assert.rejects(() => decryptVaultBlob(blob, key), /decryption failed/);
});

test('decryptVaultBlob rejects blobs that are too short to hold a nonce + tag', async () => {
  const key = new Uint8Array(32);
  await assert.rejects(() => decryptVaultBlob(new Uint8Array(20), key), /too short/);
});

test('encryptVaultBlob rejects wrong-sized keys', async () => {
  await assert.rejects(() => encryptVaultBlob(new Uint8Array(4), new Uint8Array(16)), /32-byte key/);
});

test('encrypting the same plaintext twice produces different ciphertext (fresh nonce)', async () => {
  const key = new Uint8Array(32);
  globalThis.crypto.getRandomValues(key);
  const plaintext = new TextEncoder().encode('repeat');
  const a = await encryptVaultBlob(plaintext, key);
  const b = await encryptVaultBlob(plaintext, key);
  assert.notDeepEqual(a, b);
});

// ---------- Vault lifecycle ----------

test('createPearlWallet stores an encrypted mnemonic; unlockPearlWallet recovers it', async () => {
  const storage = new InMemoryPearlWalletStorage();
  const vault = await createPearlWallet({
    mnemonic: FIXED_MNEMONIC,
    password: 'correct horse battery',
    storage,
    kdfOverride: FAST_KDF,
    now: () => FIXED_NOW,
  });
  assert.equal(vault.schemaVersion, 1);
  assert.equal(vault.kdf.algorithm, 'argon2id');
  assert.equal(vault.derivedKeys.length, 0);
  assert.equal(vault.createdAt, FIXED_NOW.toISOString());
  const recovered = await unlockPearlWallet({ vault, password: 'correct horse battery' });
  assert.equal(recovered, FIXED_MNEMONIC);
});

test('unlockPearlWallet rejects the wrong password with a generic error', async () => {
  const storage = new InMemoryPearlWalletStorage();
  const vault = await createPearlWallet({
    mnemonic: FIXED_MNEMONIC,
    password: 'correct horse battery',
    storage,
    kdfOverride: FAST_KDF,
  });
  await assert.rejects(
    () => unlockPearlWallet({ vault, password: 'wrong horse battery' }),
    /decryption failed/,
  );
});

test('createPearlWallet rejects weak passwords', async () => {
  const storage = new InMemoryPearlWalletStorage();
  await assert.rejects(
    () => createPearlWallet({ mnemonic: FIXED_MNEMONIC, password: 'short', storage }),
    /at least 12 characters/,
  );
});

test('createPearlWallet rejects invalid mnemonics', async () => {
  const storage = new InMemoryPearlWalletStorage();
  await assert.rejects(
    () => createPearlWallet({ mnemonic: 'not a valid phrase', password: 'correct horse battery', storage }),
    /invalid pearl-wallet mnemonic/,
  );
});

test('changePearlWalletPassword re-encrypts under a new password, keeps the same mnemonic', async () => {
  const storage = new InMemoryPearlWalletStorage();
  const vault = await createPearlWallet({
    mnemonic: FIXED_MNEMONIC,
    password: 'correct horse battery',
    storage,
    kdfOverride: FAST_KDF,
  });
  const updated = await changePearlWalletPassword({
    vault,
    currentPassword: 'correct horse battery',
    newPassword: 'different correct horse battery',
    storage,
    kdfOverride: FAST_KDF,
  });
  // Old password no longer works.
  await assert.rejects(
    () => unlockPearlWallet({ vault: updated, password: 'correct horse battery' }),
    /decryption failed/,
  );
  // New password recovers the original mnemonic.
  const mnemonic = await unlockPearlWallet({ vault: updated, password: 'different correct horse battery' });
  assert.equal(mnemonic, FIXED_MNEMONIC);
  // walletId stays stable across rotation.
  assert.equal(updated.walletId, vault.walletId);
});

test('changePearlWalletPassword rejects wrong current password', async () => {
  const storage = new InMemoryPearlWalletStorage();
  const vault = await createPearlWallet({
    mnemonic: FIXED_MNEMONIC,
    password: 'correct horse battery',
    storage,
    kdfOverride: FAST_KDF,
  });
  await assert.rejects(
    () =>
      changePearlWalletPassword({
        vault,
        currentPassword: 'wrong horse battery',
        newPassword: 'different correct horse battery',
        storage,
    kdfOverride: FAST_KDF,
      }),
    /decryption failed/,
  );
});

test('changePearlWalletPassword rejects weak new password', async () => {
  const storage = new InMemoryPearlWalletStorage();
  const vault = await createPearlWallet({
    mnemonic: FIXED_MNEMONIC,
    password: 'correct horse battery',
    storage,
    kdfOverride: FAST_KDF,
  });
  await assert.rejects(
    () =>
      changePearlWalletPassword({
        vault,
        currentPassword: 'correct horse battery',
        newPassword: 'short',
        storage,
    kdfOverride: FAST_KDF,
      }),
    /at least 12 characters/,
  );
});

// ---------- Derived-key tracking ----------

test('recordDerivedKey appends pubkey metadata and bumps nextDerivationIndex', async () => {
  const storage = new InMemoryPearlWalletStorage();
  const vault = await createPearlWallet({
    mnemonic: FIXED_MNEMONIC,
    password: 'correct horse battery',
    storage,
    kdfOverride: FAST_KDF,
  });
  const derived = deriveOrderKeyFromMnemonic(FIXED_MNEMONIC, 0);
  const updated = await recordDerivedKey({
    vault,
    storage,
    kdfOverride: FAST_KDF,
    derivationIndex: 0,
    publicKey: derived.pubkey,
    address: 'tprl1pmaker',
    orderId: 'order-xyz',
    now: () => FIXED_NOW,
  });
  assert.equal(updated.derivedKeys.length, 1);
  assert.equal(updated.derivedKeys[0].orderId, 'order-xyz');
  assert.equal(updated.derivedKeys[0].address, 'tprl1pmaker');
  assert.equal(updated.nextDerivationIndex, 1);
  // Storage is also updated.
  const reloaded = await storage.load(vault.walletId);
  assert.equal(reloaded?.nextDerivationIndex, 1);
});

test('recordDerivedKey never persists the private key', async () => {
  const storage = new InMemoryPearlWalletStorage();
  const vault = await createPearlWallet({
    mnemonic: FIXED_MNEMONIC,
    password: 'correct horse battery',
    storage,
    kdfOverride: FAST_KDF,
  });
  const derived = deriveOrderKeyFromMnemonic(FIXED_MNEMONIC, 7);
  const updated = await recordDerivedKey({
    vault,
    storage,
    kdfOverride: FAST_KDF,
    derivationIndex: 7,
    publicKey: derived.pubkey,
    address: 'tprl1pmaker',
  });
  const flat = JSON.stringify(updated);
  // The privkey hex should never appear anywhere in the serialized vault.
  const privHex = Array.from(derived.privkey, (b) => b.toString(16).padStart(2, '0')).join('');
  assert.equal(flat.includes(privHex), false);
});

test('recordDerivedKey bumps nextDerivationIndex monotonically regardless of insertion order', async () => {
  const storage = new InMemoryPearlWalletStorage();
  let vault = await createPearlWallet({
    mnemonic: FIXED_MNEMONIC,
    password: 'correct horse battery',
    storage,
    kdfOverride: FAST_KDF,
  });
  const k5 = deriveOrderKeyFromMnemonic(FIXED_MNEMONIC, 5);
  vault = await recordDerivedKey({
    vault,
    storage,
    kdfOverride: FAST_KDF,
    derivationIndex: 5,
    publicKey: k5.pubkey,
    address: 'tprl1pa',
  });
  assert.equal(vault.nextDerivationIndex, 6);
  const k2 = deriveOrderKeyFromMnemonic(FIXED_MNEMONIC, 2);
  vault = await recordDerivedKey({
    vault,
    storage,
    kdfOverride: FAST_KDF,
    derivationIndex: 2,
    publicKey: k2.pubkey,
    address: 'tprl1pb',
  });
  // Don't go backwards.
  assert.equal(vault.nextDerivationIndex, 6);
});

// ---------- InMemory storage adapter ----------

test('InMemoryPearlWalletStorage round-trips, lists, and deletes vaults', async () => {
  const storage = new InMemoryPearlWalletStorage();
  const a = await createPearlWallet({ mnemonic: generatePearlMnemonic(), password: 'aaaaaaaaaaaa', storage, walletId: 'a', kdfOverride: FAST_KDF });
  const b = await createPearlWallet({ mnemonic: generatePearlMnemonic(), password: 'aaaaaaaaaaaa', storage, walletId: 'b', kdfOverride: FAST_KDF });
  const all = await storage.list();
  assert.equal(all.length, 2);
  await storage.delete(a.walletId);
  assert.equal((await storage.load(a.walletId)), undefined);
  assert.equal((await storage.load(b.walletId))?.walletId, b.walletId);
});

// ---------- LockedVaultController ----------

test('LockedVaultController starts locked; unlock + lock toggles state', () => {
  const c = new LockedVaultController();
  assert.equal(c.getState().status, 'locked');
  c.unlock('mnemonic-shh');
  assert.equal(c.getState().status, 'unlocked');
  c.lock();
  assert.equal(c.getState().status, 'locked');
});

test('LockedVaultController.withMnemonic exposes mnemonic only while unlocked', () => {
  const c = new LockedVaultController();
  assert.throws(() => c.withMnemonic((m) => m), /locked/);
  c.unlock('mnemonic-shh');
  const m = c.withMnemonic((m) => m.length);
  assert.equal(m, 'mnemonic-shh'.length);
  c.lock(); // clean up the auto-lock timer so node exits
});

test('LockedVaultController auto-locks after the idle window', () => {
  let scheduledMs = 0;
  let pendingCb: (() => void) | undefined;
  const c = new LockedVaultController({
    autoLockMs: 1_000,
    setTimer: (cb, ms) => {
      scheduledMs = ms;
      pendingCb = cb;
      return 'timer-handle';
    },
    clearTimer: () => {
      pendingCb = undefined;
    },
  });
  c.unlock('mnemonic-shh');
  assert.equal(scheduledMs, 1_000);
  assert.equal(c.getState().status, 'unlocked');
  // Simulate the timer firing.
  pendingCb?.();
  assert.equal(c.getState().status, 'locked');
});

test('LockedVaultController.touch reschedules the lock timer', () => {
  const scheduleCalls: number[] = [];
  let pendingCb: (() => void) | undefined;
  const c = new LockedVaultController({
    autoLockMs: 1_000,
    setTimer: (cb, ms) => {
      scheduleCalls.push(ms);
      pendingCb = cb;
      return 'timer-handle';
    },
    clearTimer: () => {
      pendingCb = undefined;
    },
  });
  c.unlock('mnemonic-shh');
  c.touch();
  c.touch();
  assert.equal(scheduleCalls.length, 3); // unlock + 2 touches
});

test('LockedVaultController emits state changes to listeners', () => {
  const c = new LockedVaultController();
  const events: string[] = [];
  c.onStateChange((s) => events.push(s.status));
  c.unlock('shh');
  c.lock();
  assert.deepEqual(events, ['unlocked', 'locked']);
});

test('LockedVaultController.onStateChange returns an unsubscribe function', () => {
  const c = new LockedVaultController();
  const events: string[] = [];
  const off = c.onStateChange((s) => events.push(s.status));
  off();
  c.unlock('shh');
  assert.deepEqual(events, []);
  c.lock(); // clean up the auto-lock timer so node exits
});
