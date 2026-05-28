import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryOtcRepository } from '../src/repository.ts';
import { OtcTradeService, type OrderPrefundFundingProof, type OrderPrefundObserver } from '../src/trade-service.ts';
import type { OtcApiConfig, OtcOrder } from '../src/types.ts';

const NOW = new Date('2026-05-28T20:00:00.000Z');

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

function makePendingOrder(overrides: Partial<OtcOrder> = {}): OtcOrder {
  const created = '2026-05-28T19:00:00.000Z';
  return {
    orderId: `order-${Math.random().toString(36).slice(2, 10)}`,
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
    createdAt: created,
    updatedAt: created,
    prefundMode: 'auto_sweep',
    prefundState: 'pending_funding',
    prefundEscrowAddress: 'tprl1pprefund',
    prefundRefundEligibleAfterUnixTime: Math.floor(NOW.getTime() / 1000) + 3600,
    ...overrides,
  };
}

class StaticObserver implements OrderPrefundObserver {
  private readonly responses: Map<string, OrderPrefundFundingProof | Error>;
  constructor(responses: Map<string, OrderPrefundFundingProof | Error>) {
    this.responses = responses;
  }
  async observeOrderPrefund(order: OtcOrder): Promise<OrderPrefundFundingProof> {
    const r = this.responses.get(order.orderId);
    if (r instanceof Error) throw r;
    if (!r) return { confirmations: 0, spent: false };
    return r;
  }
}

let allocationCounter = 0;
async function seedAllocation(repo: InMemoryOtcRepository, orderId: string): Promise<void> {
  allocationCounter += 1;
  await repo.reserveOrderPrefundAllocation({
    orderId,
    allocatorKey: 'test',
    derivationPrefix: '1',
    derivationIndex: allocationCounter,
    derivationPath: `m/1/${allocationCounter}`,
    escrowAddress: `tprl1pprefund-${allocationCounter}`,
    internalPubkeyHex: '11'.repeat(32),
    taprootOutputScriptHex: `5120${'22'.repeat(32)}`,
    scriptLeaves: [],
    signerPubkeys: { maker: '33'.repeat(32), operator: '44'.repeat(32), arbiter: '55'.repeat(32) },
  });
}

test('observer transitions pending_funding → funded when indexer reports a fully-funded unspent outpoint', async () => {
  const repo = new InMemoryOtcRepository();
  const order = makePendingOrder();
  await repo.saveOrder(order);
  await seedAllocation(repo, order.orderId);
  const service = new OtcTradeService(repo, config, undefined, () => NOW);
  const observer = new StaticObserver(new Map([
    [order.orderId, { fundingOutpoint: 'tx1:0', observedAmountGrains: '10000000000', confirmations: 5, spent: false }],
  ]));
  const result = await service.runPrefundFundingObserverIteration(observer);
  assert.equal(result.scanned, 1);
  assert.deepEqual(result.funded, [order.orderId]);
  assert.equal(result.expired.length, 0);
  const updated = await repo.findOrderById(order.orderId);
  assert.equal(updated?.prefundState, 'funded');
  assert.equal(updated?.prefundFundedOutpoint, 'tx1:0');
  assert.equal(updated?.prefundFundedGrains, '10000000000');
  assert.equal(updated?.prefundRemainingGrains, '10000000000');
  assert.equal(updated?.prefundFundedAt, NOW.toISOString());
});

test('observer does NOT transition on under-funded observation (waits for top-up or expiry)', async () => {
  const repo = new InMemoryOtcRepository();
  const order = makePendingOrder();
  await repo.saveOrder(order);
  await seedAllocation(repo, order.orderId);
  const service = new OtcTradeService(repo, config, undefined, () => NOW);
  const observer = new StaticObserver(new Map([
    [order.orderId, { fundingOutpoint: 'tx1:0', observedAmountGrains: '5000000000', confirmations: 5, spent: false }],
  ]));
  const result = await service.runPrefundFundingObserverIteration(observer);
  assert.equal(result.funded.length, 0);
  assert.equal(result.expired.length, 0);
  const updated = await repo.findOrderById(order.orderId);
  assert.equal(updated?.prefundState, 'pending_funding');
});

test('observer does NOT transition while confirmations are 0', async () => {
  const repo = new InMemoryOtcRepository();
  const order = makePendingOrder();
  await repo.saveOrder(order);
  await seedAllocation(repo, order.orderId);
  const service = new OtcTradeService(repo, config, undefined, () => NOW);
  const observer = new StaticObserver(new Map([
    [order.orderId, { fundingOutpoint: 'tx1:0', observedAmountGrains: '10000000000', confirmations: 0, spent: false }],
  ]));
  const result = await service.runPrefundFundingObserverIteration(observer);
  assert.equal(result.funded.length, 0);
  const updated = await repo.findOrderById(order.orderId);
  assert.equal(updated?.prefundState, 'pending_funding');
});

test('observer does NOT transition when indexer reports the outpoint already spent', async () => {
  const repo = new InMemoryOtcRepository();
  const order = makePendingOrder();
  await repo.saveOrder(order);
  await seedAllocation(repo, order.orderId);
  const service = new OtcTradeService(repo, config, undefined, () => NOW);
  const observer = new StaticObserver(new Map([
    [order.orderId, { fundingOutpoint: 'tx1:0', observedAmountGrains: '10000000000', confirmations: 5, spent: true }],
  ]));
  const result = await service.runPrefundFundingObserverIteration(observer);
  assert.equal(result.funded.length, 0);
  const updated = await repo.findOrderById(order.orderId);
  assert.equal(updated?.prefundState, 'pending_funding');
});

test('observer transitions pending_funding → expired when CLTV refund window is past and no funding is observed', async () => {
  const repo = new InMemoryOtcRepository();
  const order = makePendingOrder({
    prefundRefundEligibleAfterUnixTime: Math.floor(NOW.getTime() / 1000) - 60, // already past
  });
  await repo.saveOrder(order);
  await seedAllocation(repo, order.orderId);
  const service = new OtcTradeService(repo, config, undefined, () => NOW);
  const observer = new StaticObserver(new Map([
    [order.orderId, { confirmations: 0, spent: false }],
  ]));
  const result = await service.runPrefundFundingObserverIteration(observer);
  assert.deepEqual(result.expired, [order.orderId]);
  const updated = await repo.findOrderById(order.orderId);
  assert.equal(updated?.prefundState, 'expired');
  assert.equal(updated?.status, 'expired');
});

test('observer marks order errored when allocation is missing (defense-in-depth)', async () => {
  const repo = new InMemoryOtcRepository();
  const order = makePendingOrder();
  await repo.saveOrder(order);
  // intentionally NOT seeding allocation
  const service = new OtcTradeService(repo, config, undefined, () => NOW);
  const observer = new StaticObserver(new Map([
    [order.orderId, { fundingOutpoint: 'tx1:0', observedAmountGrains: '10000000000', confirmations: 5, spent: false }],
  ]));
  const result = await service.runPrefundFundingObserverIteration(observer);
  assert.equal(result.funded.length, 0);
  assert.equal(result.errored.length, 1);
  assert.equal(result.errored[0]?.orderId, order.orderId);
});

test('observer continues other orders when one throws', async () => {
  const repo = new InMemoryOtcRepository();
  const a = makePendingOrder({ orderId: 'order-a' });
  const b = makePendingOrder({ orderId: 'order-b' });
  await repo.saveOrder(a);
  await repo.saveOrder(b);
  await seedAllocation(repo, 'order-a');
  await seedAllocation(repo, 'order-b');
  const service = new OtcTradeService(repo, config, undefined, () => NOW);
  const observer = new StaticObserver(new Map<string, OrderPrefundFundingProof | Error>([
    ['order-a', new Error('indexer unreachable')],
    ['order-b', { fundingOutpoint: 'tx1:0', observedAmountGrains: '10000000000', confirmations: 5, spent: false }],
  ]));
  const result = await service.runPrefundFundingObserverIteration(observer);
  assert.equal(result.scanned, 2);
  assert.deepEqual(result.funded, ['order-b']);
  assert.equal(result.errored.length, 1);
  assert.equal(result.errored[0]?.orderId, 'order-a');
});

test('listOrdersByPrefundState only returns orders in the requested state', async () => {
  const repo = new InMemoryOtcRepository();
  const pending = makePendingOrder({ orderId: 'order-pending' });
  const funded = makePendingOrder({ orderId: 'order-funded', prefundState: 'funded' });
  await repo.saveOrder(pending);
  await repo.saveOrder(funded);
  const pendingList = await repo.listOrdersByPrefundState('pending_funding');
  const fundedList = await repo.listOrdersByPrefundState('funded');
  assert.deepEqual(pendingList.map((o) => o.orderId), ['order-pending']);
  assert.deepEqual(fundedList.map((o) => o.orderId), ['order-funded']);
});
