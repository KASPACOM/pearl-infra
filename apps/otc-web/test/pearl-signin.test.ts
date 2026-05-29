import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';

import { initEccLib } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';

import {
  InMemoryPearlWalletStorage,
  pearlAddressFromXOnlyPubkey,
  deriveOrderKeyFromMnemonic,
} from '@kaspacom/pearl-wallet';
import { createPearlP2trPayment } from '@kaspacom/pearl-script';

import {
  PearlWalletSession,
  _resetPearlWalletSessionForTesting,
  getPearlWalletSession,
  setPearlWalletSession,
} from '../src/wallet/wallet-session.ts';

const FIXED_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const FAST_KDF = { algorithm: 'argon2id' as const, memoryKb: 8192, iterations: 1, parallelism: 1, outputBytes: 32 };

test.before(() => {
  initEccLib(ecc);
});

test('getIdentity returns BIP86 index 0 — stable across recoveries from the same mnemonic', async () => {
  const session = new PearlWalletSession(new InMemoryPearlWalletStorage());
  await session.create({ mnemonic: FIXED_MNEMONIC, password: 'correct horse battery', kdfOverride: FAST_KDF });
  const identity = await session.getIdentity('testnet2');
  // The BIP86 index 0 derived address — same one we pinned in W1's tests.
  const directDerived = deriveOrderKeyFromMnemonic(FIXED_MNEMONIC, 0);
  const expectedAddress = pearlAddressFromXOnlyPubkey(directDerived.pubkey, 'testnet2');
  assert.equal(identity.address, expectedAddress);
  assert.equal(identity.publicKeyHex, Buffer.from(directDerived.pubkey).toString('hex'));
  session.lock();
});

test('signWalletChallenge produces a BIP340 Schnorr sig that the server-side verifier accepts', async () => {
  const session = new PearlWalletSession(new InMemoryPearlWalletStorage());
  await session.create({ mnemonic: FIXED_MNEMONIC, password: 'correct horse battery', kdfOverride: FAST_KDF });
  const identity = await session.getIdentity('testnet2');
  const message = 'Sign this challenge for Oysters wallet test\nnonce: abc123';
  const signatureHex = await session.signWalletChallenge(message);

  // Replicate the server's verifyWalletChallenge for Pearl wallet type.
  const messageHash = createHash('sha256').update(message).digest();
  const pubkey = Buffer.from(identity.publicKeyHex, 'hex');
  const signatureBytes = Buffer.from(signatureHex, 'hex');
  assert.equal(signatureBytes.length, 64, 'BIP340 Schnorr signatures are 64 bytes');
  assert.equal(ecc.verifySchnorr(messageHash, pubkey, signatureBytes), true);

  // Server also re-derives the address from the pubkey and compares — verify
  // that matches identity.address.
  const expectedAddress = createPearlP2trPayment({
    network: 'testnet2',
    internalPubkey: pubkey,
  }).address;
  assert.equal(expectedAddress, identity.address);
  session.lock();
});

test('signWalletChallenge throws if the wallet is locked', async () => {
  const session = new PearlWalletSession(new InMemoryPearlWalletStorage());
  await session.create({ mnemonic: FIXED_MNEMONIC, password: 'correct horse battery', kdfOverride: FAST_KDF });
  session.lock();
  await assert.rejects(() => session.signWalletChallenge('hi'), /locked/);
});

test('deriveNextOrderKey skips the identity slot (starts at index 1)', async () => {
  const session = new PearlWalletSession(new InMemoryPearlWalletStorage());
  await session.create({ mnemonic: FIXED_MNEMONIC, password: 'correct horse battery', kdfOverride: FAST_KDF });
  const first = await session.deriveNextOrderKey({ network: 'testnet2' });
  assert.equal(first.derivationIndex, 1);
  session.lock();
});

test('getPearlWalletSession + setPearlWalletSession singleton lifecycle', () => {
  _resetPearlWalletSessionForTesting();
  // After reset, getPearlWalletSession throws.
  assert.throws(() => getPearlWalletSession(), /not initialized/);
  const session = new PearlWalletSession(new InMemoryPearlWalletStorage());
  setPearlWalletSession(session);
  assert.equal(getPearlWalletSession(), session);
  _resetPearlWalletSessionForTesting();
});
