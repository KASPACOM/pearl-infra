import assert from 'node:assert/strict';
import test from 'node:test';

import * as bip341 from 'bitcoinjs-lib/src/payments/bip341.js';
import * as ecc from 'tiny-secp256k1';

import { BIP341_NUMS_INTERNAL_PUBKEY_HEX, createPearlP2trPrefundEscrowPayment } from '../dist/index.js';

const MAKER = xOnlyPublicKey('02');
const OPERATOR = xOnlyPublicKey('03');
const ARBITER = xOnlyPublicKey('04');

test('creates a deterministic Mode A (auto_sweep) prefund escrow payment', () => {
  const payment = createPearlP2trPrefundEscrowPayment({
    network: 'simnet',
    mode: 'auto_sweep',
    makerPubkey: MAKER,
    operatorPubkey: OPERATOR,
    arbiterPubkey: ARBITER,
    refundLockTime: 1_800_000_000,
  });

  assert.equal(payment.mode, 'auto_sweep');
  assert.match(payment.address, /^rprl1p/);
  assert.match(payment.outputScriptHex, /^5120[0-9a-f]{64}$/);
  assert.equal(payment.internalPubkeyHex, BIP341_NUMS_INTERNAL_PUBKEY_HEX);
  assert.equal(payment.internalKeyPolicy, 'bip341_nums_script_path_only');
  assert.equal(payment.leaves.length, 2);
  assert.deepEqual(payment.leaves.map((leaf) => leaf.kind), [
    'operator_arbiter_sweep',
    'maker_timeout_refund',
  ]);
  assert.deepEqual(payment.leaves[0].requiredSigners, ['operator', 'arbiter']);
  assert.deepEqual(payment.leaves[1].requiredSigners, ['maker']);
  assert.equal(payment.leaves[1].lockTime, 1_800_000_000);
  verifyControlBlocks(payment);
});

test('creates a deterministic Mode B (manual_confirm) prefund escrow payment', () => {
  const payment = createPearlP2trPrefundEscrowPayment({
    network: 'simnet',
    mode: 'manual_confirm',
    makerPubkey: MAKER,
    operatorPubkey: OPERATOR,
    refundLockTime: 1_800_000_000,
  });

  assert.equal(payment.mode, 'manual_confirm');
  assert.equal(payment.leaves.length, 2);
  assert.deepEqual(payment.leaves.map((leaf) => leaf.kind), [
    'maker_operator_sweep',
    'maker_timeout_refund',
  ]);
  assert.deepEqual(payment.leaves[0].requiredSigners, ['maker', 'operator']);
  assert.deepEqual(payment.leaves[1].requiredSigners, ['maker']);
  verifyControlBlocks(payment);
});

test('Mode A and Mode B produce different escrow addresses for identical maker/operator', () => {
  const a = createPearlP2trPrefundEscrowPayment({
    network: 'simnet',
    mode: 'auto_sweep',
    makerPubkey: MAKER,
    operatorPubkey: OPERATOR,
    arbiterPubkey: ARBITER,
    refundLockTime: 1_800_000_000,
  });
  const b = createPearlP2trPrefundEscrowPayment({
    network: 'simnet',
    mode: 'manual_confirm',
    makerPubkey: MAKER,
    operatorPubkey: OPERATOR,
    refundLockTime: 1_800_000_000,
  });
  assert.notEqual(a.address, b.address);
  assert.notEqual(a.outputScriptHex, b.outputScriptHex);
});

test('requires arbiterPubkey for auto_sweep mode', () => {
  assert.throws(
    () =>
      createPearlP2trPrefundEscrowPayment({
        network: 'simnet',
        mode: 'auto_sweep',
        makerPubkey: MAKER,
        operatorPubkey: OPERATOR,
        refundLockTime: 1_800_000_000,
      }),
    /arbiterPubkey is required for auto_sweep/,
  );
});

test('forbids arbiterPubkey for manual_confirm mode', () => {
  assert.throws(
    () =>
      createPearlP2trPrefundEscrowPayment({
        network: 'simnet',
        mode: 'manual_confirm',
        makerPubkey: MAKER,
        operatorPubkey: OPERATOR,
        arbiterPubkey: ARBITER,
        refundLockTime: 1_800_000_000,
      }),
    /must not be provided for manual_confirm/,
  );
});

test('rejects positive non-integer or zero refundLockTime', () => {
  for (const refundLockTime of [0, -1, 1.5, Number.NaN]) {
    assert.throws(
      () =>
        createPearlP2trPrefundEscrowPayment({
          network: 'simnet',
          mode: 'auto_sweep',
          makerPubkey: MAKER,
          operatorPubkey: OPERATOR,
          arbiterPubkey: ARBITER,
          refundLockTime,
        }),
      /refundLockTime must be a positive integer/,
      `refundLockTime ${refundLockTime} should be rejected`,
    );
  }
});

test('rejects duplicate signer pubkeys across roles', () => {
  assert.throws(
    () =>
      createPearlP2trPrefundEscrowPayment({
        network: 'simnet',
        mode: 'auto_sweep',
        makerPubkey: MAKER,
        operatorPubkey: MAKER,
        arbiterPubkey: ARBITER,
        refundLockTime: 1_800_000_000,
      }),
    /must be distinct/,
  );
  assert.throws(
    () =>
      createPearlP2trPrefundEscrowPayment({
        network: 'simnet',
        mode: 'auto_sweep',
        makerPubkey: MAKER,
        operatorPubkey: OPERATOR,
        arbiterPubkey: OPERATOR,
        refundLockTime: 1_800_000_000,
      }),
    /must be distinct/,
  );
});

test('scriptNonceHex changes the address (commitment binding to a unique order)', () => {
  const a = createPearlP2trPrefundEscrowPayment({
    network: 'simnet',
    mode: 'auto_sweep',
    makerPubkey: MAKER,
    operatorPubkey: OPERATOR,
    arbiterPubkey: ARBITER,
    refundLockTime: 1_800_000_000,
    scriptNonceHex: 'ab'.repeat(16),
  });
  const b = createPearlP2trPrefundEscrowPayment({
    network: 'simnet',
    mode: 'auto_sweep',
    makerPubkey: MAKER,
    operatorPubkey: OPERATOR,
    arbiterPubkey: ARBITER,
    refundLockTime: 1_800_000_000,
    scriptNonceHex: 'cd'.repeat(16),
  });
  assert.notEqual(a.address, b.address);
});

function verifyControlBlocks(payment: ReturnType<typeof createPearlP2trPrefundEscrowPayment>): void {
  for (const leaf of payment.leaves) {
    assert.match(leaf.scriptHex, /^[0-9a-f]+$/);
    assert.equal(leaf.leafVersion, 0xc0);
    assert.match(leaf.controlBlockHex, /^[0-9a-f]+$/);
    assert.equal((leaf.controlBlockHex.length / 2 - 33) % 32, 0);
    const controlBlock = Buffer.from(leaf.controlBlockHex, 'hex');
    assert.equal(controlBlock.subarray(1, 33).toString('hex'), payment.internalPubkeyHex);
    const leafHash = bip341.tapleafHash({
      output: Buffer.from(leaf.scriptHex, 'hex'),
      version: leaf.leafVersion,
    });
    const rootHash = bip341.rootHashFromPath(controlBlock, leafHash);
    const tweaked = bip341.tweakKey(Buffer.from(payment.internalPubkeyHex, 'hex'), rootHash);
    assert.equal(`5120${tweaked?.x.toString('hex')}`, payment.outputScriptHex);
    assert.equal(controlBlock[0] & 1, tweaked?.parity);
  }
}

function xOnlyPublicKey(seed: string): string {
  const privateKey = Buffer.from(seed.padStart(64, '0'), 'hex');
  const publicKey = ecc.pointFromScalar(privateKey, true);
  if (!publicKey) throw new Error(`invalid private key fixture: ${seed}`);
  return Buffer.from(publicKey).subarray(1).toString('hex');
}
