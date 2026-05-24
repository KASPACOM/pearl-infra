import assert from 'node:assert/strict';
import test from 'node:test';

import type { OtcTrade } from '@kaspacom/pearl-sdk';

import { InMemoryOtcRepository } from '../src/repository.ts';
import { OtcTradeService } from '../src/trade-service.ts';
import type { OtcApiConfig, OtcUser } from '../src/types.ts';

const now = '2026-05-24T12:00:00.000Z';
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
  feeBps: 100,
  pearlEscrowConfirmations: 3,
  baseEscrowContract: '0x1111111111111111111111111111111111111111',
  baseNetwork: 'base_sepolia',
  supportAlertRateLimitWindowMs: 10 * 60 * 1000,
  supportAlertRateLimitMax: 5,
  notificationDeadlineWarningWindowMs: 15 * 60 * 1000,
};

test('queues trade-status and deadline-warning emails for opted-in trade parties', async () => {
  const repo = new InMemoryOtcRepository();
  const service = new OtcTradeService(repo, config, undefined, () => new Date(now));
  const buyer = await saveVerifiedUser(repo, {
    userId: 'user_buyer',
    referralCode: 'BUYER1',
    address: trade.buyerUsdcAddress,
    email: 'buyer@example.test',
  });
  const seller = await saveVerifiedUser(repo, {
    userId: 'user_seller',
    referralCode: 'SELLER1',
    address: trade.sellerUsdcReceiveAddress,
    email: 'seller@example.test',
  });
  await repo.saveNotificationPreferences(buyer.userId, [
    { notificationType: 'trade_status', channel: 'email', enabled: true },
    { notificationType: 'deadline_warning', channel: 'email', enabled: true },
  ], now);
  await repo.saveNotificationPreferences(seller.userId, [
    { notificationType: 'trade_status', channel: 'email', enabled: true },
    { notificationType: 'deadline_warning', channel: 'email', enabled: true },
  ], now);
  await repo.saveTrade(trade, 'trade-client-1', 'sha256:trade');

  await service.transitionTrade(trade.tradeId, 'pearl_escrow_seen', 'funding-seen-1');
  const scanned = await service.enqueueDeadlineWarningNotifications();

  assert.equal(scanned, 2);
  const deliveries = await repo.listNotificationDeliveries({ status: 'pending' });
  assert.equal(deliveries.filter((delivery) => delivery.notificationType === 'trade_status').length, 2);
  assert.equal(deliveries.filter((delivery) => delivery.notificationType === 'deadline_warning').length, 2);
  assert.deepEqual(
    deliveries.map((delivery) => delivery.recipient).sort(),
    ['buyer@example.test', 'buyer@example.test', 'seller@example.test', 'seller@example.test'],
  );
});

async function saveVerifiedUser(
  repo: InMemoryOtcRepository,
  input: { userId: string; referralCode: string; address: string; email: string },
): Promise<OtcUser> {
  return repo.saveUser({
    userId: input.userId,
    referralCode: input.referralCode,
    wallet: {
      userId: input.userId,
      walletType: 'evm',
      network: 'base_sepolia',
      address: input.address,
      verifiedAt: now,
    },
    profile: {
      userId: input.userId,
      email: input.email,
      emailVerifiedAt: now,
      notificationEmailEnabled: true,
    },
  });
}

const trade: OtcTrade = {
  tradeId: 'trade_notification_1',
  quoteId: 'quote_notification_1',
  state: 'pearl_escrow_pending',
  side: 'buy_prl',
  amountPrl: '100.00000000',
  amountUsdc: '17.000000',
  feePrl: '0.00000000',
  feeUsdc: '0.170000',
  buyerPearlAddress: 'tprl1pbuyer',
  buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
  sellerPearlRefundAddress: 'tprl1psellerrefund',
  sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
  pearlEscrow: {
    network: 'testnet2',
    address: 'tprl1pescrow',
    expectedAmountGrains: '10000000000',
    requiredConfirmations: 3,
  },
  usdcEscrow: {
    network: 'base',
    chainId: 84532,
    contract: '0x1111111111111111111111111111111111111111',
    usdcToken: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    tradeKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    expectedAmountMicros: '17170000',
    requiredConfirmations: 6,
    expiresAt: '2026-05-24T12:15:00.000Z',
  },
  deadlines: {
    quoteExpiresAt: '2026-05-24T12:05:00.000Z',
    pearlFundingDeadline: '2026-05-24T12:10:00.000Z',
    usdcDepositDeadline: '2026-05-24T12:15:00.000Z',
    settlementDeadline: '2026-05-24T12:30:00.000Z',
    refundAvailableAt: '2026-05-24T12:15:00.000Z',
  },
  createdAt: now,
  updatedAt: now,
};
