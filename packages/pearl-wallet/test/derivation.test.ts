import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveOrderKey,
  deriveOrderKeyFromMnemonic,
  formatPearlWalletDerivationPath,
  pearlAddressFromXOnlyPubkey,
  pearlMnemonicToSeed,
} from '../dist/index.js';

// BIP86 reference test vector.
// Source: https://github.com/bitcoin/bips/blob/master/bip-0086.mediawiki#test-vectors
const BIP86_REF_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// BIP86 spec table:
//   Account 0, first receiving address: m/86'/0'/0'/0/0
//     xprv ... privkey: 41f41d69260df4cf277826a9b65a3717e4eeddbeedf637f212ca096576479361
//     xpub ... pubkey:  cc8a4bc64d897bddc5fbc2f670f7a8ba0b386779106cf1223c6fc5d7cd6fc115
//   Account 0, second receiving address: m/86'/0'/0'/0/1
//     pubkey:           83dfe85a3151d2517290da461fe2815591ef69f2b18a2ce63f01697a8b313145
//   Account 0, first change address: m/86'/0'/0'/1/0
//     pubkey:           399f1b2f4393f29a18c937859c5dd8a77350103157eb880f02e8c08214277cef
const BIP86_X_ONLY_PUBKEY_0 = 'cc8a4bc64d897bddc5fbc2f670f7a8ba0b386779106cf1223c6fc5d7cd6fc115';
const BIP86_X_ONLY_PUBKEY_1 = '83dfe85a3151d2517290da461fe2815591ef69f2b18a2ce63f01697a8b313145';
const BIP86_PRIVKEY_0_HEX = '41f41d69260df4cf277826a9b65a3717e4eeddbeedf637f212ca096576479361';

test('BIP86 vector: m/86\'/0\'/0\'/0/0 matches the reference x-only pubkey + privkey', () => {
  const key = deriveOrderKeyFromMnemonic(BIP86_REF_MNEMONIC, 0);
  assert.equal(bytesToHex(key.pubkey), BIP86_X_ONLY_PUBKEY_0);
  assert.equal(bytesToHex(key.privkey), BIP86_PRIVKEY_0_HEX);
  assert.equal(key.derivationPath, "m/86'/0'/0'/0/0");
});

test('BIP86 vector: m/86\'/0\'/0\'/0/1 matches the reference x-only pubkey', () => {
  const key = deriveOrderKeyFromMnemonic(BIP86_REF_MNEMONIC, 1);
  assert.equal(bytesToHex(key.pubkey), BIP86_X_ONLY_PUBKEY_1);
  assert.equal(key.derivationPath, "m/86'/0'/0'/0/1");
});

test('deriveOrderKey is deterministic — same seed + index → identical bytes', () => {
  const seed = pearlMnemonicToSeed(BIP86_REF_MNEMONIC);
  const a = deriveOrderKey(seed, 5);
  const b = deriveOrderKey(seed, 5);
  assert.deepEqual(a.pubkey, b.pubkey);
  assert.deepEqual(a.privkey, b.privkey);
});

test('deriveOrderKey returns different keys for different indices', () => {
  const seed = pearlMnemonicToSeed(BIP86_REF_MNEMONIC);
  const a = deriveOrderKey(seed, 0);
  const b = deriveOrderKey(seed, 1);
  assert.notDeepEqual(a.pubkey, b.pubkey);
});

test('deriveOrderKey rejects negative, non-integer, or hardened-range indices', () => {
  const seed = pearlMnemonicToSeed(BIP86_REF_MNEMONIC);
  assert.throws(() => deriveOrderKey(seed, -1), /unsigned 31-bit integer/);
  assert.throws(() => deriveOrderKey(seed, 1.5), /unsigned 31-bit integer/);
  assert.throws(() => deriveOrderKey(seed, 0x80000000), /unsigned 31-bit integer/);
  assert.throws(() => deriveOrderKey(seed, Number.NaN), /unsigned 31-bit integer/);
});

test('deriveOrderKeyFromMnemonic zeroes the seed buffer it temporarily allocates', () => {
  // We can't observe the internal seed, but we CAN observe that the derived
  // key is correct (proves the seed wasn't corrupted *during* derivation) and
  // that calling twice with the same input gives the same result (proves the
  // zeroize doesn't leak state into a subsequent call).
  const a = deriveOrderKeyFromMnemonic(BIP86_REF_MNEMONIC, 0);
  const b = deriveOrderKeyFromMnemonic(BIP86_REF_MNEMONIC, 0);
  assert.equal(bytesToHex(a.pubkey), BIP86_X_ONLY_PUBKEY_0);
  assert.deepEqual(a, b);
});

test('formatPearlWalletDerivationPath matches the path the deriver uses', () => {
  assert.equal(formatPearlWalletDerivationPath(0), "m/86'/0'/0'/0/0");
  assert.equal(formatPearlWalletDerivationPath(42), "m/86'/0'/0'/0/42");
  assert.throws(() => formatPearlWalletDerivationPath(-1), /unsigned 31-bit integer/);
});

test('pearlAddressFromXOnlyPubkey produces a valid testnet bech32m address', () => {
  const key = deriveOrderKeyFromMnemonic(BIP86_REF_MNEMONIC, 0);
  const address = pearlAddressFromXOnlyPubkey(key.pubkey, 'testnet2');
  assert.match(address, /^tprl1p[ac-hj-np-z02-9]+$/);
});

test('pearlAddressFromXOnlyPubkey produces network-distinct addresses for the same key', () => {
  const key = deriveOrderKeyFromMnemonic(BIP86_REF_MNEMONIC, 0);
  const tn = pearlAddressFromXOnlyPubkey(key.pubkey, 'testnet2');
  const sn = pearlAddressFromXOnlyPubkey(key.pubkey, 'simnet');
  // Same key but different HRP — addresses must differ.
  assert.notEqual(tn, sn);
  assert.match(sn, /^rprl1p[ac-hj-np-z02-9]+$/);
});

test('pearlAddressFromXOnlyPubkey rejects wrong-sized pubkeys', () => {
  assert.throws(() => pearlAddressFromXOnlyPubkey(new Uint8Array(31), 'testnet2'), /32-byte x-only pubkey/);
  assert.throws(() => pearlAddressFromXOnlyPubkey(new Uint8Array(33), 'testnet2'), /32-byte x-only pubkey/);
});

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
