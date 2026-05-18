import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAdminTradeRow, buildAlertDeliveries } from '../src/admin-models.ts';
import type { AdminTradeDebugDetail, AdminTradeSummary } from '../src/otc-api-client.ts';

test('builds admin row indicators for alerts, blockers, deadlines, and failed effects', () => {
  const row = buildAdminTradeRow(summaryFixture());

  assert.equal(row.tradeId, 'trade_1');
  assert.equal(row.blockerSummary, 'manual_review:unknown_spend, failed_side_effect:support_alert_delivery');
  assert.deepEqual(
    row.indicators.map((indicator) => indicator.key),
    ['manual-review', 'alerts', 'delivery-status', 'failed-effects', 'deadline', 'blockers'],
  );
});

test('extracts support alert delivery statuses from admin debug detail', () => {
  const deliveries = buildAlertDeliveries(detailFixture());

  assert.equal(deliveries.length, 2);
  assert.equal(deliveries[0]?.label, 'Delivered');
  assert.equal(deliveries[1]?.label, 'Delivery failed');
  assert.match(deliveries[1]?.error ?? '', /webhook down/);
  assert.equal(deliveries[1]?.supportAlertId, 'support-alert-1');
  assert.equal(deliveries[1]?.canReplay, true);
});

function summaryFixture(): AdminTradeSummary {
  return {
    tradeId: 'trade_1',
    quoteId: 'quote_1',
    state: 'unknown_spend',
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    amountUsdc: '170.000000',
    ageMs: 60000,
    updatedAgeMs: 30000,
    currentBlockers: ['manual_review:unknown_spend', 'failed_side_effect:support_alert_delivery'],
    deadlineBreaches: ['settlement_deadline'],
    manualReview: true,
    alertCount: 2,
    latestAlertSeverity: 'critical',
    alertDeliveryStatus: 'failed',
    failedSideEffectCount: 1,
    safeActions: ['copy_support_summary'],
    updatedAt: '2026-05-18T12:00:00.000Z',
  };
}

function detailFixture(): AdminTradeDebugDetail {
  return {
    trade: {
      tradeId: 'trade_1',
      quoteId: 'quote_1',
      state: 'unknown_spend',
      side: 'buy_prl',
      amountPrl: '1000.00000000',
      amountUsdc: '170.000000',
      feePrl: '10.00000000',
      feeUsdc: '1.700000',
      buyerPearlAddress: 'tprl1pbuyer01',
      buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
      sellerPearlRefundAddress: 'tprl1pseller01',
      sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
      pearlEscrow: {
        network: 'testnet2',
        address: 'tprl1pescrow01',
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
        requiredConfirmations: 3,
        expiresAt: '2026-05-18T12:15:00.000Z',
      },
      deadlines: {
        quoteExpiresAt: '2026-05-18T12:05:00.000Z',
        pearlFundingDeadline: '2026-05-18T12:10:00.000Z',
        usdcDepositDeadline: '2026-05-18T12:15:00.000Z',
        settlementDeadline: '2026-05-18T12:30:00.000Z',
        refundAvailableAt: '2026-05-18T12:35:00.000Z',
      },
      createdAt: '2026-05-18T11:55:00.000Z',
      updatedAt: '2026-05-18T12:00:00.000Z',
    },
    events: [],
    sideEffects: [
      {
        idempotencyKey: 'delivery-ok',
        tradeId: 'trade_1',
        effectType: 'support_alert_delivery',
        status: 'confirmed',
        actor: 'system',
        metadata: {},
        createdAt: '2026-05-18T12:00:00.000Z',
        updatedAt: '2026-05-18T12:00:00.000Z',
      },
      {
        idempotencyKey: 'delivery-failed',
        tradeId: 'trade_1',
        effectType: 'support_alert_delivery',
        status: 'failed',
        actor: 'system',
        metadata: { error: 'webhook down', supportAlertIdempotencyKey: 'support-alert-1' },
        createdAt: '2026-05-18T12:01:00.000Z',
        updatedAt: '2026-05-18T12:01:00.000Z',
      },
    ],
    proof: {
      tradeId: 'trade_1',
      status: 'unknown_spend',
      deadlines: {
        quoteExpiresAt: '2026-05-18T12:05:00.000Z',
        pearlFundingDeadline: '2026-05-18T12:10:00.000Z',
        usdcDepositDeadline: '2026-05-18T12:15:00.000Z',
        settlementDeadline: '2026-05-18T12:30:00.000Z',
        refundAvailableAt: '2026-05-18T12:35:00.000Z',
      },
      quote: {
        side: 'buy_prl',
        amountPrl: '1000.00000000',
        amountUsdc: '170.000000',
        feePrl: '10.00000000',
        feeUsdc: '1.700000',
        priceUsdcPerPrl: '0.170000',
      },
      pearl: {
        escrowAddress: 'tprl1pescrow01',
        escrowConfirmations: 0,
      },
      base: {
        chainId: 84532,
        contract: '0x1111111111111111111111111111111111111111',
        usdcToken: '0x2222222222222222222222222222222222222222',
        tradeKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        requiredConfirmations: 3,
      },
      events: [],
      observedAt: '2026-05-18T12:02:00.000Z',
    },
    currentBlockers: ['manual_review:unknown_spend'],
    deadlineBreaches: ['settlement_deadline'],
    safeActions: ['copy_support_summary'],
    redaction: 'operator',
    supportSummary: {
      headline: 'Trade trade_1 is unknown_spend',
      waitingOn: ['manual_review:unknown_spend'],
      publicProofPath: '/otc/trades/trade_1/proof',
    },
  };
}
