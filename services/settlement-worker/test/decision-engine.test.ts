import assert from 'node:assert/strict';
import test from 'node:test';

import type { OtcTrade } from '@kaspacom/pearl-sdk';

import {
  createSettlementDecisionRecord,
  createSettlementSnapshot,
  InMemorySettlementDecisionRepository,
  recordSettlementDecision,
} from '../dist/index.js';

const NOW = new Date('2026-05-17T18:00:00.000Z');

test('joins mocked Pearl proof state with mocked Base escrow event into a release decision', () => {
  const snapshot = createSettlementSnapshot({
    trade: tradeFixture({ state: 'usdc_escrow_confirmed' }),
    pearl: {
      status: 'confirmed',
      sourceEventId: 'pearl:funding:tx1:0',
      txid: 'tx1',
      outpoint: 'tx1:0',
      confirmations: 6,
      observedAt: '2026-05-17T16:50:00.000Z',
    },
    base: {
      status: 'deposited',
      sourceEventId: 'base:deposit:0xabc',
      txHash: '0xabc',
      confirmations: 12,
      observedAt: '2026-05-17T17:51:00.000Z',
    },
    now: NOW,
  });

  const decision = createSettlementDecisionRecord(snapshot, NOW);

  assert.equal(decision.action, 'prepare_prl_release');
  assert.equal(decision.toState, 'release_pending');
  assert.equal(decision.reason, 'both Pearl and Base legs are funded');
  assert.deepEqual(decision.sourceEventIds, ['base:deposit:0xabc', 'pearl:funding:tx1:0']);
  assert.match(decision.snapshotHash, /^sha256:[0-9a-f]{64}$/);
});

test('records settlement decisions idempotently by decision key', async () => {
  const repository = new InMemorySettlementDecisionRepository();
  const snapshot = createSettlementSnapshot({
    trade: tradeFixture({ state: 'pearl_escrow_confirmed' }),
    pearl: {
      status: 'confirmed',
      sourceEventId: 'pearl:funding:tx2:0',
      outpoint: 'tx2:0',
      confirmations: 6,
      observedAt: '2026-05-17T16:50:00.000Z',
    },
    base: {
      status: 'created',
      sourceEventId: 'base:create:0xdef',
      txHash: '0xdef',
      confirmations: 12,
      observedAt: '2026-05-17T17:51:00.000Z',
    },
    now: NOW,
  });

  const first = await recordSettlementDecision(repository, snapshot, NOW);
  const duplicate = await recordSettlementDecision(repository, snapshot, new Date('2026-05-17T18:05:00.000Z'));

  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.decision.idempotencyKey, first.decision.idempotencyKey);
  assert.equal(duplicate.decision.createdAt, first.decision.createdAt);
});

test('fails closed to manual review on stale, reorged, or inconsistent observations', () => {
  const staleBase = createSettlementDecisionRecord(
    createSettlementSnapshot({
      trade: tradeFixture({ state: 'usdc_escrow_pending' }),
      pearl: pearlProof({ status: 'confirmed' }),
      base: baseEvent({ status: 'stale' }),
      now: NOW,
    }),
    NOW,
  );
  const unknownPearlSpend = createSettlementDecisionRecord(
    createSettlementSnapshot({
      trade: tradeFixture({ state: 'release_pending' }),
      pearl: pearlProof({ status: 'unknown_spend' }),
      base: baseEvent({ status: 'deposited' }),
      now: NOW,
    }),
    NOW,
  );
  const reorgedPearlFunding = createSettlementDecisionRecord(
    createSettlementSnapshot({
      trade: tradeFixture({ state: 'usdc_escrow_confirmed' }),
      pearl: pearlProof({ status: 'reorged', confirmations: 0 }),
      base: baseEvent({ status: 'deposited' }),
      now: NOW,
    }),
    NOW,
  );
  const baseReleasedFirst = createSettlementDecisionRecord(
    createSettlementSnapshot({
      trade: tradeFixture({ state: 'usdc_escrow_confirmed' }),
      pearl: pearlProof({ status: 'confirmed' }),
      base: baseEvent({ status: 'released' }),
      now: NOW,
    }),
    NOW,
  );

  assert.equal(staleBase.action, 'manual_review');
  assert.equal(staleBase.toState, 'failed_manual_review');
  assert.equal(unknownPearlSpend.action, 'manual_review');
  assert.equal(reorgedPearlFunding.action, 'manual_review');
  assert.notEqual(reorgedPearlFunding.action, 'prepare_prl_release');
  assert.equal(baseReleasedFirst.action, 'manual_review');
  assert.match(baseReleasedFirst.reason, /Base USDC was released before PRL release confirmation/);
});

test('prepares PRL refund only after refund availability when USDC was never deposited', () => {
  const beforeDeadline = createSettlementDecisionRecord(
    createSettlementSnapshot({
      trade: tradeFixture({
        state: 'pearl_escrow_confirmed',
        refundAvailableAt: '2026-05-17T18:30:00.000Z',
      }),
      pearl: pearlProof({ status: 'confirmed' }),
      base: baseEvent({ status: 'created' }),
      now: NOW,
    }),
    NOW,
  );
  const afterDeadline = createSettlementDecisionRecord(
    createSettlementSnapshot({
      trade: tradeFixture({
        state: 'pearl_escrow_confirmed',
        refundAvailableAt: '2026-05-17T17:30:00.000Z',
      }),
      pearl: pearlProof({ status: 'confirmed' }),
      base: baseEvent({ status: 'created' }),
      now: NOW,
    }),
    NOW,
  );

  assert.equal(beforeDeadline.action, 'wait');
  assert.equal(afterDeadline.action, 'prepare_prl_refund');
  assert.equal(afterDeadline.toState, 'refund_pending');
});

test('enforces PRL release guard across state, deadlines, confirmations, and deposited USDC', () => {
  const allowed = createSettlementDecisionRecord(
    createSettlementSnapshot({
      trade: tradeFixture({ state: 'usdc_escrow_confirmed' }),
      pearl: pearlProof({ status: 'confirmed', confirmations: 6, observedAt: '2026-05-17T16:50:00.000Z' }),
      base: baseEvent({ status: 'deposited', confirmations: 12 }),
      now: NOW,
    }),
    NOW,
  );
  const underconfirmed = createSettlementDecisionRecord(
    createSettlementSnapshot({
      trade: tradeFixture({ state: 'usdc_escrow_confirmed' }),
      pearl: pearlProof({ status: 'confirmed', confirmations: 5, observedAt: '2026-05-17T16:50:00.000Z' }),
      base: baseEvent({ status: 'deposited', confirmations: 12 }),
      now: NOW,
    }),
    NOW,
  );
  const wrongState = createSettlementDecisionRecord(
    createSettlementSnapshot({
      trade: tradeFixture({ state: 'pearl_escrow_confirmed' }),
      pearl: pearlProof({ status: 'confirmed', confirmations: 6, observedAt: '2026-05-17T16:50:00.000Z' }),
      base: baseEvent({ status: 'deposited', confirmations: 12 }),
      now: NOW,
    }),
    NOW,
  );
  const lateObserved = createSettlementDecisionRecord(
    createSettlementSnapshot({
      trade: tradeFixture({ state: 'usdc_escrow_confirmed' }),
      pearl: pearlProof({ status: 'confirmed', confirmations: 6, observedAt: '2026-05-17T17:05:00.000Z' }),
      base: baseEvent({ status: 'deposited', confirmations: 12 }),
      now: NOW,
    }),
    NOW,
  );

  assert.equal(allowed.action, 'prepare_prl_release');
  assert.equal(underconfirmed.action, 'wait');
  assert.equal(wrongState.action, 'wait');
  assert.equal(lateObserved.action, 'manual_review');
  assert.match(lateObserved.reason, /after the funding deadline/);
});

test('never releases PRL when buyer refunded USDC and seller funds Pearl late', () => {
  const decision = createSettlementDecisionRecord(
    createSettlementSnapshot({
      trade: tradeFixture({ state: 'usdc_refunded' }),
      pearl: pearlProof({ status: 'late', confirmations: 6, observedAt: '2026-05-17T17:45:00.000Z' }),
      base: baseEvent({ status: 'refunded', confirmations: 12 }),
      now: NOW,
    }),
    NOW,
  );

  assert.equal(decision.action, 'manual_review');
  assert.notEqual(decision.action, 'prepare_prl_release');
});

test('keeps USDC escrowed when PRL release broadcast failed', () => {
  const decision = createSettlementDecisionRecord(
    createSettlementSnapshot({
      trade: tradeFixture({ state: 'prl_release_failed' }),
      pearl: pearlProof({ status: 'confirmed', confirmations: 6, observedAt: '2026-05-17T16:50:00.000Z' }),
      base: baseEvent({ status: 'deposited', confirmations: 12 }),
      now: NOW,
    }),
    NOW,
  );

  assert.equal(decision.action, 'manual_review');
  assert.notEqual(decision.action, 'prepare_usdc_release');
});

test('prepares USDC release exactly once after PRL release despite duplicate observations', async () => {
  const repository = new InMemorySettlementDecisionRepository();
  const snapshot = createSettlementSnapshot({
    trade: tradeFixture({ state: 'release_pending' }),
    pearl: pearlProof({ status: 'released', sourceEventId: 'pearl:release:tx3', confirmations: 6 }),
    base: baseEvent({ status: 'deposited', sourceEventId: 'base:deposit:0x333', confirmations: 12 }),
    now: NOW,
  });

  const first = await recordSettlementDecision(repository, snapshot, NOW);
  const duplicate = await recordSettlementDecision(repository, snapshot, new Date('2026-05-17T18:10:00.000Z'));

  assert.equal(first.created, true);
  assert.equal(first.decision.action, 'prepare_usdc_release');
  assert.equal(first.decision.toState, undefined);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.decision.decisionId, first.decision.decisionId);
});

function pearlProof(overrides: Partial<Parameters<typeof createSettlementSnapshot>[0]['pearl']> = {}) {
  return {
    status: 'confirmed' as const,
    sourceEventId: 'pearl:event',
    confirmations: 6,
    observedAt: '2026-05-17T16:50:00.000Z',
    ...overrides,
  };
}

function baseEvent(overrides: Partial<Parameters<typeof createSettlementSnapshot>[0]['base']> = {}) {
  return {
    status: 'deposited' as const,
    sourceEventId: 'base:event',
    confirmations: 12,
    observedAt: '2026-05-17T17:51:00.000Z',
    ...overrides,
  };
}

function tradeFixture(
  overrides: Partial<Pick<OtcTrade, 'state'> & { refundAvailableAt: string }> = {},
): OtcTrade {
  const refundAvailableAt = overrides.refundAvailableAt ?? '2026-05-17T17:30:00.000Z';
  return {
    tradeId: 'trade-settlement-1',
    quoteId: 'quote-settlement-1',
    state: overrides.state ?? 'pearl_escrow_confirmed',
    side: 'buy_prl',
    amountPrl: '500.00000000',
    amountUsdc: '85.000000',
    feePrl: '0.00000000',
    feeUsdc: '0.000000',
    buyerPearlAddress: 'tprl1pbuyer',
    buyerUsdcAddress: '0x1111111111111111111111111111111111111111',
    sellerPearlRefundAddress: 'tprl1pseller',
    sellerUsdcReceiveAddress: '0x2222222222222222222222222222222222222222',
    pearlEscrow: {
      network: 'testnet2',
      address: 'tprl1pescrow',
      expectedAmountGrains: '50000000000',
      requiredConfirmations: 6,
      fundingOutpoint: 'tx1:0',
    },
    usdcEscrow: {
      network: 'base',
      chainId: 84532,
      contract: '0x3333333333333333333333333333333333333333',
      usdcToken: '0x4444444444444444444444444444444444444444',
      tradeKey: '0x' + '55'.repeat(32),
      expectedAmountMicros: '85000000',
      requiredConfirmations: 12,
      expiresAt: '2026-05-17T17:30:00.000Z',
    },
    deadlines: {
      quoteExpiresAt: '2026-05-17T16:30:00.000Z',
      pearlFundingDeadline: '2026-05-17T17:00:00.000Z',
      usdcDepositDeadline: '2026-05-17T17:30:00.000Z',
      settlementDeadline: '2026-05-17T19:00:00.000Z',
      refundAvailableAt,
    },
    createdAt: '2026-05-17T16:00:00.000Z',
    updatedAt: '2026-05-17T17:45:00.000Z',
  };
}
