import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSettlementSnapshot,
  createSettlementDecisionRecord,
  type SettlementDecisionRecord,
  executeSettlementDecision,
  type SettlementBroadcasterAdapter,
  type SettlementSignerAdapter,
  InMemorySettlementWorkerTradeSource,
} from '../dist/index.js';
import type { OtcTrade } from '@kaspacom/pearl-sdk';

// ---------- shared trade fixture ----------

function tradeFixture(overrides: Partial<OtcTrade> = {}): OtcTrade {
  return {
    tradeId: 'trade-evm-broadcaster-1',
    quoteId: 'quote-evm-broadcaster-1',
    state: 'pearl_escrow_pending',
    side: 'buy_prl',
    amountPrl: '0.10000000',
    amountUsdc: '0.017000',
    feePrl: '0.00000000',
    feeUsdc: '0.000170',
    pearlEscrowMode: 'multisig',
    pearlReleaseSigningMode: 'preauthorize_release',
    buyerPearlAddress: 'tprl1pbuyer',
    buyerUsdcAddress: '0x1111111111111111111111111111111111111111',
    sellerPearlRefundAddress: 'tprl1pseller',
    sellerUsdcReceiveAddress: '0x2222222222222222222222222222222222222222',
    pearlEscrow: {
      network: 'testnet2',
      address: 'tprl1pescrow',
      expectedAmountGrains: '10000000',
      requiredConfirmations: 1,
    },
    usdcEscrow: {
      network: 'base',
      chainId: 8453,
      contract: '0x10a49C0D27c46AA41627Bf40ed6275f8998046eF',
      usdcToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      tradeKey: '0x' + 'ab'.repeat(32),
      expectedAmountMicros: '17000',
      requiredConfirmations: 1,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
    deadlines: {
      quoteExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      pearlFundingDeadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      usdcDepositDeadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      settlementDeadline: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
      refundAvailableAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
    createdAt: new Date(Date.now() - 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 60 * 1000).toISOString(),
    ...overrides,
  };
}

// ---------- L-W-1 fix: prepare_prl_release no longer gated on usdc_escrow_confirmed state ----------

test('decision engine: prepare_prl_release fires from pearl_escrow_pending when snapshot conditions are met', () => {
  // Production has no path to transition trades through intermediate states; the
  // worker's authoritative signal is the snapshot. This test pins that we don't
  // accidentally re-introduce the trade.state precondition that would dead-lock
  // every prod trade.
  const trade = tradeFixture({ state: 'pearl_escrow_pending' });
  const snapshot = createSettlementSnapshot({
    trade,
    pearl: {
      status: 'confirmed', sourceEventId: 'p:funded', confirmations: 3,
      observedAt: new Date(Date.now() - 60_000).toISOString(),
    },
    base: {
      status: 'deposited', sourceEventId: 'b:deposited', confirmations: 10,
      observedAt: new Date(Date.now() - 30_000).toISOString(),
    },
    now: new Date(),
  });
  // The trade has multisig + preauth + presig — same auth as the existing release path.
  trade.pearlEscrow.buyerReleasePresignature = {
    psbtBase64: 'cHNidP8BAAA=', buyerPubkey: '00'.padStart(64, '0'),
    leafKind: 'buyer_arbiter_release', destinationAddress: 'tprl1pbuyer',
    outputAmountGrains: '9990000', feeGrains: '10000', fundingOutpoint: 'tx1:0',
    signedAt: new Date().toISOString(),
  };
  const decision = createSettlementDecisionRecord(snapshot);
  assert.equal(decision.action, 'prepare_prl_release');
  assert.equal(decision.toState, 'release_pending');
});

test('decision engine: terminal/already-releasing states still skip prepare_prl_release', () => {
  for (const state of ['release_pending', 'released', 'refund_pending', 'refunded'] as const) {
    const trade = tradeFixture({ state });
    trade.pearlEscrow.buyerReleasePresignature = {
      psbtBase64: 'cHNidP8BAAA=', buyerPubkey: '00'.padStart(64, '0'),
      leafKind: 'buyer_arbiter_release', destinationAddress: 'tprl1pbuyer',
      outputAmountGrains: '9990000', feeGrains: '10000', fundingOutpoint: 'tx1:0',
      signedAt: new Date().toISOString(),
    };
    const snapshot = createSettlementSnapshot({
      trade,
      pearl: { status: 'confirmed', sourceEventId: 'p', confirmations: 3, observedAt: new Date(Date.now() - 60_000).toISOString() },
      base: { status: 'deposited', sourceEventId: 'b', confirmations: 10, observedAt: new Date(Date.now() - 30_000).toISOString() },
      now: new Date(),
    });
    const decision = createSettlementDecisionRecord(snapshot);
    assert.notEqual(decision.action, 'prepare_prl_release', `state ${state} should not re-trigger release`);
  }
});

// ---------- decision engine emits prepare_base_create_trade ----------

test('decision engine: emits prepare_base_create_trade when Pearl escrow allocated but Base trade does not exist', () => {
  const trade = tradeFixture({ state: 'pearl_escrow_pending' });
  const snapshot = createSettlementSnapshot({
    trade,
    pearl: { status: 'missing', sourceEventId: 'p:missing', confirmations: 0, observedAt: new Date(0).toISOString() },
    base: { status: 'none', sourceEventId: 'b:none', confirmations: 0, observedAt: new Date(0).toISOString() },
    now: new Date(),
  });
  assert.equal(createSettlementDecisionRecord(snapshot).action, 'prepare_base_create_trade');
});

test('decision engine: does NOT emit prepare_base_create_trade when Base already created', () => {
  const trade = tradeFixture({ state: 'pearl_escrow_pending' });
  const snapshot = createSettlementSnapshot({
    trade,
    pearl: { status: 'missing', sourceEventId: 'p:missing', confirmations: 0, observedAt: new Date(0).toISOString() },
    base: { status: 'created', sourceEventId: 'b:created', confirmations: 0, observedAt: new Date(0).toISOString() },
    now: new Date(),
  });
  assert.notEqual(createSettlementDecisionRecord(snapshot).action, 'prepare_base_create_trade');
});

test('decision engine: skips prepare_base_create_trade past usdcDepositDeadline', () => {
  const trade = tradeFixture({
    state: 'pearl_escrow_pending',
    deadlines: {
      quoteExpiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      pearlFundingDeadline: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
      usdcDepositDeadline: new Date(Date.now() - 1 * 60 * 1000).toISOString(),  // past
      settlementDeadline: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      refundAvailableAt: new Date(Date.now() - 1 * 60 * 1000).toISOString(),
    },
  });
  const snapshot = createSettlementSnapshot({
    trade,
    pearl: { status: 'missing', sourceEventId: 'p:missing', confirmations: 0, observedAt: new Date(0).toISOString() },
    base: { status: 'none', sourceEventId: 'b:none', confirmations: 0, observedAt: new Date(0).toISOString() },
    now: new Date(),
  });
  assert.notEqual(createSettlementDecisionRecord(snapshot).action, 'prepare_base_create_trade');
});

test('decision engine: skips prepare_base_create_trade for non-multisig (legacy) trades', () => {
  const trade = tradeFixture({ state: 'pearl_escrow_pending', pearlEscrowMode: 'coordinator' });
  const snapshot = createSettlementSnapshot({
    trade,
    pearl: { status: 'missing', sourceEventId: 'p:missing', confirmations: 0, observedAt: new Date(0).toISOString() },
    base: { status: 'none', sourceEventId: 'b:none', confirmations: 0, observedAt: new Date(0).toISOString() },
    now: new Date(),
  });
  assert.notEqual(createSettlementDecisionRecord(snapshot).action, 'prepare_base_create_trade');
});

// ---------- executeSettlementDecision routes to broadcaster.prepareBaseCreateTrade ----------

test('executeSettlementDecision routes prepare_base_create_trade to the broadcaster', async () => {
  const trade = tradeFixture({ state: 'pearl_escrow_pending' });
  const tradeSource = new InMemorySettlementWorkerTradeSource([trade]);
  const signer: SettlementSignerAdapter = {
    preparePrlRelease() { throw new Error('not called'); },
    preparePrlRefund() { throw new Error('not called'); },
  };

  const createTradeCalls: OtcTrade[] = [];
  const broadcaster: SettlementBroadcasterAdapter = {
    async prepareBaseCreateTrade(t, decision) {
      createTradeCalls.push(t);
      return {
        actionId: `created_${decision.decisionId}`,
        decisionId: decision.decisionId,
        tradeId: t.tradeId,
        action: decision.action,
        status: 'prepared',
        idempotencyKey: `base:create:${t.usdcEscrow.tradeKey}`,
        createdAt: new Date().toISOString(),
        metadata: { adapter: 'test' },
      };
    },
    async prepareUsdcRelease() { throw new Error('not called'); },
  };

  const decision: SettlementDecisionRecord = {
    decisionId: 'd1',
    idempotencyKey: 'i1',
    tradeId: trade.tradeId,
    action: 'prepare_base_create_trade',
    reason: 'test',
    snapshotHash: 'h',
    sourceEventIds: [],
    createdAt: new Date().toISOString(),
    metadata: {
      tradeState: trade.state, pearlStatus: 'missing', pearlConfirmations: 0,
      baseStatus: 'none', baseConfirmations: 0,
    },
  };
  const prepared = await executeSettlementDecision({ trades: tradeSource, signer, broadcaster }, trade, decision);
  assert.equal(createTradeCalls.length, 1);
  assert.equal(prepared?.action, 'prepare_base_create_trade');
});

test('executeSettlementDecision returns undefined for prepare_base_create_trade when broadcaster lacks the method', async () => {
  const trade = tradeFixture({ state: 'pearl_escrow_pending' });
  const tradeSource = new InMemorySettlementWorkerTradeSource([trade]);
  const signer: SettlementSignerAdapter = {
    preparePrlRelease() { throw new Error('not called'); },
    preparePrlRefund() { throw new Error('not called'); },
  };
  const broadcaster: SettlementBroadcasterAdapter = {
    async prepareUsdcRelease() { throw new Error('not called'); },
  };
  const decision: SettlementDecisionRecord = {
    decisionId: 'd1', idempotencyKey: 'i1', tradeId: trade.tradeId,
    action: 'prepare_base_create_trade', reason: 'test', snapshotHash: 'h', sourceEventIds: [],
    createdAt: new Date().toISOString(),
    metadata: {
      tradeState: trade.state, pearlStatus: 'missing', pearlConfirmations: 0,
      baseStatus: 'none', baseConfirmations: 0,
    },
  };
  const prepared = await executeSettlementDecision({ trades: tradeSource, signer, broadcaster }, trade, decision);
  assert.equal(prepared, undefined);
});
