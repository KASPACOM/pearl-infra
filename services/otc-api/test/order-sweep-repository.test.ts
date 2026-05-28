import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryOtcRepository } from '../src/repository.ts';
import { OtcTradeService } from '../src/trade-service.ts';
import type { OtcApiConfig, OtcOrder, SaveOrderSweepInput } from '../src/types.ts';

const NOW = new Date('2026-05-28T20:00:00.000Z');
const baseConfig: OtcApiConfig = {
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

const baseOrder: OtcOrder = {
  orderId: 'order-sweep-1',
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
  prefundFundedAt: '2026-05-28T00:30:00.000Z',
};

function sweepInput(overrides: Partial<SaveOrderSweepInput> = {}): SaveOrderSweepInput {
  return {
    sweepId: 'sweep-1',
    orderId: 'order-sweep-1',
    tradeId: 'trade-sweep-1',
    inputOutpoint: 'fundingtx:0',
    sweptGrains: '5000000000',
    changeOutpoint: 'sweeptx:1',
    changeGrains: '5000000000',
    status: 'pending',
    ...overrides,
  };
}

test('saveOrderSweep persists a pending sweep and findOrderSweepByTradeId round-trips it', async () => {
  const repo = new InMemoryOtcRepository();
  const saved = await repo.saveOrderSweep(sweepInput());
  assert.equal(saved.status, 'pending');
  assert.equal(saved.sweptGrains, '5000000000');
  assert.equal(saved.changeOutpoint, 'sweeptx:1');
  const found = await repo.findOrderSweepByTradeId('trade-sweep-1');
  assert.equal(found?.sweepId, 'sweep-1');
});

test('saveOrderSweep rejects duplicate sweep for the same trade_id (UNIQUE)', async () => {
  const repo = new InMemoryOtcRepository();
  await repo.saveOrderSweep(sweepInput());
  await assert.rejects(
    () => repo.saveOrderSweep(sweepInput({ sweepId: 'sweep-2' })),
    /already exists/,
  );
});

test('updateOrderSweep transitions status and stores the broadcast txid', async () => {
  const repo = new InMemoryOtcRepository();
  await repo.saveOrderSweep(sweepInput());
  const updated = await repo.updateOrderSweep({
    sweepId: 'sweep-1',
    status: 'broadcast',
    sweepTxid: 'broadcasttx',
    updatedAt: '2026-05-28T01:00:00.000Z',
  });
  assert.equal(updated.status, 'broadcast');
  assert.equal(updated.sweepTxid, 'broadcasttx');
});

test('updateOrderSweep is partial (existing fields preserved when input is undefined)', async () => {
  const repo = new InMemoryOtcRepository();
  await repo.saveOrderSweep(sweepInput({ sweepPsbtBase64: 'cHNidP8BAAA=' }));
  const updated = await repo.updateOrderSweep({
    sweepId: 'sweep-1',
    status: 'broadcast',
    updatedAt: '2026-05-28T01:00:00.000Z',
  });
  assert.equal(updated.sweepPsbtBase64, 'cHNidP8BAAA=');
  assert.equal(updated.status, 'broadcast');
});

test('applyOrderPrefundSweepProgress decrements remaining grains and transitions to partially_swept', async () => {
  const repo = new InMemoryOtcRepository();
  await repo.saveOrder(baseOrder);
  const updated = await repo.applyOrderPrefundSweepProgress({
    orderId: 'order-sweep-1',
    sweptGrains: '5000000000',
    newRemainingGrains: '5000000000',
    newState: 'partially_swept',
    updatedAt: '2026-05-28T01:00:00.000Z',
  });
  assert.equal(updated.prefundState, 'partially_swept');
  assert.equal(updated.prefundRemainingGrains, '5000000000');
});

test('applyOrderPrefundSweepProgress transitions to fully_swept', async () => {
  const repo = new InMemoryOtcRepository();
  await repo.saveOrder(baseOrder);
  const updated = await repo.applyOrderPrefundSweepProgress({
    orderId: 'order-sweep-1',
    sweptGrains: '10000000000',
    newRemainingGrains: '0',
    newState: 'fully_swept',
    updatedAt: '2026-05-28T01:00:00.000Z',
  });
  assert.equal(updated.prefundState, 'fully_swept');
  assert.equal(updated.prefundRemainingGrains, '0');
});

test('applyOrderPrefundSweepProgress rejects when order is in a non-eligible state', async () => {
  const repo = new InMemoryOtcRepository();
  await repo.saveOrder({ ...baseOrder, prefundState: 'pending_funding' });
  await assert.rejects(
    () =>
      repo.applyOrderPrefundSweepProgress({
        orderId: 'order-sweep-1',
        sweptGrains: '5000000000',
        newRemainingGrains: '5000000000',
        newState: 'partially_swept',
        updatedAt: '2026-05-28T01:00:00.000Z',
      }),
    /not eligible for sweep progress/,
  );
});

test('listOrderSweepsByOrderId returns sweeps ordered by createdAt', async () => {
  const repo = new InMemoryOtcRepository();
  await repo.saveOrderSweep(sweepInput({ sweepId: 'sweep-a', tradeId: 'trade-a' }));
  await new Promise((r) => setTimeout(r, 5));
  await repo.saveOrderSweep(sweepInput({ sweepId: 'sweep-b', tradeId: 'trade-b' }));
  const sweeps = await repo.listOrderSweepsByOrderId('order-sweep-1');
  assert.deepEqual(sweeps.map((s) => s.sweepId), ['sweep-a', 'sweep-b']);
});

// ---------- initiateOrderSweep ----------

test('initiateOrderSweep (Mode A) creates pending sweep + transitions order to partially_swept', async () => {
  const repo = new InMemoryOtcRepository();
  await repo.saveOrder(baseOrder);
  const service = new OtcTradeService(repo, baseConfig, undefined, () => NOW);
  const { sweep, order: updated } = await service.initiateOrderSweep({
    sweepId: 'sweep-A',
    order: baseOrder,
    tradeId: 'trade-A',
    sweptGrains: '3000000000',
  });
  assert.equal(sweep.status, 'pending'); // Mode A
  assert.equal(updated.prefundState, 'partially_swept');
  assert.equal(updated.prefundRemainingGrains, '7000000000');
});

test('initiateOrderSweep (Mode B) creates awaiting_maker_signature sweep', async () => {
  const repo = new InMemoryOtcRepository();
  const modeB: OtcOrder = { ...baseOrder, prefundMode: 'manual_confirm' };
  await repo.saveOrder(modeB);
  const service = new OtcTradeService(repo, baseConfig, undefined, () => NOW);
  const { sweep } = await service.initiateOrderSweep({
    sweepId: 'sweep-B',
    order: modeB,
    tradeId: 'trade-B',
    sweptGrains: '3000000000',
  });
  assert.equal(sweep.status, 'awaiting_maker_signature');
});

test('initiateOrderSweep transitions to fully_swept when the whole remaining is consumed', async () => {
  const repo = new InMemoryOtcRepository();
  await repo.saveOrder(baseOrder);
  const service = new OtcTradeService(repo, baseConfig, undefined, () => NOW);
  const { order: updated } = await service.initiateOrderSweep({
    sweepId: 'sweep-full',
    order: baseOrder,
    tradeId: 'trade-full',
    sweptGrains: '10000000000',
  });
  assert.equal(updated.prefundState, 'fully_swept');
  assert.equal(updated.prefundRemainingGrains, '0');
});

test('initiateOrderSweep rejects sweep larger than remaining', async () => {
  const repo = new InMemoryOtcRepository();
  await repo.saveOrder(baseOrder);
  const service = new OtcTradeService(repo, baseConfig, undefined, () => NOW);
  await assert.rejects(
    () =>
      service.initiateOrderSweep({
        sweepId: 'sweep-too-big',
        order: baseOrder,
        tradeId: 'trade-too-big',
        sweptGrains: '20000000000',
      }),
    /exceeds remaining/,
  );
});

test('initiateOrderSweep rejects orders that are not funded or partially_swept', async () => {
  const repo = new InMemoryOtcRepository();
  const pending: OtcOrder = { ...baseOrder, prefundState: 'pending_funding' };
  await repo.saveOrder(pending);
  const service = new OtcTradeService(repo, baseConfig, undefined, () => NOW);
  await assert.rejects(
    () =>
      service.initiateOrderSweep({
        sweepId: 'sweep-bad-state',
        order: pending,
        tradeId: 'trade-bad-state',
        sweptGrains: '1000000000',
      }),
    /not eligible for sweep/,
  );
});
