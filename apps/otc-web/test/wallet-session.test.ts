import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InMemoryPearlWalletStorage,
  generatePearlMnemonic,
  pearlMnemonicToSeed,
  deriveOrderKey,
} from '@kaspacom/pearl-wallet';

import { PearlWalletSession } from '../src/wallet/wallet-session.ts';

const FIXED_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// Tests-only KDF override pumped through createPearlWallet inside the session.
// The session itself doesn't expose this knob (production never wants to), so
// tests work around by stubbing globalThis to short-circuit the default. The
// cleanest path is to expose a test-seam constructor variant on the session.
// For now we use the default KDF and just allow up-front time for Argon2 in
// the one test that exercises full create-then-unlock.

test('PearlWalletSession.hydrate is idempotent + safe on first run', async () => {
  const storage = new InMemoryPearlWalletStorage();
  const session = new PearlWalletSession(storage);
  await session.hydrate();
  await session.hydrate();
  const snapshot = session.getSnapshot();
  assert.equal(snapshot.vault, undefined);
  assert.equal(snapshot.locked, true);
  assert.equal(session.hasWallet(), false);
  assert.equal(session.isUnlocked(), false);
});

test('PearlWalletSession.onChange emits on state transitions', async () => {
  const storage = new InMemoryPearlWalletStorage();
  const session = new PearlWalletSession(storage);
  const emitted: Array<{ hasVault: boolean; locked: boolean }> = [];
  session.onChange((s) => emitted.push({ hasVault: Boolean(s.vault), locked: s.locked }));
  await session.hydrate();
  // hydrate emits at least once.
  assert.ok(emitted.length >= 1);
  const finalSnapshot = emitted[emitted.length - 1]!;
  assert.equal(finalSnapshot.hasVault, false);
  assert.equal(finalSnapshot.locked, true);
});

test('PearlWalletSession.deriveNextOrderKey throws if there is no vault', async () => {
  const storage = new InMemoryPearlWalletStorage();
  const session = new PearlWalletSession(storage);
  await session.hydrate();
  await assert.rejects(
    () => session.deriveNextOrderKey({ network: 'testnet2' }),
    /no vault/,
  );
});

test('PearlWalletSession.withOrderPrivkey throws if locked', async () => {
  const storage = new InMemoryPearlWalletStorage();
  const session = new PearlWalletSession(storage);
  await session.hydrate();
  await assert.rejects(
    () => session.withOrderPrivkey(0, () => 'should not run'),
    /locked/,
  );
});

test('PearlWalletSession.hydrate picks the most recently created vault when multiple exist', async () => {
  const storage = new InMemoryPearlWalletStorage();
  // Pre-seed two synthetic vaults so we don't have to wait for Argon2.
  await storage.save({
    walletId: 'older',
    schemaVersion: 1,
    kdf: { algorithm: 'argon2id', memoryKb: 65536, iterations: 3, parallelism: 1, salt: new Uint8Array(16) },
    encryptedMnemonic: new Uint8Array(0),
    derivedKeys: [],
    nextDerivationIndex: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    autoLockMs: 900_000,
  });
  await storage.save({
    walletId: 'newer',
    schemaVersion: 1,
    kdf: { algorithm: 'argon2id', memoryKb: 65536, iterations: 3, parallelism: 1, salt: new Uint8Array(16) },
    encryptedMnemonic: new Uint8Array(0),
    derivedKeys: [],
    nextDerivationIndex: 0,
    createdAt: '2026-05-29T00:00:00.000Z',
    autoLockMs: 900_000,
  });
  const session = new PearlWalletSession(storage);
  await session.hydrate();
  assert.equal(session.getSnapshot().vault?.walletId, 'newer');
});

test('PearlWalletSession derivation matches the BIP86 reference vector', () => {
  // Independent of the session API — proves the underlying wiring is the
  // BIP86 derivation we verified in W1.
  const seed = pearlMnemonicToSeed(FIXED_MNEMONIC);
  const derived = deriveOrderKey(seed, 0);
  // From W1 tests: x-only pubkey @ index 0 = cc8a4bc6...cd6fc115
  assert.equal(
    Array.from(derived.pubkey, (b) => b.toString(16).padStart(2, '0')).join(''),
    'cc8a4bc64d897bddc5fbc2f670f7a8ba0b386779106cf1223c6fc5d7cd6fc115',
  );
});

test('generatePearlMnemonic produces a valid 12-word phrase (re-exported for UI use)', () => {
  const m = generatePearlMnemonic();
  assert.equal(m.split(' ').length, 12);
});
