import assert from 'node:assert/strict';
import test from 'node:test';

import { canTransitionTrade } from '@kaspacom/pearl-sdk';

import { InMemoryOtcRepository } from '../src/repository.ts';
import { OtcTradeService, type PearlEscrowAllocator } from '../src/trade-service.ts';
import type { OtcApiConfig } from '../src/types.ts';
import type { UsdcEscrowReader } from '../src/usdc-escrow-reader.ts';

const config: OtcApiConfig = {
  pearlNetwork: 'testnet2',
  quoteTtlMs: 5 * 60 * 1000,
  pearlFundingTtlMs: 10 * 60 * 1000,
  usdcDepositTtlMs: 15 * 60 * 1000,
  settlementTtlMs: 30 * 60 * 1000,
  priceUsdcPerPrl: '0.170000',
  feeBps: 100,
  pearlEscrowConfirmations: 3,
  baseEscrowContract: '0x1111111111111111111111111111111111111111',
  baseNetwork: 'base_sepolia',
};

const escrowAllocator: PearlEscrowAllocator = {
  allocateEscrow({ tradeId, config: allocatorConfig }) {
    return {
      network: allocatorConfig.pearlNetwork,
      address: `tprl1p${tradeId.slice(-12)}`,
      expectedAmountGrains: '100000000000',
      requiredConfirmations: allocatorConfig.pearlEscrowConfirmations,
      refundEligibleAfterHeight: 100,
    };
  },
};

function createService(now = new Date('2026-05-16T12:00:00.000Z')): OtcTradeService {
  return new OtcTradeService(new InMemoryOtcRepository(), config, escrowAllocator, () => now);
}

function createServiceWithUsdcReader(reader: UsdcEscrowReader, now = new Date('2026-05-16T12:00:00.000Z')): OtcTradeService {
  return new OtcTradeService(new InMemoryOtcRepository(), config, escrowAllocator, reader, () => now);
}

test('creates an idempotent Base USDC quote', async () => {
  const service = createService();
  const request = {
    side: 'buy_prl' as const,
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC' as const,
    settlementNetwork: 'base' as const,
    buyerPearlAddress: 'tprl1pbuyer',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-1',
  };

  const first = await service.createQuote(request);
  const second = await service.createQuote(request);

  assert.equal(first.quoteId, second.quoteId);
  assert.equal(first.amountUsdc, '170.000000');
  assert.equal(first.feeUsdc, '1.700000');
  assert.equal(first.settlementNetwork, 'base');
  assert.equal(first.expiresAt, '2026-05-16T12:05:00.000Z');
});

test('accepts a quote into pearl escrow pending state', async () => {
  const service = createService();
  const quote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: 'tprl1pbuyer',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-2',
  });

  const trade = await service.acceptQuote(quote.quoteId, {
    buyerPearlAddress: 'tprl1pbuyer',
    buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
    sellerPearlRefundAddress: 'tprl1psellerrefund',
    sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
    clientRequestId: 'accept-request-2',
  });

  assert.equal(trade.state, 'pearl_escrow_pending');
  assert.equal(trade.usdcEscrow.chainId, 84532);
  assert.equal(trade.usdcEscrow.contract, config.baseEscrowContract);
  assert.equal(trade.usdcEscrow.expectedAmountMicros, '171700000');
  assert.equal(trade.usdcEscrow.expiresAt, '2026-05-16T12:15:00.000Z');
  assert.equal(trade.pearlEscrow.requiredConfirmations, 3);
  assert.deepEqual(trade.deadlines, {
    quoteExpiresAt: quote.expiresAt,
    pearlFundingDeadline: '2026-05-16T12:10:00.000Z',
    usdcDepositDeadline: '2026-05-16T12:15:00.000Z',
    settlementDeadline: '2026-05-16T12:30:00.000Z',
    refundAvailableAt: '2026-05-16T12:15:00.000Z',
  });
  assert.match(trade.usdcEscrow.tradeKey, /^0x[0-9a-f]{64}$/);
});

test('rejects expired quotes', async () => {
  const repository = new InMemoryOtcRepository();
  const quoteService = new OtcTradeService(repository, config, escrowAllocator, () => new Date('2026-05-16T12:00:00.000Z'));
  const quote = await quoteService.createQuote({
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: 'tprl1pbuyer',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-3',
  });

  const acceptService = new OtcTradeService(repository, config, escrowAllocator, () => new Date('2026-05-16T12:06:00.000Z'));
  await assert.rejects(
    () =>
      acceptService.acceptQuote(quote.quoteId, {
        buyerPearlAddress: 'tprl1pbuyer',
        buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
        sellerPearlRefundAddress: 'tprl1psellerrefund',
        sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
        clientRequestId: 'accept-request-3',
      }),
    /quote expired/,
  );
});

test('prepares createTrade intent only after quote acceptance and records side effect idempotently', async () => {
  const service = createService();
  const quote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: 'tprl1pbuyer',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-create-intent',
  });

  const trade = await service.acceptQuote(quote.quoteId, {
    buyerPearlAddress: 'tprl1pbuyer',
    buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
    sellerPearlRefundAddress: 'tprl1psellerrefund',
    sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
    clientRequestId: 'accept-request-create-intent',
  });

  const first = await service.prepareUsdcCreateTrade(trade.tradeId, {
    idempotencyKey: 'create-trade-1',
    actor: 'settlement-worker',
  });
  const second = await service.prepareUsdcCreateTrade(trade.tradeId, {
    idempotencyKey: 'create-trade-1',
    actor: 'settlement-worker',
  });

  assert.equal(first.tradeKey, trade.usdcEscrow.tradeKey);
  assert.equal(first.buyer, trade.buyerUsdcAddress);
  assert.equal(first.seller, trade.sellerUsdcReceiveAddress);
  assert.equal(first.amountMicros, '170000000');
  assert.equal(first.feeMicros, '1700000');
  assert.equal(first.expiryUnixSeconds, 1778933700);
  assert.equal(first.sideEffect.effectType, 'usdc_create_trade');
  assert.equal(first.sideEffect.status, 'prepared');
  assert.equal(second.sideEffect.createdAt, first.sideEffect.createdAt);
  assert.equal((await service.listSideEffects(trade.tradeId)).length, 1);

  await assert.rejects(
    () =>
      service.prepareUsdcCreateTrade('missing-trade', {
        idempotencyKey: 'create-trade-missing',
        actor: 'settlement-worker',
      }),
    /trade not found/,
  );
});

test('verifies on-chain USDC escrow terms before allowing buyer deposit', async () => {
  const service = createServiceWithUsdcReader({
    async getTrade() {
      return {
        buyer: '0x3333333333333333333333333333333333333333',
        seller: '0x4444444444444444444444444444444444444444',
        amountMicros: '170000000',
        feeMicros: '1700000',
        expiryUnixSeconds: 1778933700,
        status: 'created',
      };
    },
  });
  const quote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: 'tprl1pbuyer',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-verify',
  });
  const trade = await service.acceptQuote(quote.quoteId, {
    buyerPearlAddress: 'tprl1pbuyer',
    buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
    sellerPearlRefundAddress: 'tprl1psellerrefund',
    sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
    clientRequestId: 'accept-request-verify',
  });

  const verification = await service.verifyUsdcEscrowTerms(trade.tradeId);

  assert.equal(verification.verified, true);
  assert.equal(verification.depositAllowed, true);
  assert.deepEqual(verification.mismatches, []);
});

test('blocks buyer deposit when on-chain USDC escrow terms mismatch', async () => {
  const service = createServiceWithUsdcReader({
    async getTrade() {
      return {
        buyer: '0x9999999999999999999999999999999999999999',
        seller: '0x4444444444444444444444444444444444444444',
        amountMicros: '1',
        feeMicros: '1700000',
        expiryUnixSeconds: 1778933700,
        status: 'created',
      };
    },
  });
  const quote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: 'tprl1pbuyer',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-mismatch',
  });
  const trade = await service.acceptQuote(quote.quoteId, {
    buyerPearlAddress: 'tprl1pbuyer',
    buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
    sellerPearlRefundAddress: 'tprl1psellerrefund',
    sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
    clientRequestId: 'accept-request-mismatch',
  });

  const verification = await service.verifyUsdcEscrowTerms(trade.tradeId);

  assert.equal(verification.verified, false);
  assert.equal(verification.depositAllowed, false);
  assert.deepEqual(verification.mismatches.sort(), ['amount', 'buyer']);
});

test('projects public proof without private addresses', async () => {
  const service = createService();
  const quote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: 'tprl1pbuyer',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-4',
  });
  const trade = await service.acceptQuote(quote.quoteId, {
    buyerPearlAddress: 'tprl1pbuyer',
    buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
    sellerPearlRefundAddress: 'tprl1psellerrefund',
    sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
    clientRequestId: 'accept-request-4',
  });

  const proof = await service.getPublicProof(trade.tradeId);
  const serialized = JSON.stringify(proof);

  assert.equal(proof.tradeId, trade.tradeId);
  assert.equal(proof.base.chainId, 84532);
  assert.deepEqual(proof.deadlines, trade.deadlines);
  assert.equal(proof.events.length, 1);
  assert.equal(serialized.includes('buyerUsdcAddress'), false);
  assert.equal(serialized.includes('sellerUsdcReceiveAddress'), false);
});

test('models edge states as manual-review paths instead of release paths', () => {
  assert.equal(canTransitionTrade('pearl_escrow_pending', 'late_prl_funding'), true);
  assert.equal(canTransitionTrade('late_prl_funding', 'release_pending'), false);
  assert.equal(canTransitionTrade('late_prl_funding', 'disputed'), false);
  assert.equal(canTransitionTrade('late_prl_funding', 'failed_manual_review'), true);
  assert.equal(canTransitionTrade('usdc_escrow_confirmed', 'usdc_refunded'), true);
  assert.equal(canTransitionTrade('usdc_refunded', 'release_pending'), false);
  assert.equal(canTransitionTrade('usdc_refunded', 'disputed'), false);
  assert.equal(canTransitionTrade('release_pending', 'prl_release_failed'), true);
  assert.equal(canTransitionTrade('usdc_escrow_confirmed', 'amount_mismatch'), true);
  assert.equal(canTransitionTrade('pearl_escrow_seen', 'reorged'), true);
  assert.equal(canTransitionTrade('usdc_escrow_pending', 'stale_indexer'), true);
  assert.equal(canTransitionTrade('pearl_escrow_pending', 'unknown_spend'), true);
});
