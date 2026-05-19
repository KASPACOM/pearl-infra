import assert from 'node:assert/strict';
import test from 'node:test';

import * as ecc from 'tiny-secp256k1';

import { BIP341_NUMS_INTERNAL_PUBKEY_HEX, createPearlP2trMultisigEscrowPayment } from '../dist/index.js';

test('creates a deterministic simnet 2-of-3 Taproot escrow payment', () => {
  const payment = createPearlP2trMultisigEscrowPayment({
    network: 'simnet',
    buyerPubkey: xOnlyPublicKey('02'),
    sellerPubkey: xOnlyPublicKey('03'),
    arbiterPubkey: xOnlyPublicKey('04'),
    refundLockTime: 144,
  });

  assert.match(payment.address, /^rprl1p/);
  assert.match(payment.outputScriptHex, /^5120[0-9a-f]{64}$/);
  assert.equal(payment.internalPubkeyHex, BIP341_NUMS_INTERNAL_PUBKEY_HEX);
  assert.equal(payment.internalKeyPolicy, 'bip341_nums_script_path_only');
  assert.equal(payment.leaves.length, 4);
  assert.deepEqual(payment.leaves.map((leaf) => leaf.kind), [
    'buyer_seller_release',
    'buyer_arbiter_release',
    'seller_arbiter_release',
    'seller_timeout_refund',
  ]);
  assert.deepEqual(payment.leaves[0].requiredSigners, ['buyer', 'seller']);
  assert.deepEqual(payment.leaves[1].requiredSigners, ['buyer', 'arbiter']);
  assert.deepEqual(payment.leaves[2].requiredSigners, ['seller', 'arbiter']);
  assert.deepEqual(payment.leaves[3].requiredSigners, ['seller']);
  assert.equal(payment.leaves[3].lockTime, 144);
  for (const leaf of payment.leaves) {
    assert.match(leaf.scriptHex, /^[0-9a-f]+$/);
  }
});

test('requires a positive timeout for the seller refund leaf', () => {
  assert.throws(
    () =>
      createPearlP2trMultisigEscrowPayment({
        network: 'simnet',
        buyerPubkey: xOnlyPublicKey('02'),
        sellerPubkey: xOnlyPublicKey('03'),
        arbiterPubkey: xOnlyPublicKey('04'),
      }),
    /refundLockTime is required/,
  );
  assert.throws(
    () =>
      createPearlP2trMultisigEscrowPayment({
        network: 'simnet',
        buyerPubkey: xOnlyPublicKey('02'),
        sellerPubkey: xOnlyPublicKey('03'),
        arbiterPubkey: xOnlyPublicKey('04'),
        refundLockTime: 0,
      }),
    /refundLockTime must be a positive integer/,
  );
});

test('rejects caller-provided internal keys for multisig escrow', () => {
  assert.throws(
    () =>
      createPearlP2trMultisigEscrowPayment({
        network: 'simnet',
        internalPubkey: xOnlyPublicKey('01'),
        buyerPubkey: xOnlyPublicKey('02'),
        sellerPubkey: xOnlyPublicKey('03'),
        arbiterPubkey: xOnlyPublicKey('04'),
        refundLockTime: 144,
      } as any),
    /does not accept a spendable internalPubkey/,
  );
});

test('rejects invalid and duplicate multisig signer keys', () => {
  assert.throws(
    () =>
      createPearlP2trMultisigEscrowPayment({
        network: 'simnet',
        buyerPubkey: 'ff'.repeat(32),
        sellerPubkey: xOnlyPublicKey('03'),
        arbiterPubkey: xOnlyPublicKey('04'),
        refundLockTime: 144,
      }),
    /valid secp256k1 point/,
  );
  assert.throws(
    () =>
      createPearlP2trMultisigEscrowPayment({
        network: 'simnet',
        buyerPubkey: xOnlyPublicKey('02'),
        sellerPubkey: xOnlyPublicKey('02'),
        arbiterPubkey: xOnlyPublicKey('04'),
        refundLockTime: 144,
      }),
    /must be distinct/,
  );
});

function xOnlyPublicKey(seed: string): string {
  const privateKey = Buffer.from(seed.padStart(64, '0'), 'hex');
  const publicKey = ecc.pointFromScalar(privateKey, true);
  if (!publicKey) throw new Error(`invalid private key fixture: ${seed}`);
  return Buffer.from(publicKey).subarray(1).toString('hex');
}
