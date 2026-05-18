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
const adminToken = 'test-admin-token';
const adminHeaders = { authorization: `Bearer ${adminToken}` };

const escrowAllocator: PearlEscrowAllocator = {
  async allocateEscrow({ tradeId, config: allocatorConfig }) {
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
  const server = createOtcHttpServer(service, { adminToken });
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

async function postJson(baseUrl: string, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
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

    const getQuoteResponse = await fetch(`${baseUrl}/otc/quotes/${quote.quoteId}`);
    assert.equal(getQuoteResponse.status, 200);
    const fetchedQuote = (await getQuoteResponse.json()) as { quoteId: string };
    assert.equal(fetchedQuote.quoteId, quote.quoteId);

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

    const supportAlertResponse = await postJson(baseUrl, `/otc/trades/${trade.tradeId}/support-alerts`, {
      idempotencyKey: 'http-support-alert-1',
      actor: 'support',
      severity: 'warning',
      message: 'User needs help with deposit status',
      source: 'user',
    });
    assert.equal(supportAlertResponse.status, 201);

    const unauthorizedAdminResponse = await fetch(`${baseUrl}/otc/admin/trades?manual_review_only=false&search=${trade.tradeId}`);
    assert.equal(unauthorizedAdminResponse.status, 401);

    const adminListResponse = await fetch(`${baseUrl}/otc/admin/trades?manual_review_only=false&search=${trade.tradeId}`, {
      headers: adminHeaders,
    });
    assert.equal(adminListResponse.status, 200);
    const adminTrades = (await adminListResponse.json()) as Array<{ tradeId: string; alertCount: number }>;
    assert.equal(adminTrades.length, 1);
    assert.equal(adminTrades[0].tradeId, trade.tradeId);
    assert.equal(adminTrades[0].alertCount, 1);

    const manualReviewResponse = await postJson(baseUrl, `/otc/admin/trades/${trade.tradeId}/manual-review`, {
      idempotencyKey: 'http-manual-review-1',
      actor: 'operator',
      reason: 'User reported an error; hold for operator inspection',
    }, adminHeaders);
    assert.equal(manualReviewResponse.status, 200);
    const manualReview = (await manualReviewResponse.json()) as {
      trade: { state: string };
      supportSummary: { publicProofPath: string };
      safeActions: string[];
    };
    assert.equal(manualReview.trade.state, 'failed_manual_review');
    assert.equal(manualReview.supportSummary.publicProofPath, `/otc/trades/${trade.tradeId}/proof`);
    assert.equal(manualReview.safeActions.includes('copy_support_summary'), true);

    const adminDetailResponse = await fetch(`${baseUrl}/otc/admin/trades/${trade.tradeId}`, { headers: adminHeaders });
    assert.equal(adminDetailResponse.status, 200);
    const adminDetail = (await adminDetailResponse.json()) as { sideEffects: unknown[] };
    assert.equal(adminDetail.sideEffects.length, 3);
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
