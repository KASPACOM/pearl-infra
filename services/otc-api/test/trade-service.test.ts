import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryOtcRepository } from '../src/repository.ts';
import { OtcTradeService, type PearlEscrowAllocator } from '../src/trade-service.ts';
import type { OtcApiConfig } from '../src/types.ts';

const config: OtcApiConfig = {
  pearlNetwork: 'testnet2',
  quoteTtlMs: 5 * 60 * 1000,
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
  assert.equal(trade.pearlEscrow.requiredConfirmations, 3);
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
  assert.equal(proof.events.length, 1);
  assert.equal(serialized.includes('buyerUsdcAddress'), false);
  assert.equal(serialized.includes('sellerUsdcReceiveAddress'), false);
});
