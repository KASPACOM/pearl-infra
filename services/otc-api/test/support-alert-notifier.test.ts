import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createConfiguredSupportAlertNotifier,
  TelegramSupportAlertNotifier,
  WebhookSupportAlertNotifier,
} from '../src/support-alert-notifier.ts';

test('posts support alert webhook payload without private escrow terms', async () => {
  const requests: Array<{ url: string; body: any }> = [];
  const notifier = new WebhookSupportAlertNotifier('https://alerts.example.test/otc', (async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response('{}', { status: 202 });
  }) as typeof fetch);

  await notifier.notifySupportAlert({
    trade: {
      tradeId: 'trade_1',
      quoteId: 'quote_1',
      state: 'pearl_escrow_pending',
      side: 'buy_prl',
      amountPrl: '1000.00000000',
      amountUsdc: '170.000000',
      feePrl: '0.00000000',
      feeUsdc: '0.000000',
      buyerPearlAddress: 'tprl1pbuyer',
      buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
      sellerPearlRefundAddress: 'tprl1psellerrefund',
      sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
      pearlEscrow: {
        network: 'testnet2',
        address: 'tprl1pescrow',
        expectedAmountGrains: '100000000000',
        requiredConfirmations: 3,
      },
      usdcEscrow: {
        network: 'base',
        chainId: 84532,
        contract: '0x1111111111111111111111111111111111111111',
        usdcToken: '0x2222222222222222222222222222222222222222',
        tradeKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        expectedAmountMicros: '170000000',
        requiredConfirmations: 1,
        expiresAt: '2026-05-16T12:15:00.000Z',
      },
      deadlines: {
        quoteExpiresAt: '2026-05-16T12:05:00.000Z',
        pearlFundingDeadline: '2026-05-16T12:10:00.000Z',
        usdcDepositDeadline: '2026-05-16T12:15:00.000Z',
        settlementDeadline: '2026-05-16T12:30:00.000Z',
        refundAvailableAt: '2026-05-16T12:30:00.000Z',
      },
      createdAt: '2026-05-16T12:00:00.000Z',
      updatedAt: '2026-05-16T12:00:00.000Z',
    },
    alert: {
      idempotencyKey: 'support-alert-1',
      tradeId: 'trade_1',
      effectType: 'support_alert',
      status: 'prepared',
      actor: 'support',
      metadata: {
        severity: 'warning',
        message: 'User needs help',
        source: 'user',
        contact: 'user@example.com',
      },
      createdAt: '2026-05-16T12:01:00.000Z',
      updatedAt: '2026-05-16T12:01:00.000Z',
    },
    supportSummary: {
      headline: 'Trade trade_1 is pearl_escrow_pending',
      waitingOn: ['waiting_for_prl_funding'],
      publicProofPath: '/otc/trades/trade_1/proof',
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://alerts.example.test/otc');
  assert.equal(requests[0].body.type, 'pearl_otc_support_alert');
  assert.equal(requests[0].body.tradeId, 'trade_1');
  assert.equal(requests[0].body.severity, 'warning');
  assert.equal(requests[0].body.supportSummary.publicProofPath, '/otc/trades/trade_1/proof');
  assert.equal('buyerPearlAddress' in requests[0].body, false);
  assert.equal('sellerUsdcReceiveAddress' in requests[0].body, false);
});

test('throws when support alert webhook returns a non-success status', async () => {
  const notifier = new WebhookSupportAlertNotifier('https://alerts.example.test/otc', (async () => {
    return new Response('{}', { status: 500 });
  }) as typeof fetch);

  await assert.rejects(
    () =>
      notifier.notifySupportAlert({
        trade: {
          tradeId: 'trade_1',
          quoteId: 'quote_1',
          state: 'pearl_escrow_pending',
          side: 'buy_prl',
        } as any,
        alert: {
          idempotencyKey: 'support-alert-1',
          tradeId: 'trade_1',
          effectType: 'support_alert',
          status: 'prepared',
          actor: 'support',
          metadata: { severity: 'warning', message: 'User needs help', source: 'user' },
          createdAt: '2026-05-16T12:01:00.000Z',
          updatedAt: '2026-05-16T12:01:00.000Z',
        },
        supportSummary: {
          headline: 'Trade trade_1 is pearl_escrow_pending',
          waitingOn: ['waiting_for_prl_funding'],
          publicProofPath: '/otc/trades/trade_1/proof',
        },
      }),
    /support alert webhook failed with HTTP 500/,
  );
});

test('posts support alert to Telegram sendMessage with escaped HTML', async () => {
  const requests: Array<{ url: string; body: any }> = [];
  const notifier = new TelegramSupportAlertNotifier(
    {
      botToken: 'test-bot-token',
      chatId: '-1001234567890',
      messageThreadId: '456',
    },
    (async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
  );

  await notifier.notifySupportAlert({
    trade: {
      tradeId: 'trade_<1>',
      quoteId: 'quote_1',
      state: 'pearl_escrow_pending',
      side: 'buy_prl',
    } as any,
    alert: {
      idempotencyKey: 'support-alert-telegram-1',
      tradeId: 'trade_<1>',
      effectType: 'support_alert',
      status: 'prepared',
      actor: 'support',
      metadata: {
        severity: 'critical',
        message: 'User says <deposit> failed',
        source: 'user',
        contact: 'user@example.com',
      },
      createdAt: '2026-05-16T12:01:00.000Z',
      updatedAt: '2026-05-16T12:01:00.000Z',
    },
    supportSummary: {
      headline: 'Trade trade_<1> is pearl_escrow_pending',
      waitingOn: ['waiting_for_prl_funding'],
      publicProofPath: '/otc/trades/trade_<1>/proof',
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://api.telegram.org/bottest-bot-token/sendMessage');
  assert.equal(requests[0].body.chat_id, '-1001234567890');
  assert.equal(requests[0].body.message_thread_id, 456);
  assert.equal(requests[0].body.parse_mode, 'HTML');
  assert.match(requests[0].body.text, /Pearl OTC CRITICAL alert/);
  assert.match(requests[0].body.text, /trade_&lt;1&gt;/);
  assert.match(requests[0].body.text, /User says &lt;deposit&gt; failed/);
});

test('creates configured notifier for Telegram alerts without requiring webhook', async () => {
  const notifier = createConfiguredSupportAlertNotifier({
    pearlNetwork: 'testnet2',
    pearlEscrowAllocator: 'mock',
    pearlEscrowDerivationPrefix: '0',
    allowMainnetPearlEscrow: false,
    quoteTtlMs: 1,
    pearlFundingTtlMs: 1,
    usdcDepositTtlMs: 1,
    settlementTtlMs: 1,
    priceUsdcPerPrl: '0.170000',
    feeBps: 0,
    pearlEscrowConfirmations: 1,
    baseEscrowContract: '0x1111111111111111111111111111111111111111',
    baseNetwork: 'base_sepolia',
    supportAlertTelegramBotToken: 'test-bot-token',
    supportAlertTelegramChatId: '-1001234567890',
  });

  assert.ok(notifier);
});
