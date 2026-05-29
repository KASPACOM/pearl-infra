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
  async buildRefundPsbt(): Promise<{ psbtBase64: string; feeGrains: string }> {
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
