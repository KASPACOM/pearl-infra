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
  supportAlertRateLimitWindowMs: 10 * 60 * 1000,
  supportAlertRateLimitMax: 5,
};
const adminToken = 'test-admin-token';
const adminHeaders = { authorization: `Bearer ${adminToken}` };
const operatorToken = 'test-operator-token';
const supportToken = 'test-support-token';
const operatorHeaders = { authorization: `Bearer ${operatorToken}` };
const supportHeaders = { authorization: `Bearer ${supportToken}` };

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
  const server = createOtcHttpServer(service, {
    adminToken,
    adminCredentials: [
      { token: adminToken, actor: 'admin-user', roles: ['admin'] },
      { token: operatorToken, actor: 'operator-user', roles: ['operator'] },
      { token: supportToken, actor: 'support-user', roles: ['support_read'] },
    ],
  });
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

    const releaseIntentResponse = await fetch(`${baseUrl}/otc/trades/${trade.tradeId}/pearl-release/intent`);
    assert.equal(releaseIntentResponse.status, 200);
    const releaseIntent = (await releaseIntentResponse.json()) as { status: string; reason: string };
    assert.equal(releaseIntent.status, 'not_ready');
    assert.match(releaseIntent.reason, /multisig/);

    const publicCreateIntentResponse = await postJson(baseUrl, `/otc/trades/${trade.tradeId}/usdc-escrow/create-intent`, {
      idempotencyKey: 'http-create-trade-public',
      actor: 'spoofed-operator',
    });
    assert.equal(publicCreateIntentResponse.status, 401);

    const createIntentResponse = await postJson(baseUrl, `/otc/trades/${trade.tradeId}/usdc-escrow/create-intent`, {
      idempotencyKey: 'http-create-trade-1',
      actor: 'settlement-worker',
    }, operatorHeaders);
    assert.equal(createIntentResponse.status, 200);
    const createIntent = (await createIntentResponse.json()) as { tradeKey: string; sideEffect: { actor: string; effectType: string } };
    assert.match(createIntent.tradeKey, /^0x[0-9a-f]{64}$/);
    assert.equal(createIntent.sideEffect.effectType, 'usdc_create_trade');
    assert.equal(createIntent.sideEffect.actor, 'operator-user');

    const recordSideEffectResponse = await postJson(baseUrl, `/otc/trades/${trade.tradeId}/side-effects`, {
      idempotencyKey: 'http-record-side-effect-1',
      effectType: 'usdc_deposit_observed',
      status: 'confirmed',
      actor: 'spoofed-operator',
      txHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
      chainId: 84532,
    }, operatorHeaders);
    assert.equal(recordSideEffectResponse.status, 201);
    const recordedSideEffect = (await recordSideEffectResponse.json()) as { actor: string };
    assert.equal(recordedSideEffect.actor, 'operator-user');

    const publicSideEffectsResponse = await fetch(`${baseUrl}/otc/trades/${trade.tradeId}/side-effects`);
    assert.equal(publicSideEffectsResponse.status, 401);

    const sideEffectsResponse = await fetch(`${baseUrl}/otc/trades/${trade.tradeId}/side-effects`, { headers: adminHeaders });
    assert.equal(sideEffectsResponse.status, 200);
    const sideEffects = (await sideEffectsResponse.json()) as unknown[];
    assert.equal(sideEffects.length, 2);

    const supportAlertResponse = await postJson(baseUrl, `/otc/trades/${trade.tradeId}/support-alerts`, {
      idempotencyKey: 'http-support-alert-1',
      actor: 'spoofed-operator',
      severity: 'warning',
      message: 'User needs help with deposit status',
      source: 'operator',
    });
    assert.equal(supportAlertResponse.status, 201);
    const supportAlert = (await supportAlertResponse.json()) as { actor: string; metadata: { source: string } };
    assert.equal(supportAlert.actor, 'user');
    assert.equal(supportAlert.metadata.source, 'user');

    const unauthorizedAdminResponse = await fetch(`${baseUrl}/otc/admin/trades?manual_review_only=false&search=${trade.tradeId}`);
    assert.equal(unauthorizedAdminResponse.status, 401);

    const wrongTokenAdminResponse = await fetch(`${baseUrl}/otc/admin/trades?manual_review_only=false&search=${trade.tradeId}`, {
      headers: { authorization: 'Bearer wrong-admin-token' },
    });
    assert.equal(wrongTokenAdminResponse.status, 401);

    const adminListResponse = await fetch(`${baseUrl}/otc/admin/trades?manual_review_only=false&search=${trade.tradeId}`, {
      headers: adminHeaders,
    });
    assert.equal(adminListResponse.status, 200);
    const adminTrades = (await adminListResponse.json()) as { items: Array<{ tradeId: string; alertCount: number }>; total: number };
    assert.equal(adminTrades.total, 1);
    assert.equal(adminTrades.items.length, 1);
    assert.equal(adminTrades.items[0].tradeId, trade.tradeId);
    assert.equal(adminTrades.items[0].alertCount, 1);

    const supportDetailResponse = await fetch(`${baseUrl}/otc/admin/trades/${trade.tradeId}`, { headers: supportHeaders });
    assert.equal(supportDetailResponse.status, 200);
    const supportDetail = (await supportDetailResponse.json()) as { redaction: string; trade: { buyerPearlAddress: string } };
    assert.equal(supportDetail.redaction, 'support');
    assert.equal(supportDetail.trade.buyerPearlAddress, 'tprl1p...uyer');

    const forbiddenManualReviewResponse = await postJson(baseUrl, `/otc/admin/trades/${trade.tradeId}/manual-review`, {
      idempotencyKey: 'http-manual-review-forbidden',
      reason: 'Support cannot mark manual review',
    }, supportHeaders);
    assert.equal(forbiddenManualReviewResponse.status, 403);

    const manualReviewResponse = await postJson(baseUrl, `/otc/admin/trades/${trade.tradeId}/manual-review`, {
      idempotencyKey: 'http-manual-review-1',
      actor: 'spoofed-operator',
      reason: 'User reported an error; hold for operator inspection',
    }, operatorHeaders);
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
    const adminDetail = (await adminDetailResponse.json()) as {
      sideEffects: unknown[];
      events: Array<{ metadata?: { actor?: string } }>;
    };
    assert.equal(adminDetail.sideEffects.length, 4);
    assert.equal(adminDetail.events.some((event) => event.metadata?.actor === 'operator-user'), true);
    assert.equal(adminDetail.events.some((event) => event.metadata?.actor === 'spoofed-operator'), false);
  });
});

test('rate limits public support alerts per trade and caller', async () => {
  const service = new OtcTradeService(
    new InMemoryOtcRepository(),
    { ...config, supportAlertRateLimitMax: 1 },
    escrowAllocator,
    () => new Date('2026-05-16T12:00:00.000Z'),
  );
  const server = createOtcHttpServer(service, { adminToken });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const quoteResponse = await postJson(baseUrl, '/otc/quotes', {
      side: 'buy_prl',
      amountPrl: '1000.00000000',
      settlementAsset: 'USDC',
      settlementNetwork: 'base',
      buyerPearlAddress: 'tprl1pbuyer',
      usdcRefundAddress: '0x2222222222222222222222222222222222222222',
      clientRequestId: 'quote-http-rate-limit',
    });
    const quote = (await quoteResponse.json()) as { quoteId: string };
    const tradeResponse = await postJson(baseUrl, `/otc/quotes/${quote.quoteId}/accept`, {
      buyerPearlAddress: 'tprl1pbuyer',
      buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
      sellerPearlRefundAddress: 'tprl1psellerrefund',
      sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
      clientRequestId: 'accept-http-rate-limit',
    });
    const trade = (await tradeResponse.json()) as { tradeId: string };

    const first = await postJson(baseUrl, `/otc/trades/${trade.tradeId}/support-alerts`, {
      idempotencyKey: 'http-rate-alert-1',
      actor: 'support',
      severity: 'warning',
      message: 'First alert',
      source: 'user',
    }, { 'x-forwarded-for': '203.0.113.10' });
    const second = await postJson(baseUrl, `/otc/trades/${trade.tradeId}/support-alerts`, {
      idempotencyKey: 'http-rate-alert-2',
      actor: 'support',
      severity: 'warning',
      message: 'Second alert',
      source: 'user',
    }, { 'x-forwarded-for': '203.0.113.10' });

    assert.equal(first.status, 201);
    assert.equal(second.status, 429);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
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

    const oversized = await fetch(`${baseUrl}/otc/quotes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: 'x'.repeat(70 * 1024) }),
    });
    assert.equal(oversized.status, 413);
  });
});
