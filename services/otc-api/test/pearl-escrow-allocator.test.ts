import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { getPearlScriptNetwork } from '@kaspacom/pearl-script';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';

import { createConfiguredPearlEscrowAllocator, deriveTradeIndex } from '../src/pearl-escrow-allocator.ts';
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

function createTestAllocatorKey(): string {
  const xpub = config.pearlEscrowXpub;
  assert.ok(xpub);
  return `p2tr_xpub:${config.pearlNetwork}:${createHash('sha256').update(xpub).digest('hex')}`;
}
