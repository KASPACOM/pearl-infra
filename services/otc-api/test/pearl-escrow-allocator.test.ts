import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { getPearlScriptNetwork } from '@kaspacom/pearl-script';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';

import {
  createConfiguredPearlEscrowAllocator,
  createConfiguredPearlPrefundEscrowAllocator,
  deriveTradeIndex,
  MultisigPearlPrefundEscrowAllocator,
} from '../src/pearl-escrow-allocator.ts';
import { InMemoryOtcRepository } from '../src/repository.ts';
import type { OtcApiConfig } from '../src/types.ts';
import type { PearlEscrowAllocator } from '../src/trade-service.ts';

const bip32 = BIP32Factory(ecc);
const BUYER_TESTNET_ADDRESS = 'tprl1pet7ep3czdu9k4wvdlz2fp5p8x2yp7t6ttyqg2c6cmh0lgeuu9lasga5cef';
const SELLER_TESTNET_REFUND_ADDRESS = 'tprl1pgxxyvcmdncdxs06cudd5yvmwwahaesaj6n3eu7st7x4sw9hrchaqpcq7p3';

const config: OtcApiConfig = {
  pearlNetwork: 'testnet2',
  pearlEscrowAllocator: 'p2tr_xpub',
  pearlEscrowXpub: bip32
    .fromSeed(Buffer.alloc(32, 7), getPearlScriptNetwork('testnet2'))
    .neutered()
    .toBase58(),
  pearlEscrowDerivationPrefix: '0',
  allowMainnetPearlEscrow: false,
  quoteTtlMs: 5 * 60 * 1000,
  pearlFundingTtlMs: 10 * 60 * 1000,
  usdcDepositTtlMs: 15 * 60 * 1000,
  settlementTtlMs: 30 * 60 * 1000,
  priceUsdcPerPrl: '0.170000',
  feeBps: 100,
  pearlEscrowConfirmations: 3,
  baseEscrowContract: '0x1111111111111111111111111111111111111111',
  baseNetwork: 'base_sepolia',
  supportAlertRateLimitWindowMs: 10 * 60 * 1000,
  supportAlertRateLimitMax: 5,
};

test('derives a deterministic P2TR Pearl escrow from configured xpub', async () => {
  const repository = new InMemoryOtcRepository();
  const allocator = createConfiguredPearlEscrowAllocator(config, repository);
  const first = await allocator.allocateEscrow(createAllocationInput('trade-xpub-1'));
  const second = await allocator.allocateEscrow(createAllocationInput('trade-xpub-1'));

  assert.equal(first.address, second.address);
  assert.match(first.address, /^tprl1p/);
  assert.equal(first.expectedAmountGrains, '101000000000');
  assert.equal(first.requiredConfirmations, 3);
  assert.equal(first.escrowScriptType, 'p2tr');
  assert.match(first.internalPubkeyHex ?? '', /^[0-9a-f]{64}$/);
  assert.match(first.taprootOutputScriptHex ?? '', /^5120[0-9a-f]{64}$/);
  assert.match(first.derivationPath ?? '', /^m\/0\/\d+$/);
  assert.equal(first.refundEligibleAfterUnixTime, 1778933700);
  assert.equal(first.simnetVerified, false);
  const allocation = await repository.findPearlEscrowAllocationByTradeId('trade-xpub-1');
  assert.equal(allocation?.derivationPath, first.derivationPath);
  assert.equal(allocation?.escrowAddress, first.address);
});

test('requires an xpub when p2tr allocation is enabled', () => {
  assert.throws(
    () =>
      createConfiguredPearlEscrowAllocator({
        ...config,
        pearlEscrowXpub: undefined,
      }),
    /PEARL_ESCROW_XPUB is required/,
  );
});

test('allocates a 2-of-3 multisig Pearl escrow from request pubkeys and arbiter config', async () => {
  const allocator = createConfiguredPearlEscrowAllocator({
    ...config,
    pearlEscrowAllocator: 'p2tr_multisig',
    pearlEscrowXpub: undefined,
    pearlEscrowArbiterPubkey: xOnlyPublicKey('04'),
  });

  const allocated = await allocator.allocateEscrow({
    ...createAllocationInput('trade-multisig-allocator'),
    request: {
      ...createAllocationInput('trade-multisig-allocator').request,
      pearlEscrowMode: 'multisig',
      pearlReleaseSigningMode: 'preauthorize_release',
      buyerPearlPubkey: xOnlyPublicKey('02'),
      sellerPearlPubkey: xOnlyPublicKey('03'),
    },
  });

  assert.match(allocated.address, /^tprl1p/);
  assert.equal(allocated.internalKeyPolicy, 'bip341_nums_script_path_only');
  assert.equal(allocated.releaseTemplate?.signingPolicy.path, 'taproot_script_path');
  assert.deepEqual(allocated.releaseTemplate?.signingPolicy.requiredSigners, ['buyer', 'seller']);
  assert.deepEqual(allocated.releaseTemplate?.signingPolicy.alternativeSignerSets, [
    ['buyer', 'arbiter'],
    ['seller', 'arbiter'],
  ]);
  assert.equal(allocated.refundTemplate?.signingPolicy.requiredSigners[0], 'seller');
  assert.equal(allocated.signerPubkeys?.buyer, xOnlyPublicKey('02'));
  assert.equal(allocated.signerPubkeys?.seller, xOnlyPublicKey('03'));
  assert.equal(allocated.signerPubkeys?.arbiter, xOnlyPublicKey('04'));
  assert.match(allocated.scriptNonceHex ?? '', /^[0-9a-f]{64}$/);
});

test('requires user pubkeys for multisig Pearl escrow allocation', async () => {
  const allocator = createConfiguredPearlEscrowAllocator({
    ...config,
    pearlEscrowAllocator: 'p2tr_multisig',
    pearlEscrowXpub: undefined,
    pearlEscrowArbiterPubkey: xOnlyPublicKey('04'),
  });

  await assert.rejects(
    () => allocator.allocateEscrow(createAllocationInput('trade-multisig-missing-pubkeys')),
    /buyerPearlPubkey/,
  );
});

test('retries when a derived Pearl escrow index is already allocated', async () => {
  const repository = new InMemoryOtcRepository();
  const allocator = createConfiguredPearlEscrowAllocator(config, repository);
  const firstIndex = deriveTradeIndex('trade-xpub-collision');
  await repository.reservePearlEscrowAllocation({
    tradeId: 'trade-existing',
    allocatorKey: createTestAllocatorKey(),
    derivationPrefix: 'm/0',
    derivationIndex: firstIndex,
    derivationPath: `m/0/${firstIndex}`,
    escrowAddress: 'tprl1pexisting',
    internalPubkeyHex: '11'.repeat(32),
    taprootOutputScriptHex: `5120${'22'.repeat(32)}`,
  });

  const allocated = await allocator.allocateEscrow(createAllocationInput('trade-xpub-collision'));

  assert.match(allocated.derivationPath ?? '', /^m\/0\/\d+$/);
  assert.notEqual(allocated.derivationPath, `m/0/${firstIndex}`);
  assert.equal(
    (await repository.findPearlEscrowAllocationByTradeId('trade-xpub-collision'))?.derivationPath,
    allocated.derivationPath,
  );
});

function createAllocationInput(tradeId: string): Parameters<PearlEscrowAllocator['allocateEscrow']>[0] {
  return {
    tradeId,
    quote: {
      quoteId: 'quote-xpub-1',
      side: 'buy_prl',
      amountPrl: '1000.00000000',
      amountUsdc: '170.000000',
      feePrl: '10.00000000',
      feeUsdc: '1.700000',
      priceUsdcPerPrl: '0.170000',
      settlementAsset: 'USDC',
      settlementNetwork: 'base',
      expiresAt: '2026-05-16T12:05:00.000Z',
      status: 'active',
    },
    request: {
      buyerPearlAddress: BUYER_TESTNET_ADDRESS,
      buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
      sellerPearlRefundAddress: SELLER_TESTNET_REFUND_ADDRESS,
      sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
      clientRequestId: 'accept-xpub-1',
    },
    config,
    deadlines: {
      quoteExpiresAt: '2026-05-16T12:05:00.000Z',
      pearlFundingDeadline: '2026-05-16T12:10:00.000Z',
      usdcDepositDeadline: '2026-05-16T12:15:00.000Z',
      settlementDeadline: '2026-05-16T12:30:00.000Z',
      refundAvailableAt: '2026-05-16T12:15:00.000Z',
    },
  };
}

// ---------- Prefund (order-book) allocator ----------

const PREFUND_NOW = () => new Date('2026-05-28T20:00:00.000Z');
const EXPECTED_REFUND_UNIX = Math.floor(PREFUND_NOW().getTime() / 1000) + 24 * 3600;

function prefundConfig(overrides: Partial<OtcApiConfig> = {}): OtcApiConfig {
  return {
    ...config,
    pearlPrefundEnabled: true,
    pearlPrefundOperatorPubkey: xOnlyPublicKey('05'),
    pearlEscrowArbiterPubkey: xOnlyPublicKey('04'),
    pearlPrefundDerivationPrefix: '1',
    pearlPrefundRefundDelayHours: 24,
    ...overrides,
  };
}

test('createConfiguredPearlPrefundEscrowAllocator returns undefined when prefund disabled', () => {
  const repo = new InMemoryOtcRepository();
  const allocator = createConfiguredPearlPrefundEscrowAllocator({ ...config, pearlPrefundEnabled: false }, repo, PREFUND_NOW);
  assert.equal(allocator, undefined);
});

test('createConfiguredPearlPrefundEscrowAllocator throws if operator pubkey missing', () => {
  const repo = new InMemoryOtcRepository();
  assert.throws(
    () =>
      createConfiguredPearlPrefundEscrowAllocator(
        { ...prefundConfig(), pearlPrefundOperatorPubkey: undefined },
        repo,
        PREFUND_NOW,
      ),
    /PEARL_PREFUND_OPERATOR_PUBKEY is required/,
  );
});

test('createConfiguredPearlPrefundEscrowAllocator throws if arbiter pubkey missing', () => {
  const repo = new InMemoryOtcRepository();
  assert.throws(
    () =>
      createConfiguredPearlPrefundEscrowAllocator(
        { ...prefundConfig(), pearlEscrowArbiterPubkey: undefined },
        repo,
        PREFUND_NOW,
      ),
    /PEARL_ESCROW_ARBITER_PUBKEY is required/,
  );
});

test('Mode A prefund: allocates 2-leaf Taproot escrow with operator+arbiter sweep and CLTV refund', async () => {
  const repo = new InMemoryOtcRepository();
  const allocator = new MultisigPearlPrefundEscrowAllocator(prefundConfig(), repo, PREFUND_NOW);
  const out = await allocator.allocatePrefundEscrow({
    orderId: 'order-prefund-auto-1',
    mode: 'auto_sweep',
    makerPearlPubkey: xOnlyPublicKey('02'),
    amountPrl: '1000.00000000',
  });
  assert.match(out.escrowAddress, /^tprl1p/);
  assert.equal(out.mode, 'auto_sweep');
  assert.equal(out.expectedAmountGrains, '100000000000');
  assert.equal(out.requiredConfirmations, 3);
  assert.equal(out.refundEligibleAfterUnixTime, EXPECTED_REFUND_UNIX);
  const persisted = await repo.findOrderPrefundAllocationByOrderId('order-prefund-auto-1');
  assert.equal(persisted?.escrowAddress, out.escrowAddress);
  assert.equal(persisted?.scriptLeaves.length, 2);
  assert.equal(persisted?.scriptLeaves[0].kind, 'operator_arbiter_sweep');
  assert.equal(persisted?.scriptLeaves[1].kind, 'maker_timeout_refund');
  assert.equal(persisted?.signerPubkeys.arbiter, xOnlyPublicKey('04'));
});

test('Mode B prefund: allocates 2-leaf Taproot escrow with maker+operator sweep and CLTV refund', async () => {
  const repo = new InMemoryOtcRepository();
  const allocator = new MultisigPearlPrefundEscrowAllocator(prefundConfig(), repo, PREFUND_NOW);
  const out = await allocator.allocatePrefundEscrow({
    orderId: 'order-prefund-manual-1',
    mode: 'manual_confirm',
    makerPearlPubkey: xOnlyPublicKey('02'),
    amountPrl: '500.00000000',
  });
  assert.match(out.escrowAddress, /^tprl1p/);
  assert.equal(out.mode, 'manual_confirm');
  const persisted = await repo.findOrderPrefundAllocationByOrderId('order-prefund-manual-1');
  assert.equal(persisted?.scriptLeaves[0].kind, 'maker_operator_sweep');
  assert.equal(persisted?.scriptLeaves[1].kind, 'maker_timeout_refund');
  // Mode B does NOT include arbiter — see C0 design.
  assert.equal(persisted?.signerPubkeys.arbiter, undefined);
});

test('Mode A and Mode B prefund produce different addresses for the same maker', async () => {
  const repo = new InMemoryOtcRepository();
  const allocator = new MultisigPearlPrefundEscrowAllocator(prefundConfig(), repo, PREFUND_NOW);
  const a = await allocator.allocatePrefundEscrow({
    orderId: 'order-A',
    mode: 'auto_sweep',
    makerPearlPubkey: xOnlyPublicKey('02'),
    amountPrl: '100.00000000',
  });
  const b = await allocator.allocatePrefundEscrow({
    orderId: 'order-B',
    mode: 'manual_confirm',
    makerPearlPubkey: xOnlyPublicKey('02'),
    amountPrl: '100.00000000',
  });
  assert.notEqual(a.escrowAddress, b.escrowAddress);
});

test('prefund allocator is idempotent on retry (same orderId returns same allocation)', async () => {
  const repo = new InMemoryOtcRepository();
  const allocator = new MultisigPearlPrefundEscrowAllocator(prefundConfig(), repo, PREFUND_NOW);
  const first = await allocator.allocatePrefundEscrow({
    orderId: 'order-idem',
    mode: 'auto_sweep',
    makerPearlPubkey: xOnlyPublicKey('02'),
    amountPrl: '50.00000000',
  });
  const second = await allocator.allocatePrefundEscrow({
    orderId: 'order-idem',
    mode: 'auto_sweep',
    makerPearlPubkey: xOnlyPublicKey('02'),
    amountPrl: '50.00000000',
  });
  assert.equal(first.escrowAddress, second.escrowAddress);
  assert.equal(first.refundEligibleAfterUnixTime, second.refundEligibleAfterUnixTime);
});

function createTestAllocatorKey(): string {
  const xpub = config.pearlEscrowXpub;
  assert.ok(xpub);
  return `p2tr_xpub:${config.pearlNetwork}:${createHash('sha256').update(xpub).digest('hex')}`;
}

function xOnlyPublicKey(seed: string): string {
  const privateKey = Buffer.from(seed.padStart(64, '0'), 'hex');
  const publicKey = ecc.pointFromScalar(privateKey, true);
  if (!publicKey) throw new Error(`invalid private key fixture: ${seed}`);
  return Buffer.from(publicKey).subarray(1).toString('hex');
}
