import assert from 'node:assert/strict';
import test from 'node:test';
import type { AddressInfo } from 'node:net';

import { createOtcHttpServer } from '../src/http.ts';
import { InMemoryOtcRepository } from '../src/repository.ts';
import { OtcTradeService, type PearlEscrowAllocator } from '../src/trade-service.ts';
import type { OtcApiConfig } from '../src/types.ts';

const config: OtcApiConfig = {
  pearlNetwork: 'testnet2',
  pearlEscrowAllocator: 'mock',
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
};

const escrowAllocator: PearlEscrowAllocator = {
  allocateEscrow({ tradeId, config: allocatorConfig }) {
    return {
      network: allocatorConfig.pearlNetwork,
      address: `tprl1p${tradeId.slice(-12)}`,
      expectedAmountGrains: '100000000000',
      requiredConfirmations: allocatorConfig.pearlEscrowConfirmations,
    };
  },
};

async function withServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const service = new OtcTradeService(
    new InMemoryOtcRepository(),
    config,
    escrowAllocator,
    () => new Date('2026-05-16T12:00:00.000Z'),
  );
  const server = createOtcHttpServer(service);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function postJson(baseUrl: string, path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('serves quote, accept, trade, and proof routes', async () => {
  await withServer(async (baseUrl) => {
    const quoteResponse = await postJson(baseUrl, '/otc/quotes', {
      side: 'buy_prl',
      amountPrl: '1000.00000000',
      settlementAsset: 'USDC',
      settlementNetwork: 'base',
      buyerPearlAddress: 'tprl1pbuyer',
      usdcRefundAddress: '0x2222222222222222222222222222222222222222',
      clientRequestId: 'quote-http-1',
    });
    assert.equal(quoteResponse.status, 201);
    const quote = (await quoteResponse.json()) as { quoteId: string; amountUsdc: string };
    assert.equal(quote.amountUsdc, '170.000000');

    const tradeResponse = await postJson(baseUrl, `/otc/quotes/${quote.quoteId}/accept`, {
      buyerPearlAddress: 'tprl1pbuyer',
      buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
      sellerPearlRefundAddress: 'tprl1psellerrefund',
      sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
      clientRequestId: 'accept-http-1',
    });
    assert.equal(tradeResponse.status, 201);
    const trade = (await tradeResponse.json()) as {
      tradeId: string;
      state: string;
      deadlines: { usdcDepositDeadline: string };
      usdcEscrow: { expiresAt: string };
    };
    assert.equal(trade.state, 'pearl_escrow_pending');
    assert.equal(trade.deadlines.usdcDepositDeadline, '2026-05-16T12:15:00.000Z');
    assert.equal(trade.usdcEscrow.expiresAt, trade.deadlines.usdcDepositDeadline);

    const getTradeResponse = await fetch(`${baseUrl}/otc/trades/${trade.tradeId}`);
    assert.equal(getTradeResponse.status, 200);
    const fetchedTrade = (await getTradeResponse.json()) as { tradeId: string };
    assert.equal(fetchedTrade.tradeId, trade.tradeId);

    const proofResponse = await fetch(`${baseUrl}/otc/trades/${trade.tradeId}/proof`);
    assert.equal(proofResponse.status, 200);
    const proof = (await proofResponse.json()) as { tradeId: string; events: unknown[]; deadlines: { usdcDepositDeadline: string } };
    assert.equal(proof.tradeId, trade.tradeId);
    assert.equal(proof.deadlines.usdcDepositDeadline, '2026-05-16T12:15:00.000Z');
    assert.equal(proof.events.length, 1);

    const createIntentResponse = await postJson(baseUrl, `/otc/trades/${trade.tradeId}/usdc-escrow/create-intent`, {
      idempotencyKey: 'http-create-trade-1',
      actor: 'settlement-worker',
    });
    assert.equal(createIntentResponse.status, 200);
    const createIntent = (await createIntentResponse.json()) as { tradeKey: string; sideEffect: { effectType: string } };
    assert.match(createIntent.tradeKey, /^0x[0-9a-f]{64}$/);
    assert.equal(createIntent.sideEffect.effectType, 'usdc_create_trade');

    const sideEffectsResponse = await fetch(`${baseUrl}/otc/trades/${trade.tradeId}/side-effects`);
    assert.equal(sideEffectsResponse.status, 200);
    const sideEffects = (await sideEffectsResponse.json()) as unknown[];
    assert.equal(sideEffects.length, 1);
  });
});

test('returns mapped HTTP errors', async () => {
  await withServer(async (baseUrl) => {
    const missing = await fetch(`${baseUrl}/otc/trades/missing`);
    assert.equal(missing.status, 404);

    const invalid = await fetch(`${baseUrl}/otc/quotes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    assert.equal(invalid.status, 400);
  });
});
