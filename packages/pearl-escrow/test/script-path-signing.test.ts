import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

import { initEccLib, Transaction } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';

import { createPearlP2trPayment } from '@kaspacom/pearl-script';

import {
  buildPartialPearlEscrowScriptPathPsbt,
  combinePearlEscrowScriptPathPsbt,
  createPearlEscrowScriptPathSpendTx,
  createPearlMultisigEscrowPackage,
  createScriptPathSigner,
  selectMultisigLeaf,
  type PearlEscrowPackage,
} from '../dist/index.js';

initEccLib(ecc);

interface RoleKey {
  privateKey: Buffer;
  xOnlyPubkeyHex: string;
}

function randomRoleKey(): RoleKey {
  let privateKey: Buffer;
  do {
    privateKey = randomBytes(32);
  } while (!ecc.isPrivate(privateKey));
  const pubkey = Buffer.from(ecc.pointFromScalar(privateKey, true)!);
  return { privateKey, xOnlyPubkeyHex: pubkey.subarray(1).toString('hex') };
}

function randomP2trAddress(): string {
  return createPearlP2trPayment({
    network: 'simnet',
    internalPubkey: randomRoleKey().xOnlyPubkeyHex,
  }).address;
}

interface RoleKeys {
  buyer: RoleKey;
  seller: RoleKey;
  arbiter: RoleKey;
}

function buildEscrow(
  keys: RoleKeys,
  releaseAddress: string,
  refundAddress: string,
  refundLockTime: number,
  amountGrains: number,
): PearlEscrowPackage {
  return createPearlMultisigEscrowPackage({
    tradeId: 'test-script-path-signing',
    network: 'simnet',
    buyerPubkey: keys.buyer.xOnlyPubkeyHex,
    sellerPubkey: keys.seller.xOnlyPubkeyHex,
    arbiterPubkey: keys.arbiter.xOnlyPubkeyHex,
    refundEligibleAfterHeight: refundLockTime,
    expectedAmountGrains: String(amountGrains),
    requiredConfirmations: 1,
    releaseAddress,
    refundAddress,
    createdAt: new Date('2026-05-28T00:00:00.000Z').toISOString(),
  });
}

test('selectMultisigLeaf returns leaf with control block for every multisig leaf kind', () => {
  const keys: RoleKeys = {
    buyer: randomRoleKey(),
    seller: randomRoleKey(),
    arbiter: randomRoleKey(),
  };
  const escrow = buildEscrow(keys, randomP2trAddress(), randomP2trAddress(), 500_000, 200_000_000);
  for (const kind of ['buyer_seller_release', 'buyer_arbiter_release', 'seller_arbiter_release', 'seller_timeout_refund'] as const) {
    const leaf = selectMultisigLeaf(escrow, kind);
    assert.equal(leaf.kind, kind);
    assert.ok(leaf.scriptHex && leaf.scriptHex.length > 0);
    assert.ok(leaf.controlBlockHex && leaf.controlBlockHex.length > 0);
    assert.equal(leaf.leafVersion, 0xc0);
  }
});

test('createPearlEscrowScriptPathSpendTx builds a valid 2-of-2 buyer+arbiter release tx', () => {
  const keys: RoleKeys = {
    buyer: randomRoleKey(),
    seller: randomRoleKey(),
    arbiter: randomRoleKey(),
  };
  const releaseAddress = randomP2trAddress();
  const refundAddress = randomP2trAddress();
  const amount = 200_000_000;
  const escrow = buildEscrow(keys, releaseAddress, refundAddress, 500_000, amount);
  const signedHex = createPearlEscrowScriptPathSpendTx({
    escrow,
    leafKind: 'buyer_arbiter_release',
    fundingTxid: 'ab'.repeat(32),
    vout: 0,
    amountGrains: amount,
    destinationAddress: releaseAddress,
    destinationAmountGrains: amount - 10_000,
    signers: [
      createScriptPathSigner(keys.buyer.privateKey),
      createScriptPathSigner(keys.arbiter.privateKey),
    ],
  });
  const tx = Transaction.fromHex(signedHex);
  assert.equal(tx.ins.length, 1);
  assert.equal(tx.outs.length, 1);
  const witness = tx.ins[0]!.witness;
  // [arbiterSig, buyerSig, script, controlBlock]
  assert.equal(witness.length, 4);
  assert.equal(witness[0]!.length, 64, 'arbiter Schnorr sig should be 64 bytes (SIGHASH_DEFAULT)');
  assert.equal(witness[1]!.length, 64, 'buyer Schnorr sig should be 64 bytes (SIGHASH_DEFAULT)');
  assert.equal(witness[2]!.toString('hex'), selectMultisigLeaf(escrow, 'buyer_arbiter_release').scriptHex);
  assert.equal(witness[3]!.toString('hex'), selectMultisigLeaf(escrow, 'buyer_arbiter_release').controlBlockHex);
});

test('createPearlEscrowScriptPathSpendTx supports the seller_timeout_refund leaf with lockTime', () => {
  const keys: RoleKeys = {
    buyer: randomRoleKey(),
    seller: randomRoleKey(),
    arbiter: randomRoleKey(),
  };
  const refundAddress = randomP2trAddress();
  const amount = 150_000_000;
  const lockTime = 1_000_000;
  const escrow = buildEscrow(keys, randomP2trAddress(), refundAddress, lockTime, amount);
  const signedHex = createPearlEscrowScriptPathSpendTx({
    escrow,
    leafKind: 'seller_timeout_refund',
    fundingTxid: 'cd'.repeat(32),
    vout: 1,
    amountGrains: amount,
    destinationAddress: refundAddress,
    destinationAmountGrains: amount - 10_000,
    signers: [createScriptPathSigner(keys.seller.privateKey)],
    lockTime,
    sequence: 0xfffffffe,
  });
  const tx = Transaction.fromHex(signedHex);
  assert.equal(tx.locktime, lockTime);
  assert.equal(tx.ins[0]!.sequence, 0xfffffffe);
  const witness = tx.ins[0]!.witness;
  // [sellerSig, script, controlBlock]
  assert.equal(witness.length, 3);
  assert.equal(witness[0]!.length, 64);
});

test('buyer pre-signs PSBT, worker combines arbiter sig and finalizes (preauthorized release flow)', () => {
  const keys: RoleKeys = {
    buyer: randomRoleKey(),
    seller: randomRoleKey(),
    arbiter: randomRoleKey(),
  };
  const releaseAddress = randomP2trAddress();
  const amount = 175_000_000;
  const escrow = buildEscrow(keys, releaseAddress, randomP2trAddress(), 800_000, amount);
  const fundingTxid = 'ef'.repeat(32);

  // Phase 1 — buyer's browser builds the PSBT and signs with the buyer key only.
  const buyerPartial = buildPartialPearlEscrowScriptPathPsbt({
    escrow,
    leafKind: 'buyer_arbiter_release',
    fundingTxid,
    vout: 0,
    amountGrains: amount,
    destinationAddress: releaseAddress,
    destinationAmountGrains: amount - 10_000,
    signers: [createScriptPathSigner(keys.buyer.privateKey)],
  });
  assert.deepEqual(buyerPartial.signedRoles, ['buyer']);
  assert.ok(buyerPartial.psbtBase64.length > 0);

  // Phase 2 — settlement worker takes the buyer-presigned PSBT and adds the arbiter sig.
  const finalized = combinePearlEscrowScriptPathPsbt({
    psbtBase64: buyerPartial.psbtBase64,
    network: 'simnet',
    signers: [createScriptPathSigner(keys.arbiter.privateKey)],
  });
  const tx = Transaction.fromHex(finalized.signedTxHex);
  const witness = tx.ins[0]!.witness;
  // [arbiterSig, buyerSig, script, controlBlock]
  assert.equal(witness.length, 4);
  assert.equal(finalized.signedTxid, tx.getId());
});

test('combinePearlEscrowScriptPathPsbt fails closed when only one signer is present', () => {
  const keys: RoleKeys = {
    buyer: randomRoleKey(),
    seller: randomRoleKey(),
    arbiter: randomRoleKey(),
  };
  const escrow = buildEscrow(keys, randomP2trAddress(), randomP2trAddress(), 800_000, 175_000_000);
  const partial = buildPartialPearlEscrowScriptPathPsbt({
    escrow,
    leafKind: 'buyer_arbiter_release',
    fundingTxid: 'ef'.repeat(32),
    vout: 0,
    amountGrains: 175_000_000,
    destinationAddress: randomP2trAddress(),
    destinationAmountGrains: 175_000_000 - 10_000,
    signers: [createScriptPathSigner(keys.buyer.privateKey)],
  });
  assert.throws(
    () => combinePearlEscrowScriptPathPsbt({ psbtBase64: partial.psbtBase64, network: 'simnet' }),
    /1 signatures but the leaf script requires 2/i,
  );
});

test('createPearlEscrowScriptPathSpendTx rejects a leaf kind absent from the escrow', () => {
  const keys: RoleKeys = {
    buyer: randomRoleKey(),
    seller: randomRoleKey(),
    arbiter: randomRoleKey(),
  };
  const escrow = buildEscrow(keys, randomP2trAddress(), randomP2trAddress(), 500_000, 100_000_000);
  // Strip leaves to force selectMultisigLeaf to fail.
  const tampered: PearlEscrowPackage = { ...escrow, keys: { ...escrow.keys, taprootScriptLeaves: [] } };
  assert.throws(() => {
    createPearlEscrowScriptPathSpendTx({
      escrow: tampered,
      leafKind: 'buyer_arbiter_release',
      fundingTxid: 'aa'.repeat(32),
      vout: 0,
      amountGrains: 100_000_000,
      destinationAddress: randomP2trAddress(),
      destinationAmountGrains: 99_990_000,
      signers: [
        createScriptPathSigner(keys.buyer.privateKey),
        createScriptPathSigner(keys.arbiter.privateKey),
      ],
    });
  }, /leaf metadata is missing/i);
});
