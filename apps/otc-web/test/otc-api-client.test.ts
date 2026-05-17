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
