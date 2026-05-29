import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryOtcRepository } from '../src/repository.ts';
import { OtcTradeService, type PrefundRefundPsbtBuilder } from '../src/trade-service.ts';
import type { OtcApiConfig, OtcOrder } from '../src/types.ts';

const NOW = new Date('2026-05-29T20:00:00.000Z');
const PAST_CLTV = Math.floor(NOW.getTime() / 1000) - 3600;
const FUTURE_CLTV = Math.floor(NOW.getTime() / 1000) + 3600;

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
  feeBps: 0,
  pearlEscrowConfirmations: 3,
  baseEscrowContract: '0x0000000000000000000000000000000000000000',
  baseNetwork: 'base_sepolia',
  supportAlertRateLimitWindowMs: 10 * 60 * 1000,
  supportAlertRateLimitMax: 5,
};

const order: OtcOrder = {
  orderId: 'order-refund-1',
  makerUserId: 'user-1',
  side: 'sell_prl',
  fundingAsset: 'PRL',
  makerPearlAddress: 'tprl1pmaker',
  makerUsdcAddress: '0x1111111111111111111111111111111111111111',
  makerPearlPubkey: 'aa'.repeat(32),
  makerPearlPubkeyProof: 'bb'.repeat(64),
  pearlReleaseSigningMode: 'preauthorize_release',
  amountPrl: '100.00000000',
  remainingPrl: '100.00000000',
  priceUsdcPerPrl: '0.170000',
  status: 'open',
  createdAt: '2026-05-28T00:00:00.000Z',
  updatedAt: '2026-05-28T00:00:00.000Z',
  prefundMode: 'auto_sweep',
  prefundState: 'funded',
  prefundEscrowAddress: 'tprl1pprefund',
  prefundFundedOutpoint: 'fundingtx:0',
  prefundFundedGrains: '10000000000',
  prefundRemainingGrains: '10000000000',
  prefundRefundEligibleAfterUnixTime: PAST_CLTV,
};

class FakeRefundBuilder implements PrefundRefundPsbtBuilder {
  receivedLiveOutpoint: string | undefined;
  async buildRefundPsbt(input: { liveOutpoint: string }): Promise<{ psbtBase64: string; feeGrains: string }> {
    this.receivedLiveOutpoint = input.liveOutpoint;
    return { psbtBase64: 'refund-psbt-base64', feeGrains: '10000' };
  }
}

test('requestPrefundRefund transitions funded → refund_pending and returns PSBT when CLTV satisfied', async () => {
  const repo = new InMemoryOtcRepository();
  await repo.saveOrder(order);
  const service = new OtcTradeService(repo, config, undefined, () => NOW);
  const result = await service.requestPrefundRefund({
    orderId: order.orderId,
    refundPsbtBuilder: new FakeRefundBuilder(),
  });
  assert.equal(result.order.prefundState, 'refund_pending');
  assert.equal(result.refundPsbtBase64, 'refund-psbt-base64');
  assert.equal(result.remainingGrains, '10000000000');
});

test('requestPrefundRefund works on partially_swept orders for the remaining grains', async () => {
  const repo = new InMemoryOtcRepository();
  await repo.saveOrder({
    ...order,
    prefundState: 'partially_swept',
    prefundRemainingGrains: '3000000000',
  });
  const service = new OtcTradeService(repo, config, undefined, () => NOW);
  const result = await service.requestPrefundRefund({
    orderId: order.orderId,
    refundPsbtBuilder: new FakeRefundBuilder(),
  });
  assert.equal(result.order.prefundState, 'refund_pending');
  assert.equal(result.remainingGrains, '3000000000');
});

test('requestPrefundRefund rejects when CLTV not yet satisfied', async () => {
  const repo = new InMemoryOtcRepository();
  await repo.saveOrder({ ...order, prefundRefundEligibleAfterUnixTime: FUTURE_CLTV });
  const service = new OtcTradeService(repo, config, undefined, () => NOW);
  await assert.rejects(
    () =>
      service.requestPrefundRefund({
        orderId: order.orderId,
        refundPsbtBuilder: new FakeRefundBuilder(),
      }),
    /not yet eligible/,
  );
});

test('requestPrefundRefund rejects when prefundRemainingGrains is zero', async () => {
  const repo = new InMemoryOtcRepository();
  await repo.saveOrder({ ...order, prefundState: 'fully_swept', prefundRemainingGrains: '0' });
  const service = new OtcTradeService(repo, config, undefined, () => NOW);
  await assert.rejects(
    () =>
      service.requestPrefundRefund({
        orderId: order.orderId,
        refundPsbtBuilder: new FakeRefundBuilder(),
      }),
    /not eligible for refund/,
  );
});

test('requestPrefundRefund rejects orders in non-eligible states', async () => {
  const repo = new InMemoryOtcRepository();
  await repo.saveOrder({ ...order, prefundState: 'pending_funding' });
  const service = new OtcTradeService(repo, config, undefined, () => NOW);
  await assert.rejects(
    () =>
      service.requestPrefundRefund({
        orderId: order.orderId,
        refundPsbtBuilder: new FakeRefundBuilder(),
      }),
    /not eligible for refund/,
  );
});

test('recordPrefundRefunded transitions refund_pending → refunded + cancels the order', async () => {
  const repo = new InMemoryOtcRepository();
  await repo.saveOrder({ ...order, prefundState: 'refund_pending' });
  const service = new OtcTradeService(repo, config, undefined, () => NOW);
  const updated = await service.recordPrefundRefunded({
    orderId: order.orderId,
    refundTxid: 'refundtx1',
  });
  assert.equal(updated.prefundState, 'refunded');
  assert.equal(updated.prefundRefundTxid, 'refundtx1');
  assert.equal(updated.status, 'cancelled');
});

test('recordPrefundRefunded rejects orders not in refund_pending', async () => {
  const repo = new InMemoryOtcRepository();
  await repo.saveOrder(order);
  const service = new OtcTradeService(repo, config, undefined, () => NOW);
  await assert.rejects(
    () => service.recordPrefundRefunded({ orderId: order.orderId, refundTxid: 'tx' }),
    /not in refund_pending/,
  );
});

// ---------- L-PR-2: liveOutpoint is the latest sweep's change_outpoint ----------

test('requestPrefundRefund passes prefundFundedOutpoint when no sweeps have occurred', async () => {
  const repo = new InMemoryOtcRepository();
  await repo.saveOrder(order);
  const service = new OtcTradeService(repo, config, undefined, () => NOW);
  const builder = new FakeRefundBuilder();
  await service.requestPrefundRefund({ orderId: order.orderId, refundPsbtBuilder: builder });
  assert.equal(builder.receivedLiveOutpoint, 'fundingtx:0');
});

test('requestPrefundRefund passes the latest confirmed sweep change_outpoint as live UTXO', async () => {
  const repo = new InMemoryOtcRepository();
  await repo.saveOrder({ ...order, prefundState: 'partially_swept', prefundRemainingGrains: '3000000000' });
  // Two sweeps: first confirmed with change, second still pending (should be ignored).
  await repo.saveOrderSweep({
    sweepId: 'sweep-1', orderId: order.orderId, tradeId: 'trade-1',
    inputOutpoint: 'fundingtx:0', sweptGrains: '4000000000',
    changeOutpoint: 'sweep1tx:1', changeGrains: '6000000000',
    status: 'broadcast',
  });
  await repo.updateOrderSweep({ sweepId: 'sweep-1', status: 'confirmed', updatedAt: NOW.toISOString() });
  await repo.saveOrderSweep({
    sweepId: 'sweep-2', orderId: order.orderId, tradeId: 'trade-2',
    inputOutpoint: 'sweep1tx:1', sweptGrains: '3000000000',
    changeOutpoint: 'sweep2tx:1', changeGrains: '3000000000',
    status: 'pending', // NOT confirmed; should NOT be picked as live
  });
  const service = new OtcTradeService(repo, config, undefined, () => NOW);
  const builder = new FakeRefundBuilder();
  await service.requestPrefundRefund({ orderId: order.orderId, refundPsbtBuilder: builder });
  // Should use the confirmed sweep's change_outpoint, NOT the unconfirmed one and NOT the original funding.
  assert.equal(builder.receivedLiveOutpoint, 'sweep1tx:1');
});

// ---------- L-PR-1: CLTV-cutoff for funded/partially_swept orders ----------

test('runPrefundCltvCutoffIteration cancels funded orders past CLTV', async () => {
  const repo = new InMemoryOtcRepository();
  await repo.saveOrder({ ...order, prefundRefundEligibleAfterUnixTime: PAST_CLTV });
  const service = new OtcTradeService(repo, config, undefined, () => NOW);
  const result = await service.runPrefundCltvCutoffIteration();
  assert.deepEqual(result.cancelled, [order.orderId]);
  const updated = await repo.findOrderById(order.orderId);
  assert.equal(updated?.status, 'cancelled');
  // prefund_state stays funded so the maker can still requestPrefundRefund.
  assert.equal(updated?.prefundState, 'funded');
});

test('runPrefundCltvCutoffIteration leaves funded orders BEFORE CLTV alone', async () => {
  const repo = new InMemoryOtcRepository();
  await repo.saveOrder({ ...order, prefundRefundEligibleAfterUnixTime: FUTURE_CLTV });
  const service = new OtcTradeService(repo, config, undefined, () => NOW);
  const result = await service.runPrefundCltvCutoffIteration();
  assert.deepEqual(result.cancelled, []);
  const updated = await repo.findOrderById(order.orderId);
  assert.equal(updated?.status, 'open');
});

test('runPrefundCltvCutoffIteration is idempotent on already-cancelled orders', async () => {
  const repo = new InMemoryOtcRepository();
  await repo.saveOrder({
    ...order,
    prefundRefundEligibleAfterUnixTime: PAST_CLTV,
    status: 'cancelled',
  });
  const service = new OtcTradeService(repo, config, undefined, () => NOW);
  const result = await service.runPrefundCltvCutoffIteration();
  // Already cancelled — skipped, not counted as cancelled in this iteration.
  assert.deepEqual(result.cancelled, []);
});

test('runPrefundCltvCutoffIteration scans both funded AND partially_swept orders', async () => {
  const repo = new InMemoryOtcRepository();
  await repo.saveOrder({
    ...order,
    orderId: 'order-funded',
    prefundState: 'funded',
    prefundRefundEligibleAfterUnixTime: PAST_CLTV,
  });
  await repo.saveOrder({
    ...order,
    orderId: 'order-partial',
    prefundState: 'partially_swept',
    prefundRefundEligibleAfterUnixTime: PAST_CLTV,
  });
  const service = new OtcTradeService(repo, config, undefined, () => NOW);
  const result = await service.runPrefundCltvCutoffIteration();
  assert.deepEqual(result.cancelled.sort(), ['order-funded', 'order-partial']);
});
