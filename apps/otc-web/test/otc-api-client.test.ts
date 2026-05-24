import assert from 'node:assert/strict';
import test from 'node:test';

import { OtcApiClient } from '../src/otc-api-client.ts';

test('posts quote and accept requests to the OTC HTTP routes', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new OtcApiClient({
    baseUrl: 'https://api.example.test/',
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (url.toString().endsWith('/accept')) {
        return jsonResponse({ tradeId: 'trade_1' }, 201);
      }
      return jsonResponse({ quoteId: 'quote_1' }, init?.method === 'POST' ? 201 : 200);
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
  const fetchedQuote = await client.getQuote('quote_1');
  const trade = await client.acceptQuote('quote_1', {
    buyerPearlAddress: 'tprl1pbuyer',
    buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
    sellerPearlRefundAddress: 'tprl1psellerrefund',
    sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
    clientRequestId: 'accept-client-1',
  });

  assert.equal(quote.quoteId, 'quote_1');
  assert.equal(fetchedQuote.quoteId, 'quote_1');
  assert.equal(trade.tradeId, 'trade_1');
  assert.equal(calls[0].url, 'https://api.example.test/otc/quotes');
  assert.equal(calls[1].url, 'https://api.example.test/otc/quotes/quote_1');
  assert.equal(calls[2].url, 'https://api.example.test/otc/quotes/quote_1/accept');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[1].init.method, 'GET');
  assert.equal(calls[2].init.method, 'POST');
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

test('posts wallet user, referral, and profile routes', async () => {
  const calls: Array<{ url: string; init: RequestInit; body?: unknown }> = [];
  const client = new OtcApiClient({
    baseUrl: 'https://api.example.test',
    fetcher: async (url, init) => {
      const text = typeof init?.body === 'string' ? init.body : undefined;
      calls.push({ url: String(url), init: init ?? {}, ...(text ? { body: JSON.parse(text) } : {}) });
      if (url.toString().endsWith('/wallet-challenges')) {
        return jsonResponse({ challengeId: 'wallet_challenge_1', message: 'sign me', expiresAt: '2026-05-24T12:10:00.000Z' }, 201);
      }
      if (url.toString().includes('/referrals/')) {
        return jsonResponse({ referralCode: 'ABC123', ownerUserId: 'user_referrer', status: 'active' });
      }
      if (url.toString().endsWith('/profile')) {
        return jsonResponse({ userId: 'user_1', email: 'user@example.test', notificationEmailEnabled: true });
      }
      return jsonResponse({ userId: 'user_1', referralCode: 'ABC123', wallet: { address: '0xabc' }, profile: {} }, 201);
    },
  });

  const challenge = await client.createWalletChallenge({
    walletType: 'evm',
    network: 'base_sepolia',
    address: '0x1111111111111111111111111111111111111111',
  });
  const user = await client.registerUser({
    challengeId: challenge.challengeId,
    signature: '0xsig',
    sourceUrl: 'https://oysters.market/?ref=ABC123',
  });
  const lookup = await client.resolveReferralCode('ABC123');
  const profile = await client.updateUserProfile('user_1', {
    challengeId: 'wallet_challenge_2',
    signature: '0xsig2',
    email: 'user@example.test',
    notificationEmailEnabled: true,
  });

  assert.equal(challenge.challengeId, 'wallet_challenge_1');
  assert.equal(user.userId, 'user_1');
  assert.equal(lookup.ownerUserId, 'user_referrer');
  assert.equal(profile.notificationEmailEnabled, true);
  assert.equal(calls[0].url, 'https://api.example.test/otc/users/wallet-challenges');
  assert.equal(calls[1].url, 'https://api.example.test/otc/users');
  assert.equal(calls[2].url, 'https://api.example.test/otc/users/referrals/ABC123');
  assert.equal(calls[3].url, 'https://api.example.test/otc/users/user_1/profile');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[2].init.method, 'GET');
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
  }, 'admin-token');
  const verification = await client.verifyUsdcEscrowTerms('trade_1');
  const sideEffects = await client.listSideEffects('trade_1');
  const recorded = await client.recordSideEffect('trade_1', {
    idempotencyKey: 'effect-1',
    effectType: 'usdc_deposit_observed',
    status: 'confirmed',
    actor: 'operator',
  }, 'admin-token');

  assert.equal(intent.tradeId, 'trade_1');
  assert.equal(verification.depositAllowed, true);
  assert.equal(sideEffects.length, 1);
  assert.equal(recorded.effectType, 'usdc_deposit_observed');
  assert.equal(calls[0].url, 'https://api.example.test/otc/trades/trade_1/usdc-escrow/create-intent');
  assert.equal(new Headers(calls[0].init.headers).get('authorization'), 'Bearer admin-token');
  assert.equal(calls[1].url, 'https://api.example.test/otc/trades/trade_1/usdc-escrow/verification');
  assert.equal(calls[2].url, 'https://api.example.test/otc/trades/trade_1/side-effects');
  assert.equal(calls[3].url, 'https://api.example.test/otc/trades/trade_1/side-effects');
  assert.equal(calls[3].init.method, 'POST');
  assert.equal(new Headers(calls[3].init.headers).get('authorization'), 'Bearer admin-token');
});

test('gets bearer-gated admin list and debug detail routes', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = new OtcApiClient({
    baseUrl: 'https://api.example.test',
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (url.toString().includes('/admin/trades/trade_1')) {
        return jsonResponse({
          trade: { tradeId: 'trade_1' },
          sideEffects: [{ effectType: 'support_alert_delivery', status: 'failed' }],
          events: [],
          proof: { tradeId: 'trade_1' },
          currentBlockers: ['failed_side_effect:support_alert_delivery'],
          deadlineBreaches: [],
          safeActions: ['copy_support_summary'],
          redaction: 'operator',
          supportSummary: { headline: 'Trade trade_1 needs review', waitingOn: [], publicProofPath: '/otc/trades/trade_1/proof' },
        });
      }
      return jsonResponse({
        items: [
          {
            tradeId: 'trade_1',
            quoteId: 'quote_1',
            state: 'unknown_spend',
            side: 'buy_prl',
            amountPrl: '1000.00000000',
            amountUsdc: '170.000000',
            ageMs: 60000,
            updatedAgeMs: 30000,
            currentBlockers: ['manual_review:unknown_spend'],
            deadlineBreaches: ['settlement_deadline'],
            manualReview: true,
            alertCount: 1,
            latestAlertSeverity: 'critical',
            alertDeliveryStatus: 'failed',
            failedSideEffectCount: 1,
            safeActions: ['copy_support_summary'],
            updatedAt: '2026-05-18T12:00:00.000Z',
          },
        ],
        nextCursor: 'cursor_2',
        total: 1,
        limit: 25,
      });
    },
  });

  const trades = await client.listAdminTrades(
    {
      state: 'unknown_spend',
      manualReviewOnly: true,
      search: 'trade_1',
      severity: 'critical',
      failedSideEffectOnly: true,
      deadlineBreachedOnly: true,
      blocker: 'unknown_spend',
      minUpdatedAgeMs: 1000,
      alertDeliveryStatus: 'failed',
      cursor: 'cursor_1',
      limit: 25,
    },
    'admin-token',
  );
  const detail = await client.getAdminTradeDebug('trade_1', 'admin-token');

  assert.equal(trades.items[0]?.tradeId, 'trade_1');
  assert.equal(trades.nextCursor, 'cursor_2');
  assert.equal(detail.currentBlockers[0], 'failed_side_effect:support_alert_delivery');
  assert.equal(
    calls[0].url,
    'https://api.example.test/otc/admin/trades?state=unknown_spend&manual_review_only=true&search=trade_1&severity=critical&failed_side_effect_only=true&deadline_breached_only=true&blocker=unknown_spend&min_updated_age_ms=1000&alert_delivery_status=failed&cursor=cursor_1&limit=25',
  );
  assert.equal(calls[1].url, 'https://api.example.test/otc/admin/trades/trade_1');
  assert.equal((calls[0].init.headers as Headers).get('authorization'), 'Bearer admin-token');
  assert.equal((calls[1].init.headers as Headers).get('authorization'), 'Bearer admin-token');
});

test('posts admin alert, manual-review, replay, and public support alert routes', async () => {
  const calls: Array<{ url: string; init: RequestInit; body: unknown }> = [];
  const client = new OtcApiClient({
    baseUrl: 'https://api.example.test',
    fetcher: async (url, init) => {
      const text = typeof init?.body === 'string' ? init.body : '{}';
      calls.push({ url: String(url), init: init ?? {}, body: JSON.parse(text) });
      return jsonResponse({ tradeId: 'trade_1', status: 'confirmed', effectType: 'support_alert' }, 201);
    },
  });

  await client.recordAdminSupportAlert(
    'trade_1',
    {
      idempotencyKey: 'admin-alert-1',
      severity: 'warning',
      message: 'needs operator note',
      contact: 'ops@example.test',
      metadata: { source: 'test' },
    },
    'admin-token',
  );
  await client.markAdminManualReview(
    'trade_1',
    {
      idempotencyKey: 'manual-review-1',
      reason: 'unknown spend needs review',
      metadata: { source: 'test' },
    },
    'admin-token',
  );
  await client.replayAdminSupportAlertDelivery('trade_1', 'admin-alert-1', { idempotencyKey: 'replay-1' }, 'admin-token');
  await client.recordPublicSupportAlert('trade_1', {
    idempotencyKey: 'user-alert-1',
    actor: 'user',
    severity: 'critical',
    message: 'I need help',
    source: 'user',
    contact: 'user@example.test',
    metadata: { source: 'test' },
  });

  assert.equal(calls[0].url, 'https://api.example.test/otc/admin/trades/trade_1/alerts');
  assert.equal(calls[1].url, 'https://api.example.test/otc/admin/trades/trade_1/manual-review');
  assert.equal(calls[2].url, 'https://api.example.test/otc/admin/trades/trade_1/alerts/admin-alert-1/replay');
  assert.equal(calls[3].url, 'https://api.example.test/otc/trades/trade_1/support-alerts');
  assert.equal((calls[0].init.headers as Headers).get('authorization'), 'Bearer admin-token');
  assert.equal((calls[1].init.headers as Headers).get('authorization'), 'Bearer admin-token');
  assert.equal((calls[2].init.headers as Headers).get('authorization'), 'Bearer admin-token');
  assert.equal((calls[3].init.headers as Headers).get('authorization'), null);
  assert.equal('actor' in (calls[0].body as Record<string, unknown>), false);
  assert.equal('actor' in (calls[1].body as Record<string, unknown>), false);
  assert.deepEqual(calls[2].body, { idempotencyKey: 'replay-1' });
  assert.equal((calls[3].body as { actor?: string }).actor, 'user');
  assert.equal((calls[3].body as { source?: string }).source, 'user');
});

test('throws mapped API errors', async () => {
  const client = new OtcApiClient({
    baseUrl: 'https://api.example.test',
    fetcher: async () => jsonResponse({ error: 'not_found', message: 'trade not found' }, 404),
  });

  await assert.rejects(
    () => client.getTrade('missing'),
    (error) => error instanceof Error && error.message === 'trade not found' && 'status' in error && error.status === 404,
  );
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
