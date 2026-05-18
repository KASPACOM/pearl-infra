import assert from 'node:assert/strict';
import test from 'node:test';

import { OtcApiClient } from '../src/otc-api-client.ts';

test('posts quote and accept requests to the OTC HTTP routes', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new OtcApiClient({
    baseUrl: 'https://api.example.test/',
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse(url.toString().endsWith('/accept') ? { tradeId: 'trade_1' } : { quoteId: 'quote_1' }, 201);
    },
  });

  const quote = await client.createQuote({
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: 'tprl1pbuyer',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-client-1',
  });
  const trade = await client.acceptQuote('quote_1', {
    buyerPearlAddress: 'tprl1pbuyer',
    buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
    sellerPearlRefundAddress: 'tprl1psellerrefund',
    sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
    clientRequestId: 'accept-client-1',
  });

  assert.equal(quote.quoteId, 'quote_1');
  assert.equal(trade.tradeId, 'trade_1');
  assert.equal(calls[0].url, 'https://api.example.test/otc/quotes');
  assert.equal(calls[1].url, 'https://api.example.test/otc/quotes/quote_1/accept');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[1].init.method, 'POST');
});

test('gets trade and proof routes', async () => {
  const calls: string[] = [];
  const client = new OtcApiClient({
    baseUrl: 'https://api.example.test',
    fetcher: async (url) => {
      calls.push(String(url));
      return jsonResponse(url.toString().endsWith('/proof') ? { tradeId: 'trade_1', events: [] } : { tradeId: 'trade_1' });
    },
  });

  const trade = await client.getTrade('trade_1');
  const proof = await client.getProof('trade_1');

  assert.equal(trade.tradeId, 'trade_1');
  assert.equal(proof.tradeId, 'trade_1');
  assert.deepEqual(calls, [
    'https://api.example.test/otc/trades/trade_1',
    'https://api.example.test/otc/trades/trade_1/proof',
  ]);
});

test('gets escrow verification and side-effect routes', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new OtcApiClient({
    baseUrl: 'https://api.example.test',
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (url.toString().endsWith('/create-intent')) {
        return jsonResponse({ tradeId: 'trade_1', tradeKey: '0xabc', sideEffect: { effectType: 'usdc_create_trade' } });
      }
      if (url.toString().endsWith('/verification')) {
        return jsonResponse({ tradeId: 'trade_1', verified: true, depositAllowed: true, mismatches: [] });
      }
      if (url.toString().endsWith('/side-effects') && init?.method === 'POST') {
        return jsonResponse({ tradeId: 'trade_1', effectType: 'usdc_deposit_observed' }, 201);
      }
      return jsonResponse([{ tradeId: 'trade_1', effectType: 'usdc_deposit_observed' }]);
    },
  });

  const intent = await client.prepareUsdcCreateTrade('trade_1', {
    idempotencyKey: 'intent-1',
    actor: 'otc-web',
  });
  const verification = await client.verifyUsdcEscrowTerms('trade_1');
  const sideEffects = await client.listSideEffects('trade_1');
  const recorded = await client.recordSideEffect('trade_1', {
    idempotencyKey: 'effect-1',
    effectType: 'usdc_deposit_observed',
    status: 'confirmed',
    actor: 'operator',
  });

  assert.equal(intent.tradeId, 'trade_1');
  assert.equal(verification.depositAllowed, true);
  assert.equal(sideEffects.length, 1);
  assert.equal(recorded.effectType, 'usdc_deposit_observed');
  assert.equal(calls[0].url, 'https://api.example.test/otc/trades/trade_1/usdc-escrow/create-intent');
  assert.equal(calls[1].url, 'https://api.example.test/otc/trades/trade_1/usdc-escrow/verification');
  assert.equal(calls[2].url, 'https://api.example.test/otc/trades/trade_1/side-effects');
  assert.equal(calls[3].url, 'https://api.example.test/otc/trades/trade_1/side-effects');
  assert.equal(calls[3].init.method, 'POST');
});

test('throws mapped API errors', async () => {
  const client = new OtcApiClient({
    baseUrl: 'https://api.example.test',
    fetcher: async () => jsonResponse({ error: 'not_found', message: 'trade not found' }, 404),
  });

  await assert.rejects(() => client.getTrade('missing'), /trade not found/);
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
