import assert from 'node:assert/strict';
import test from 'node:test';

import { BIP341_NUMS_INTERNAL_PUBKEY_HEX, createPearlP2trPayment } from '@kaspacom/pearl-script';
import { Transaction } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';

import { createPearlEscrowPackage, createPearlEscrowUnsignedTx, createPearlMultisigEscrowPackage } from '../dist/index.js';

const INTERNAL_PUBKEY = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const BUYER_TESTNET_ADDRESS = 'tprl1pet7ep3czdu9k4wvdlz2fp5p8x2yp7t6ttyqg2c6cmh0lgeuu9lasga5cef';
const SELLER_TESTNET_REFUND_ADDRESS = 'tprl1pgxxyvcmdncdxs06cudd5yvmwwahaesaj6n3eu7st7x4sw9hrchaqpcq7p3';

test('creates a deterministic testnet2 P2TR escrow package', () => {
  const escrow = createPearlEscrowPackage({
    tradeId: 'trade-1',
    network: 'testnet2',
    internalPubkey: INTERNAL_PUBKEY,
    expectedAmountGrains: '100000000000',
    requiredConfirmations: 6,
    releaseAddress: BUYER_TESTNET_ADDRESS,
    refundAddress: SELLER_TESTNET_REFUND_ADDRESS,
    refundEligibleAfterHeight: 120,
    createdAt: '2026-05-17T15:00:00.000Z',
  });

  assert.equal(escrow.tradeId, 'trade-1');
  assert.equal(escrow.network, 'testnet2');
  assert.equal(escrow.escrowScriptType, 'p2tr');
  assert.match(escrow.escrowAddress, /^tprl1p/);
  assert.equal(escrow.expectedAmountGrains, '100000000000');
  assert.equal(escrow.keys.internalPubkeyHex, INTERNAL_PUBKEY);
  assert.match(escrow.keys.taprootOutputScriptHex, /^5120[0-9a-f]{64}$/);
  assert.equal(escrow.releaseTemplate.outputs[0].address, BUYER_TESTNET_ADDRESS);
  assert.equal(escrow.releaseTemplate.outputs[0].role, 'buyer');
  assert.equal(escrow.refundTemplate.outputs[0].address, SELLER_TESTNET_REFUND_ADDRESS);
  assert.equal(escrow.refundTemplate.outputs[0].role, 'refund');
  assert.equal(escrow.refundTemplate.lockTime, 120);
  assert.equal(escrow.verification.simnetVerified, false);
});

test('blocks mainnet escrow package creation unless explicitly allowed', () => {
  assert.throws(
    () =>
      createPearlEscrowPackage({
        tradeId: 'trade-mainnet',
        network: 'mainnet',
        internalPubkey: INTERNAL_PUBKEY,
        expectedAmountGrains: '100000000000',
        requiredConfirmations: 6,
        releaseAddress: 'prl1psayn40fkp3f3szxztahxwszhyjfxe3u9tqxycujd6q2zcw4uc99sm7r4na',
        refundAddress: 'prl1pvdtcl546a64kk9p06nc75vrwlqfrl3m9myhl07wd69zvfma6fq3q9aduze',
      }),
    /mainnet Pearl escrow package creation is disabled/,
  );
});

test('rejects release/refund addresses from the wrong network', () => {
  assert.throws(
    () =>
      createPearlEscrowPackage({
        tradeId: 'trade-bad-network',
        network: 'testnet2',
        internalPubkey: INTERNAL_PUBKEY,
        expectedAmountGrains: '100000000000',
        requiredConfirmations: 6,
        releaseAddress: 'prl1psayn40fkp3f3szxztahxwszhyjfxe3u9tqxycujd6q2zcw4uc99sm7r4na',
        refundAddress: SELLER_TESTNET_REFUND_ADDRESS,
      }),
    /releaseAddress network mismatch/,
  );
});

test('rejects invalid amount and confirmation inputs', () => {
  assert.throws(
    () =>
      createPearlEscrowPackage({
        tradeId: 'trade-bad-amount',
        network: 'testnet2',
        internalPubkey: INTERNAL_PUBKEY,
        expectedAmountGrains: '0',
        requiredConfirmations: 6,
        releaseAddress: BUYER_TESTNET_ADDRESS,
        refundAddress: SELLER_TESTNET_REFUND_ADDRESS,
      }),
    /expectedAmountGrains must be a positive integer string/,
  );
});

test('creates a simnet 2-of-3 multisig P2TR escrow package', () => {
  const buyerAddress = createSimnetAddress('05');
  const sellerRefundAddress = createSimnetAddress('06');
  const escrow = createPearlMultisigEscrowPackage({
    tradeId: 'trade-multisig-simnet',
    network: 'simnet',
    buyerPubkey: xOnlyPublicKey('02'),
    sellerPubkey: xOnlyPublicKey('03'),
    arbiterPubkey: xOnlyPublicKey('04'),
    expectedAmountGrains: '250000000',
    requiredConfirmations: 2,
    releaseAddress: buyerAddress,
    refundAddress: sellerRefundAddress,
    refundEligibleAfterHeight: 144,
    createdAt: '2026-05-19T16:00:00.000Z',
  });

  assert.equal(escrow.tradeId, 'trade-multisig-simnet');
  assert.equal(escrow.network, 'simnet');
  assert.match(escrow.escrowAddress, /^rprl1p/);
  assert.equal(escrow.keys.internalPubkeyHex, BIP341_NUMS_INTERNAL_PUBKEY_HEX);
  assert.equal(escrow.keys.internalKeyPolicy, 'bip341_nums_script_path_only');
  assert.equal(escrow.releaseTemplate.signingPolicy.path, 'taproot_script_path');
  assert.deepEqual(escrow.releaseTemplate.signingPolicy.requiredSigners, ['buyer', 'seller']);
  assert.deepEqual(escrow.releaseTemplate.signingPolicy.alternativeSignerSets, [
    ['buyer', 'arbiter'],
    ['seller', 'arbiter'],
  ]);
  assert.equal(escrow.refundTemplate.signingPolicy.path, 'taproot_script_path');
  assert.deepEqual(escrow.refundTemplate.signingPolicy.requiredSigners, ['seller']);
  assert.equal(escrow.refundTemplate.lockTime, 144);
  assert.equal(escrow.keys.signerPubkeys.buyer, xOnlyPublicKey('02'));
  assert.equal(escrow.keys.signerPubkeys.seller, xOnlyPublicKey('03'));
  assert.equal(escrow.keys.signerPubkeys.arbiter, xOnlyPublicKey('04'));
  assert.deepEqual(escrow.keys.taprootScriptLeaves?.map((leaf) => leaf.kind), [
    'buyer_seller_release',
    'buyer_arbiter_release',
    'seller_arbiter_release',
    'seller_timeout_refund',
  ]);
  assert.equal(escrow.keys.taprootScriptLeaves?.[0]?.leafVersion, 0xc0);
  assert.match(escrow.keys.taprootScriptLeaves?.[0]?.controlBlockHex ?? '', /^[0-9a-f]+$/);
  assert.equal(escrow.keys.taprootScriptLeaves?.[3]?.lockTime, 144);
});

test('rejects duplicate multisig escrow role keys', () => {
  assert.throws(
    () =>
      createPearlMultisigEscrowPackage({
        tradeId: 'trade-duplicate-multisig',
        network: 'simnet',
        buyerPubkey: xOnlyPublicKey('02'),
        sellerPubkey: xOnlyPublicKey('02'),
        arbiterPubkey: xOnlyPublicKey('04'),
        expectedAmountGrains: '250000000',
        requiredConfirmations: 2,
        releaseAddress: createSimnetAddress('05'),
        refundAddress: createSimnetAddress('06'),
        refundEligibleAfterHeight: 144,
      }),
    /must be distinct/,
  );
});

test('creates multisig refund unsigned tx with CLTV locktime and non-final sequence', () => {
  const escrow = createPearlMultisigEscrowPackage({
    tradeId: 'trade-multisig-refund-tx',
    network: 'simnet',
    buyerPubkey: xOnlyPublicKey('02'),
    sellerPubkey: xOnlyPublicKey('03'),
    arbiterPubkey: xOnlyPublicKey('04'),
    expectedAmountGrains: '250000000',
    requiredConfirmations: 2,
    releaseAddress: createSimnetAddress('05'),
    refundAddress: createSimnetAddress('06'),
    fundingOutpoint: `${'11'.repeat(32)}:0`,
    refundEligibleAfterHeight: 144,
  });
  const tx = createPearlEscrowUnsignedTx({
    escrow,
    kind: 'refund',
    feeGrains: '1000',
  });
  const parsed = Transaction.fromHex(tx.unsignedTxHex);

  assert.equal(tx.lockTime, 144);
  assert.equal(parsed.locktime, 144);
  assert.equal(parsed.ins[0].sequence, Transaction.DEFAULT_SEQUENCE - 1);
});

function createSimnetAddress(seed: string): string {
  return createPearlP2trPayment({
    network: 'simnet',
    internalPubkey: xOnlyPublicKey(seed),
  }).address;
}

function xOnlyPublicKey(seed: string): string {
  const privateKey = Buffer.from(seed.padStart(64, '0'), 'hex');
  const publicKey = ecc.pointFromScalar(privateKey, true);
  if (!publicKey) throw new Error(`invalid private key fixture: ${seed}`);
  return Buffer.from(publicKey).subarray(1).toString('hex');
}
