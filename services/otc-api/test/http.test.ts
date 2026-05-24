import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { AddressInfo } from 'node:net';

import { createPearlSignerProofMessage, type PearlReleaseSigningMode, type PearlSignerProofRole } from '@kaspacom/pearl-sdk';
import { createPearlP2trPayment } from '@kaspacom/pearl-script';
import { Wallet } from 'ethers';
import * as ecc from 'tiny-secp256k1';

import { createOtcHttpServer } from '../src/http.ts';
import { createConfiguredPearlEscrowAllocator } from '../src/pearl-escrow-allocator.ts';
import { InMemoryOtcRepository } from '../src/repository.ts';
import { OtcTradeService, type PearlEscrowAllocator, type PearlEscrowWatchRegistrar } from '../src/trade-service.ts';
import type { OtcApiConfig } from '../src/types.ts';

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
};
const adminToken = 'test-admin-token';
const adminHeaders = { authorization: `Bearer ${adminToken}` };
const operatorToken = 'test-operator-token';
const supportToken = 'test-support-token';
const operatorHeaders = { authorization: `Bearer ${operatorToken}` };
const supportHeaders = { authorization: `Bearer ${supportToken}` };
const BUYER_TESTNET_ADDRESS = 'tprl1pet7ep3czdu9k4wvdlz2fp5p8x2yp7t6ttyqg2c6cmh0lgeuu9lasga5cef';
const SELLER_TESTNET_REFUND_ADDRESS = 'tprl1pgxxyvcmdncdxs06cudd5yvmwwahaesaj6n3eu7st7x4sw9hrchaqpcq7p3';

const escrowAllocator: PearlEscrowAllocator = {
  async allocateEscrow({ tradeId, config: allocatorConfig }) {
    return {
      network: allocatorConfig.pearlNetwork,
      address: `tprl1p${tradeId.slice(-12)}`,
      expectedAmountGrains: '100000000000',
      requiredConfirmations: allocatorConfig.pearlEscrowConfirmations,
    };
  },
};

async function withServer<T>(fn: (baseUrl: string) => Promise<T>, serviceConfig: OtcApiConfig = config): Promise<T> {
  const allocator = serviceConfig.pearlEscrowAllocator === 'mock'
    ? escrowAllocator
    : createConfiguredPearlEscrowAllocator(serviceConfig);
  const watchRegistrar: PearlEscrowWatchRegistrar | undefined = serviceConfig.pearlEscrowAllocator === 'mock'
    ? undefined
    : {
        async registerPearlEscrowWatch(trade) {
          return {
            watchId: `otc:${trade.tradeId}:pearl-escrow`,
            address: trade.pearlEscrow.address,
            network: trade.pearlEscrow.network,
            requiredConfirmations: trade.pearlEscrow.requiredConfirmations,
            metadata: { trade_id: trade.tradeId },
          };
        },
      };
  const service = new OtcTradeService(
    new InMemoryOtcRepository(),
    serviceConfig,
    allocator,
    undefined,
    () => new Date('2026-05-16T12:00:00.000Z'),
    watchRegistrar,
  );
  const server = createOtcHttpServer(service, {
    adminToken,
    adminCredentials: [
      { token: adminToken, actor: 'admin-user', roles: ['admin'] },
      { token: operatorToken, actor: 'operator-user', roles: ['operator'] },
      { token: supportToken, actor: 'support-user', roles: ['support_read'] },
    ],
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function postJson(baseUrl: string, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function xOnlyPublicKey(seed: string): string {
  const privateKey = Buffer.from(seed.padStart(64, '0'), 'hex');
  const publicKey = ecc.pointFromScalar(privateKey, true);
  if (!publicKey) throw new Error(`invalid private key fixture: ${seed}`);
  return Buffer.from(publicKey).subarray(1).toString('hex');
}

function signOrderMakerProof(input: {
  makerUserId: string;
  side: 'buy_prl' | 'sell_prl';
  amountPrl: string;
  priceUsdcPerPrl: string;
  minFillPrl?: string;
  expiresAt?: string;
  makerPearlAddress: string;
  makerUsdcAddress: string;
  makerPearlPubkey: string;
  privateKeySeed: string;
}): string {
  const message = [
    'Pearl OTC order signer proof v1',
    `maker_user_id=${input.makerUserId}`,
    `side=${input.side}`,
    `amount_prl=${input.amountPrl}`,
    `price_usdc_per_prl=${input.priceUsdcPerPrl}`,
    `min_fill_prl=${input.minFillPrl ?? ''}`,
    `expires_at=${input.expiresAt ?? ''}`,
    `maker_role=${input.side === 'buy_prl' ? 'buyer' : 'seller'}`,
    `maker_pearl_address=${input.makerPearlAddress.trim()}`,
    `maker_usdc_address=${input.makerUsdcAddress.trim().toLowerCase()}`,
    `maker_pearl_pubkey=${input.makerPearlPubkey.trim().replace(/^0x/i, '').toLowerCase()}`,
    'release_signing_mode=manual_after_base_deposit',
  ].join('\n');
  const privateKey = Buffer.from(input.privateKeySeed.padStart(64, '0'), 'hex');
  return Buffer.from(ecc.signSchnorr(createHash('sha256').update(message).digest(), privateKey)).toString('hex');
}

function signQuoteSignerProof(input: {
  quoteId: string;
  role: PearlSignerProofRole;
  pearlAddress: string;
  usdcAddress: string;
  pearlPubkey: string;
  releaseSigningMode: PearlReleaseSigningMode;
  privateKeySeed: string;
}): string {
  const privateKey = Buffer.from(input.privateKeySeed.padStart(64, '0'), 'hex');
  const messageHash = createHash('sha256').update(createPearlSignerProofMessage(input)).digest();
  return Buffer.from(ecc.signSchnorr(messageHash, privateKey)).toString('hex');
}

function signUserWalletChallenge(message: string, privateKeySeed: string): string {
  const privateKey = Buffer.from(privateKeySeed.padStart(64, '0'), 'hex');
  return Buffer.from(ecc.signSchnorr(createHash('sha256').update(message).digest(), privateKey)).toString('hex');
}

test('registers wallet-owned users with referral links and wallet-proved profile updates', async () => {
  await withServer(async (baseUrl) => {
    const referrerWallet = new Wallet('0x59c6995e998f97a5a0044966f094538c5a0d9f0c7f044cd588d0d20d0368a498');
    const referredWallet = new Wallet('0x8b3a350cf5c34c9194ca6c0b3f8d6f841e252cb3f72b8636505f6dbcbf8f8531');

    const referrerChallengeResponse = await postJson(baseUrl, '/otc/users/wallet-challenges', {
      walletType: 'evm',
      network: 'base_sepolia',
      address: referrerWallet.address,
    });
    assert.equal(referrerChallengeResponse.status, 201);
    const referrerChallenge = (await referrerChallengeResponse.json()) as {
      challengeId: string;
      message: string;
      expiresAt: string;
    };
    assert.match(referrerChallenge.message, /Pearl OTC user wallet v1/);

    const unverifiedNotificationResponse = await postJson(baseUrl, '/otc/users', {
      challengeId: referrerChallenge.challengeId,
      signature: await referrerWallet.signMessage(referrerChallenge.message),
      email: 'REFERRER@EXAMPLE.COM',
      notificationEmailEnabled: true,
    });
    assert.equal(unverifiedNotificationResponse.status, 400);
    assert.match(await unverifiedNotificationResponse.text(), /verified email/);

    const retryReferrerChallengeResponse = await postJson(baseUrl, '/otc/users/wallet-challenges', {
      walletType: 'evm',
      network: 'base_sepolia',
      address: referrerWallet.address,
    });
    assert.equal(retryReferrerChallengeResponse.status, 201);
    const retryReferrerChallenge = (await retryReferrerChallengeResponse.json()) as {
      challengeId: string;
      message: string;
    };
    const referrerResponse = await postJson(baseUrl, '/otc/users', {
      challengeId: retryReferrerChallenge.challengeId,
      signature: await referrerWallet.signMessage(retryReferrerChallenge.message),
      email: 'REFERRER@EXAMPLE.COM',
      notificationEmailEnabled: false,
    });
    assert.equal(referrerResponse.status, 201);
    const referrer = (await referrerResponse.json()) as {
      userId: string;
      referralCode: string;
      wallet: { address: string };
      profile: { email: string; notificationEmailEnabled: boolean };
    };
    assert.equal(referrer.wallet.address, referrerWallet.address);
    assert.equal(referrer.profile.email, 'referrer@example.com');
    assert.equal(referrer.profile.notificationEmailEnabled, false);

    const lookupResponse = await fetch(`${baseUrl}/otc/users/referrals/${referrer.referralCode.toLowerCase()}`);
    assert.equal(lookupResponse.status, 200);
    const lookup = (await lookupResponse.json()) as { referralCode: string; ownerUserId: string };
    assert.equal(lookup.referralCode, referrer.referralCode);
    assert.equal(lookup.ownerUserId, referrer.userId);

    const referredChallengeResponse = await postJson(baseUrl, '/otc/users/wallet-challenges', {
      walletType: 'evm',
      network: 'base_sepolia',
      address: referredWallet.address,
    });
    const referredChallenge = (await referredChallengeResponse.json()) as { challengeId: string; message: string };
    const referredResponse = await postJson(baseUrl, '/otc/users', {
      challengeId: referredChallenge.challengeId,
      signature: await referredWallet.signMessage(referredChallenge.message),
      sourceUrl: `https://oysters.market/?ref=${referrer.referralCode}`,
    });
    assert.equal(referredResponse.status, 201);
    const referred = (await referredResponse.json()) as {
      referralCode: string;
      userId: string;
      referredBy: { referrerUserId: string; referralCode: string; sourceUrl: string };
    };
    assert.notEqual(referred.referralCode, referrer.referralCode);
    assert.equal(referred.referredBy.referrerUserId, referrer.userId);
    assert.equal(referred.referredBy.referralCode, referrer.referralCode);
    assert.equal(referred.referredBy.sourceUrl, `https://oysters.market/?ref=${referrer.referralCode}`);

    const replayResponse = await postJson(baseUrl, '/otc/users', {
      challengeId: referredChallenge.challengeId,
      signature: await referredWallet.signMessage(referredChallenge.message),
      sourceUrl: `https://oysters.market/?ref=${referrer.referralCode}`,
    });
    assert.equal(replayResponse.status, 400);
    const replayError = (await replayResponse.json()) as { message: string };
    assert.match(replayError.message, /already used/);

    const profileChallengeResponse = await postJson(baseUrl, '/otc/users/wallet-challenges', {
      walletType: 'evm',
      network: 'base_sepolia',
      address: referredWallet.address,
    });
    const profileChallenge = (await profileChallengeResponse.json()) as { challengeId: string; message: string };
    const profileResponse = await postJson(baseUrl, `/otc/users/${referred.userId}/profile`, {
      challengeId: profileChallenge.challengeId,
      signature: await referredWallet.signMessage(profileChallenge.message),
      email: 'TRADER@EXAMPLE.COM',
      notificationEmailEnabled: false,
    });
    assert.equal(profileResponse.status, 200);
    const profile = (await profileResponse.json()) as { email: string; notificationEmailEnabled: boolean };
    assert.equal(profile.email, 'trader@example.com');
    assert.equal(profile.notificationEmailEnabled, false);

    const emailChallengeResponse = await postJson(baseUrl, '/otc/users/wallet-challenges', {
      walletType: 'evm',
      network: 'base_sepolia',
      address: referredWallet.address,
    });
    const emailChallenge = (await emailChallengeResponse.json()) as { challengeId: string; message: string };
    const emailVerificationResponse = await postJson(baseUrl, `/otc/users/${referred.userId}/email/verification`, {
      challengeId: emailChallenge.challengeId,
      signature: await referredWallet.signMessage(emailChallenge.message),
      email: 'trader@example.com',
    });
    assert.equal(emailVerificationResponse.status, 201);
    const emailVerification = (await emailVerificationResponse.json()) as { deliveryId: string; status: string };
    assert.equal(emailVerification.status, 'pending');

    const deliveriesResponse = await fetch(`${baseUrl}/otc/admin/notifications/deliveries?status=pending`, { headers: adminHeaders });
    assert.equal(deliveriesResponse.status, 200);
    const deliveries = (await deliveriesResponse.json()) as Array<{
      deliveryId: string;
      notificationType: string;
      payload: { verification_token?: string };
    }>;
    assert.equal(deliveries[0].deliveryId, emailVerification.deliveryId);
    assert.equal(deliveries[0].notificationType, 'email_verification');
    assert.ok(deliveries[0].payload.verification_token);

    const verifiedEmailResponse = await postJson(baseUrl, `/otc/users/${referred.userId}/email/verify`, {
      token: deliveries[0].payload.verification_token,
    });
    assert.equal(verifiedEmailResponse.status, 200);
    const verifiedEmail = (await verifiedEmailResponse.json()) as { email: string; emailVerifiedAt: string };
    assert.equal(verifiedEmail.email, 'trader@example.com');
    assert.equal(verifiedEmail.emailVerifiedAt, '2026-05-16T12:00:00.000Z');

    const changeEmailChallengeResponse = await postJson(baseUrl, '/otc/users/wallet-challenges', {
      walletType: 'evm',
      network: 'base_sepolia',
      address: referredWallet.address,
    });
    const changeEmailChallenge = (await changeEmailChallengeResponse.json()) as { challengeId: string; message: string };
    const changeEmailResponse = await postJson(baseUrl, `/otc/users/${referred.userId}/profile`, {
      challengeId: changeEmailChallenge.challengeId,
      signature: await referredWallet.signMessage(changeEmailChallenge.message),
      email: 'new-trader@example.com',
      notificationEmailEnabled: true,
    });
    assert.equal(changeEmailResponse.status, 400);
    const changeEmailError = (await changeEmailResponse.json()) as { message: string };
    assert.match(changeEmailError.message, /verified email/);

    const preferencesChallengeResponse = await postJson(baseUrl, '/otc/users/wallet-challenges', {
      walletType: 'evm',
      network: 'base_sepolia',
      address: referredWallet.address,
    });
    const preferencesChallenge = (await preferencesChallengeResponse.json()) as { challengeId: string; message: string };
    const preferencesResponse = await postJson(baseUrl, `/otc/users/${referred.userId}/notification-preferences`, {
      challengeId: preferencesChallenge.challengeId,
      signature: await referredWallet.signMessage(preferencesChallenge.message),
      preferences: [
        { notificationType: 'trade_status', channel: 'email', enabled: true },
        { notificationType: 'deadline_warning', channel: 'email', enabled: true },
      ],
    });
    assert.equal(preferencesResponse.status, 200);
    const preferences = (await preferencesResponse.json()) as {
      preferences: Array<{ notificationType: string; channel: string; enabled: boolean }>;
    };
    assert.equal(preferences.preferences.find((candidate) => candidate.notificationType === 'trade_status' && candidate.channel === 'email')?.enabled, true);

    const deliveryUpdateResponse = await postJson(baseUrl, `/otc/admin/notifications/deliveries/${emailVerification.deliveryId}`, {
      status: 'sent',
    }, operatorHeaders);
    assert.equal(deliveryUpdateResponse.status, 200);
    const deliveryUpdate = (await deliveryUpdateResponse.json()) as { status: string; sentAt: string };
    assert.equal(deliveryUpdate.status, 'sent');
    assert.equal(deliveryUpdate.sentAt, '2026-05-16T12:00:00.000Z');

    const orderChallengeResponse = await postJson(baseUrl, '/otc/users/wallet-challenges', {
      walletType: 'evm',
      network: 'base_sepolia',
      address: referredWallet.address,
    });
    const orderChallenge = (await orderChallengeResponse.json()) as { challengeId: string; message: string };
    const makerPearlAddress = BUYER_TESTNET_ADDRESS;
    const makerPearlPubkey = xOnlyPublicKey('05');
    const orderResponse = await postJson(baseUrl, '/otc/orders', {
      userId: referred.userId,
      challengeId: orderChallenge.challengeId,
      signature: await referredWallet.signMessage(orderChallenge.message),
      side: 'buy_prl',
      makerPearlAddress,
      makerUsdcAddress: referredWallet.address,
      makerPearlPubkey,
      makerPearlPubkeyProof: signOrderMakerProof({
        makerUserId: referred.userId,
        side: 'buy_prl',
        amountPrl: '250.00000000',
        priceUsdcPerPrl: '0.150000',
        minFillPrl: '25.00000000',
        makerPearlAddress,
        makerUsdcAddress: referredWallet.address,
        makerPearlPubkey,
        privateKeySeed: '05',
      }),
      amountPrl: '250.00000000',
      priceUsdcPerPrl: '0.150000',
      minFillPrl: '25.00000000',
    });
    assert.equal(orderResponse.status, 201);
    const order = (await orderResponse.json()) as {
      orderId: string;
      fundingAsset: string;
      remainingPrl: string;
      priceUsdcPerPrl: string;
    };
    assert.equal(order.fundingAsset, 'USDC');
    assert.equal(order.remainingPrl, '250.00000000');
    assert.equal(order.priceUsdcPerPrl, '0.150000');

    const ordersResponse = await fetch(`${baseUrl}/otc/orders?side=buy_prl&status=open&sort=best_price`);
    assert.equal(ordersResponse.status, 200);
    const orders = (await ordersResponse.json()) as { total: number; items: Array<{ orderId: string }> };
    assert.equal(orders.total, 1);
    assert.equal(orders.items[0].orderId, order.orderId);

    const mismatchedOrderQuoteChallengeResponse = await postJson(baseUrl, '/otc/users/wallet-challenges', {
      walletType: 'evm',
      network: 'base_sepolia',
      address: referrerWallet.address,
    });
    const mismatchedOrderQuoteChallenge = (await mismatchedOrderQuoteChallengeResponse.json()) as { challengeId: string; message: string };
    const mismatchedOrderQuoteResponse = await postJson(baseUrl, `/otc/orders/${order.orderId}/quotes`, {
      userId: referrer.userId,
      challengeId: mismatchedOrderQuoteChallenge.challengeId,
      signature: await referrerWallet.signMessage(mismatchedOrderQuoteChallenge.message),
      amountPrl: '50.00000000',
      pearlAddress: SELLER_TESTNET_REFUND_ADDRESS,
      usdcAddress: referredWallet.address,
      clientRequestId: 'order-quote-http-mismatched-usdc',
    });
    assert.equal(mismatchedOrderQuoteResponse.status, 400);
    const mismatchedOrderQuoteError = (await mismatchedOrderQuoteResponse.json()) as { message: string };
    assert.match(mismatchedOrderQuoteError.message, /usdcAddress must match the verified user wallet/);

    const orderQuoteChallengeResponse = await postJson(baseUrl, '/otc/users/wallet-challenges', {
      walletType: 'evm',
      network: 'base_sepolia',
      address: referrerWallet.address,
    });
    const orderQuoteChallenge = (await orderQuoteChallengeResponse.json()) as { challengeId: string; message: string };
    const orderQuoteResponse = await postJson(baseUrl, `/otc/orders/${order.orderId}/quotes`, {
      userId: referrer.userId,
      challengeId: orderQuoteChallenge.challengeId,
      signature: await referrerWallet.signMessage(orderQuoteChallenge.message),
      amountPrl: '50.00000000',
      pearlAddress: SELLER_TESTNET_REFUND_ADDRESS,
      usdcAddress: referrerWallet.address,
      clientRequestId: 'order-quote-http-1',
    });
    assert.equal(orderQuoteResponse.status, 201);
    const orderQuote = (await orderQuoteResponse.json()) as {
      quote: { quoteId: string; amountUsdc: string; priceUsdcPerPrl: string };
      makerRole: string;
      acceptPrefill: { buyerPearlAddress: string; buyerUsdcAddress: string; buyerPearlPubkey: string };
    };
    assert.equal(orderQuote.quote.amountUsdc, '7.500000');
    assert.equal(orderQuote.quote.priceUsdcPerPrl, '0.150000');
    assert.equal(orderQuote.makerRole, 'buyer');
    assert.equal(orderQuote.acceptPrefill.buyerPearlAddress, makerPearlAddress);
    assert.equal(orderQuote.acceptPrefill.buyerUsdcAddress, referredWallet.address);
    assert.equal(orderQuote.acceptPrefill.buyerPearlPubkey, makerPearlPubkey);

    const orderContextResponse = await fetch(`${baseUrl}/otc/quotes/${orderQuote.quote.quoteId}/order-context`);
    assert.equal(orderContextResponse.status, 200);
    const orderContext = (await orderContextResponse.json()) as {
      makerRole: string;
      acceptPrefill: {
        buyerPearlAddress: string;
        sellerPearlRefundAddress: string;
        sellerUsdcReceiveAddress: string;
      };
    };
    assert.equal(orderContext.makerRole, 'buyer');
    assert.equal(orderContext.acceptPrefill.buyerPearlAddress, makerPearlAddress);
    assert.equal(orderContext.acceptPrefill.sellerPearlRefundAddress, SELLER_TESTNET_REFUND_ADDRESS);
    assert.equal(orderContext.acceptPrefill.sellerUsdcReceiveAddress, referrerWallet.address);

    const takerSellerPearlAddress = SELLER_TESTNET_REFUND_ADDRESS;
    const takerSellerPearlPubkey = xOnlyPublicKey('06');
    const acceptOrderQuoteResponse = await postJson(baseUrl, `/otc/quotes/${orderQuote.quote.quoteId}/accept`, {
      buyerPearlAddress: makerPearlAddress,
      buyerUsdcAddress: referredWallet.address,
      sellerPearlRefundAddress: takerSellerPearlAddress,
      sellerUsdcReceiveAddress: referrerWallet.address,
      pearlEscrowMode: 'multisig',
      pearlReleaseSigningMode: 'manual_after_base_deposit',
      buyerPearlPubkey: makerPearlPubkey,
      sellerPearlPubkey: takerSellerPearlPubkey,
      sellerPearlPubkeyProof: signQuoteSignerProof({
        quoteId: orderQuote.quote.quoteId,
        role: 'seller',
        pearlAddress: takerSellerPearlAddress,
        usdcAddress: referrerWallet.address,
        pearlPubkey: takerSellerPearlPubkey,
        releaseSigningMode: 'manual_after_base_deposit',
        privateKeySeed: '06',
      }),
      clientRequestId: 'order-quote-accept-http-1',
    });
    const acceptedOrderQuoteBody = await acceptOrderQuoteResponse.json();
    assert.equal(acceptOrderQuoteResponse.status, 201, JSON.stringify(acceptedOrderQuoteBody));
    const acceptedOrderQuote = acceptedOrderQuoteBody as {
      tradeId: string;
      amountPrl: string;
      pearlEscrowMode: string;
    };
    assert.equal(acceptedOrderQuote.amountPrl, '50.00000000');
    assert.equal(acceptedOrderQuote.pearlEscrowMode, 'multisig');

    const partiallyFilledOrdersResponse = await fetch(`${baseUrl}/otc/orders?side=buy_prl&status=partially_filled`);
    assert.equal(partiallyFilledOrdersResponse.status, 200);
    const partiallyFilledOrders = (await partiallyFilledOrdersResponse.json()) as {
      total: number;
      items: Array<{ orderId: string; remainingPrl: string; status: string }>;
    };
    assert.equal(partiallyFilledOrders.total, 1);
    assert.equal(partiallyFilledOrders.items[0].orderId, order.orderId);
    assert.equal(partiallyFilledOrders.items[0].remainingPrl, '200.00000000');
    assert.equal(partiallyFilledOrders.items[0].status, 'partially_filled');

    const statsResponse = await fetch(`${baseUrl}/otc/market/stats`);
    assert.equal(statsResponse.status, 200);
    const stats = (await statsResponse.json()) as { openOrders: number; activeOrderVolumePrl: string; verifiedUsers: number };
    assert.equal(stats.openOrders, 1);
    assert.equal(stats.activeOrderVolumePrl, '200.00000000');
    assert.equal(stats.verifiedUsers, 2);

    const dashboardChallengeResponse = await postJson(baseUrl, '/otc/users/wallet-challenges', {
      walletType: 'evm',
      network: 'base_sepolia',
      address: referredWallet.address,
    });
    const dashboardChallenge = (await dashboardChallengeResponse.json()) as { challengeId: string; message: string };
    const dashboardResponse = await postJson(baseUrl, `/otc/users/${referred.userId}/dashboard`, {
      challengeId: dashboardChallenge.challengeId,
      signature: await referredWallet.signMessage(dashboardChallenge.message),
    });
    assert.equal(dashboardResponse.status, 200);
    const dashboard = (await dashboardResponse.json()) as {
      orders: Array<{ orderId: string }>;
      points: { totalPoints: number; bySource: Record<string, number> };
    };
    assert.equal(dashboard.orders[0].orderId, order.orderId);
    assert.equal(dashboard.points.totalPoints, 35);
    assert.equal(dashboard.points.bySource.signup, 25);
    assert.equal(dashboard.points.bySource.order_created, 10);

    const referrerDashboardChallengeResponse = await postJson(baseUrl, '/otc/users/wallet-challenges', {
      walletType: 'evm',
      network: 'base_sepolia',
      address: referrerWallet.address,
    });
    const referrerDashboardChallenge = (await referrerDashboardChallengeResponse.json()) as { challengeId: string; message: string };
    const referrerDashboardResponse = await postJson(baseUrl, `/otc/users/${referrer.userId}/dashboard`, {
      challengeId: referrerDashboardChallenge.challengeId,
      signature: await referrerWallet.signMessage(referrerDashboardChallenge.message),
    });
    assert.equal(referrerDashboardResponse.status, 200);
    const referrerDashboard = (await referrerDashboardResponse.json()) as {
      points: { totalPoints: number; bySource: Record<string, number> };
    };
    assert.equal(referrerDashboard.points.bySource.referral_signup, 50);
    assert.equal(referrerDashboard.points.bySource.referral_activity_bonus, 3);
  }, { ...config, pearlEscrowAllocator: 'p2tr_multisig', pearlEscrowArbiterPubkey: xOnlyPublicKey('04') });
});

test('registers Pearl wallet users with address-bound BIP340 ownership proof', async () => {
  await withServer(async (baseUrl) => {
    const publicKeyHex = xOnlyPublicKey('07');
    const address = createPearlP2trPayment({ network: 'testnet2', internalPubkey: publicKeyHex }).address;
    const linkedBaseWallet = new Wallet('0x7f68c73b4d9b963b491e2d4e3aaf104b160ec34f277a791221aabc685f38ac86');
    const challengeResponse = await postJson(baseUrl, '/otc/users/wallet-challenges', {
      walletType: 'pearl',
      network: 'testnet2',
      address,
    });
    assert.equal(challengeResponse.status, 201);
    const challenge = (await challengeResponse.json()) as { challengeId: string; message: string };

    const registerResponse = await postJson(baseUrl, '/otc/users', {
      challengeId: challenge.challengeId,
      signature: signUserWalletChallenge(challenge.message, '07'),
      publicKeyHex,
    });
    assert.equal(registerResponse.status, 201);
    const user = (await registerResponse.json()) as {
      userId: string;
      wallet: { walletType: string; network: string; address: string; publicKeyHex: string };
    };
    assert.equal(user.wallet.walletType, 'pearl');
    assert.equal(user.wallet.network, 'testnet2');
    assert.equal(user.wallet.address, address);
    assert.equal(user.wallet.publicKeyHex, publicKeyHex);
    assert.equal((user as { wallets?: unknown[] }).wallets?.length, 1);

    const orderChallengeResponse = await postJson(baseUrl, '/otc/users/wallet-challenges', {
      walletType: 'pearl',
      network: 'testnet2',
      address,
    });
    const orderChallenge = (await orderChallengeResponse.json()) as { challengeId: string; message: string };
    const orderResponse = await postJson(baseUrl, '/otc/orders', {
      userId: user.userId,
      challengeId: orderChallenge.challengeId,
      signature: signUserWalletChallenge(orderChallenge.message, '07'),
      publicKeyHex,
      side: 'buy_prl',
      makerPearlAddress: BUYER_TESTNET_ADDRESS,
      makerUsdcAddress: '0x1111111111111111111111111111111111111111',
      makerPearlPubkey: publicKeyHex,
      makerPearlPubkeyProof: signOrderMakerProof({
        makerUserId: user.userId,
        side: 'buy_prl',
        amountPrl: '1.00000000',
        priceUsdcPerPrl: '0.150000',
        makerPearlAddress: BUYER_TESTNET_ADDRESS,
        makerUsdcAddress: '0x1111111111111111111111111111111111111111',
        makerPearlPubkey: publicKeyHex,
        privateKeySeed: '07',
      }),
      amountPrl: '1.00000000',
      priceUsdcPerPrl: '0.150000',
    });
    assert.equal(orderResponse.status, 400);
    const orderError = (await orderResponse.json()) as { message: string };
    assert.match(orderError.message, /trading actions require a verified Base EVM wallet user/);

    const linkAuthChallengeResponse = await postJson(baseUrl, '/otc/users/wallet-challenges', {
      walletType: 'pearl',
      network: 'testnet2',
      address,
    });
    const linkAuthChallenge = (await linkAuthChallengeResponse.json()) as { challengeId: string; message: string };
    const linkBaseChallengeResponse = await postJson(baseUrl, '/otc/users/wallet-challenges', {
      walletType: 'evm',
      network: 'base_sepolia',
      address: linkedBaseWallet.address,
    });
    const linkBaseChallenge = (await linkBaseChallengeResponse.json()) as { challengeId: string; message: string };
    const linkResponse = await postJson(baseUrl, `/otc/users/${user.userId}/wallets`, {
      challengeId: linkAuthChallenge.challengeId,
      signature: signUserWalletChallenge(linkAuthChallenge.message, '07'),
      publicKeyHex,
      walletChallengeId: linkBaseChallenge.challengeId,
      walletSignature: await linkedBaseWallet.signMessage(linkBaseChallenge.message),
    });
    assert.equal(linkResponse.status, 201);
    const linkedUser = (await linkResponse.json()) as {
      userId: string;
      wallet: { walletType: string; address: string };
      wallets: Array<{ walletType: string; network: string; address: string }>;
    };
    assert.equal(linkedUser.userId, user.userId);
    assert.equal(linkedUser.wallet.walletType, 'evm');
    assert.equal(linkedUser.wallet.address, linkedBaseWallet.address);
    assert.equal(linkedUser.wallets.length, 2);
    assert.ok(linkedUser.wallets.some((wallet) => wallet.walletType === 'pearl' && wallet.address === address));
    assert.ok(linkedUser.wallets.some((wallet) => wallet.walletType === 'evm' && wallet.address === linkedBaseWallet.address));

    const linkedOrderChallengeResponse = await postJson(baseUrl, '/otc/users/wallet-challenges', {
      walletType: 'evm',
      network: 'base_sepolia',
      address: linkedBaseWallet.address,
    });
    const linkedOrderChallenge = (await linkedOrderChallengeResponse.json()) as { challengeId: string; message: string };
    const linkedOrderResponse = await postJson(baseUrl, '/otc/orders', {
      userId: user.userId,
      challengeId: linkedOrderChallenge.challengeId,
      signature: await linkedBaseWallet.signMessage(linkedOrderChallenge.message),
      side: 'buy_prl',
      makerPearlAddress: BUYER_TESTNET_ADDRESS,
      makerUsdcAddress: linkedBaseWallet.address,
      makerPearlPubkey: publicKeyHex,
      makerPearlPubkeyProof: signOrderMakerProof({
        makerUserId: user.userId,
        side: 'buy_prl',
        amountPrl: '1.00000000',
        priceUsdcPerPrl: '0.150000',
        makerPearlAddress: BUYER_TESTNET_ADDRESS,
        makerUsdcAddress: linkedBaseWallet.address,
        makerPearlPubkey: publicKeyHex,
        privateKeySeed: '07',
      }),
      amountPrl: '1.00000000',
      priceUsdcPerPrl: '0.150000',
    });
    const linkedOrderBody = await linkedOrderResponse.json();
    assert.equal(linkedOrderResponse.status, 201, JSON.stringify(linkedOrderBody));
    assert.equal((linkedOrderBody as { makerUserId: string; makerUsdcAddress: string }).makerUserId, user.userId);
    assert.equal((linkedOrderBody as { makerUsdcAddress: string }).makerUsdcAddress, linkedBaseWallet.address);
  });
});

test('lists wallet users for admin search and referral support', async () => {
  await withServer(async (baseUrl) => {
    const referrerWallet = new Wallet('0x59c6995e998f97a5a0044966f094538c5a0d9f0c7f044cd588d0d20d0368a498');
    const referredWallet = new Wallet('0x8b3a350cf5c34c9194ca6c0b3f8d6f841e252cb3f72b8636505f6dbcbf8f8531');

    const referrerChallengeResponse = await postJson(baseUrl, '/otc/users/wallet-challenges', {
      walletType: 'evm',
      network: 'base_sepolia',
      address: referrerWallet.address,
    });
    const referrerChallenge = (await referrerChallengeResponse.json()) as { challengeId: string; message: string };
    const referrerResponse = await postJson(baseUrl, '/otc/users', {
      challengeId: referrerChallenge.challengeId,
      signature: await referrerWallet.signMessage(referrerChallenge.message),
      email: 'desk-referrer@example.com',
    });
    assert.equal(referrerResponse.status, 201);
    const referrer = (await referrerResponse.json()) as { userId: string; referralCode: string };

    const referredChallengeResponse = await postJson(baseUrl, '/otc/users/wallet-challenges', {
      walletType: 'evm',
      network: 'base_sepolia',
      address: referredWallet.address,
    });
    const referredChallenge = (await referredChallengeResponse.json()) as { challengeId: string; message: string };
    const referredResponse = await postJson(baseUrl, '/otc/users', {
      challengeId: referredChallenge.challengeId,
      signature: await referredWallet.signMessage(referredChallenge.message),
      referralCode: referrer.referralCode,
      email: 'desk-referred@example.com',
    });
    assert.equal(referredResponse.status, 201);
    const referred = (await referredResponse.json()) as { userId: string };

    const unauthorizedResponse = await fetch(`${baseUrl}/otc/admin/users`);
    assert.equal(unauthorizedResponse.status, 401);

    const searchResponse = await fetch(`${baseUrl}/otc/admin/users?search=${encodeURIComponent(referredWallet.address.slice(0, 12))}`, {
      headers: supportHeaders,
    });
    assert.equal(searchResponse.status, 200);
    const searchPage = (await searchResponse.json()) as {
      items: Array<{ userId: string; email?: string; wallets: Array<{ address: string }>; walletCount: number; pointTotal: number }>;
      total: number;
    };
    assert.equal(searchPage.total, 1);
    assert.equal(searchPage.items[0].userId, referred.userId);
    assert.equal(searchPage.items[0].email, 'desk-referred@example.com');
    assert.equal(searchPage.items[0].wallets[0].address, referredWallet.address);
    assert.equal(searchPage.items[0].walletCount, 1);
    assert.equal(searchPage.items[0].pointTotal, 25);

    const referralResponse = await fetch(`${baseUrl}/otc/admin/users?referrer_user_id=${encodeURIComponent(referrer.userId)}`, {
      headers: supportHeaders,
    });
    assert.equal(referralResponse.status, 200);
    const referralPage = (await referralResponse.json()) as {
      items: Array<{ userId: string; referredBy?: { referrerUserId: string } }>;
      total: number;
    };
    assert.equal(referralPage.total, 1);
    assert.equal(referralPage.items[0].userId, referred.userId);
    assert.equal(referralPage.items[0].referredBy?.referrerUserId, referrer.userId);
  });
});

test('rejects Pearl wallet users when public key does not derive challenged address', async () => {
  await withServer(async (baseUrl) => {
    const address = createPearlP2trPayment({ network: 'testnet2', internalPubkey: xOnlyPublicKey('08') }).address;
    const publicKeyHex = xOnlyPublicKey('09');
    const challengeResponse = await postJson(baseUrl, '/otc/users/wallet-challenges', {
      walletType: 'pearl',
      network: 'testnet2',
      address,
    });
    assert.equal(challengeResponse.status, 201);
    const challenge = (await challengeResponse.json()) as { challengeId: string; message: string };

    const registerResponse = await postJson(baseUrl, '/otc/users', {
      challengeId: challenge.challengeId,
      signature: signUserWalletChallenge(challenge.message, '09'),
      publicKeyHex,
    });
    assert.equal(registerResponse.status, 400);
    const error = (await registerResponse.json()) as { message: string };
    assert.match(error.message, /public key does not derive/);
  });
});

test('serves quote, accept, trade, and proof routes', async () => {
  await withServer(async (baseUrl) => {
    const quoteResponse = await postJson(baseUrl, '/otc/quotes', {
      side: 'buy_prl',
      amountPrl: '1000.00000000',
      settlementAsset: 'USDC',
      settlementNetwork: 'base',
      buyerPearlAddress: 'tprl1pbuyer',
      usdcRefundAddress: '0x2222222222222222222222222222222222222222',
      clientRequestId: 'quote-http-1',
    });
    assert.equal(quoteResponse.status, 201);
    const quote = (await quoteResponse.json()) as { quoteId: string; amountUsdc: string };
    assert.equal(quote.amountUsdc, '170.000000');

    const getQuoteResponse = await fetch(`${baseUrl}/otc/quotes/${quote.quoteId}`);
    assert.equal(getQuoteResponse.status, 200);
    const fetchedQuote = (await getQuoteResponse.json()) as { quoteId: string };
    assert.equal(fetchedQuote.quoteId, quote.quoteId);

    const tradeResponse = await postJson(baseUrl, `/otc/quotes/${quote.quoteId}/accept`, {
      buyerPearlAddress: 'tprl1pbuyer',
      buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
      sellerPearlRefundAddress: 'tprl1psellerrefund',
      sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
      clientRequestId: 'accept-http-1',
    });
    assert.equal(tradeResponse.status, 201);
    const trade = (await tradeResponse.json()) as {
      tradeId: string;
      state: string;
      deadlines: { usdcDepositDeadline: string };
      usdcEscrow: { expiresAt: string };
    };
    assert.equal(trade.state, 'pearl_escrow_pending');
    assert.equal(trade.deadlines.usdcDepositDeadline, '2026-05-16T12:15:00.000Z');
    assert.equal(trade.usdcEscrow.expiresAt, trade.deadlines.usdcDepositDeadline);

    const getTradeResponse = await fetch(`${baseUrl}/otc/trades/${trade.tradeId}`);
    assert.equal(getTradeResponse.status, 200);
    const fetchedTrade = (await getTradeResponse.json()) as { tradeId: string };
    assert.equal(fetchedTrade.tradeId, trade.tradeId);

    const proofResponse = await fetch(`${baseUrl}/otc/trades/${trade.tradeId}/proof`);
    assert.equal(proofResponse.status, 200);
    const proof = (await proofResponse.json()) as { tradeId: string; events: unknown[]; deadlines: { usdcDepositDeadline: string } };
    assert.equal(proof.tradeId, trade.tradeId);
    assert.equal(proof.deadlines.usdcDepositDeadline, '2026-05-16T12:15:00.000Z');
    assert.equal(proof.events.length, 1);

    const releaseIntentResponse = await fetch(`${baseUrl}/otc/trades/${trade.tradeId}/pearl-release/intent`);
    assert.equal(releaseIntentResponse.status, 200);
    const releaseIntent = (await releaseIntentResponse.json()) as { status: string; reason: string };
    assert.equal(releaseIntent.status, 'not_ready');
    assert.match(releaseIntent.reason, /multisig/);

    const publicCreateIntentResponse = await postJson(baseUrl, `/otc/trades/${trade.tradeId}/usdc-escrow/create-intent`, {
      idempotencyKey: 'http-create-trade-public',
      actor: 'spoofed-operator',
    });
    assert.equal(publicCreateIntentResponse.status, 401);

    const createIntentResponse = await postJson(baseUrl, `/otc/trades/${trade.tradeId}/usdc-escrow/create-intent`, {
      idempotencyKey: 'http-create-trade-1',
      actor: 'settlement-worker',
    }, operatorHeaders);
    assert.equal(createIntentResponse.status, 200);
    const createIntent = (await createIntentResponse.json()) as { tradeKey: string; sideEffect: { actor: string; effectType: string } };
    assert.match(createIntent.tradeKey, /^0x[0-9a-f]{64}$/);
    assert.equal(createIntent.sideEffect.effectType, 'usdc_create_trade');
    assert.equal(createIntent.sideEffect.actor, 'operator-user');

    const recordSideEffectResponse = await postJson(baseUrl, `/otc/trades/${trade.tradeId}/side-effects`, {
      idempotencyKey: 'http-record-side-effect-1',
      effectType: 'usdc_deposit_observed',
      status: 'confirmed',
      actor: 'spoofed-operator',
      txHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
      chainId: 84532,
    }, operatorHeaders);
    assert.equal(recordSideEffectResponse.status, 201);
    const recordedSideEffect = (await recordSideEffectResponse.json()) as { actor: string };
    assert.equal(recordedSideEffect.actor, 'operator-user');

    const publicSideEffectsResponse = await fetch(`${baseUrl}/otc/trades/${trade.tradeId}/side-effects`);
    assert.equal(publicSideEffectsResponse.status, 401);

    const sideEffectsResponse = await fetch(`${baseUrl}/otc/trades/${trade.tradeId}/side-effects`, { headers: adminHeaders });
    assert.equal(sideEffectsResponse.status, 200);
    const sideEffects = (await sideEffectsResponse.json()) as unknown[];
    assert.equal(sideEffects.length, 2);

    const supportAlertResponse = await postJson(baseUrl, `/otc/trades/${trade.tradeId}/support-alerts`, {
      idempotencyKey: 'http-support-alert-1',
      actor: 'spoofed-operator',
      severity: 'warning',
      message: 'User needs help with deposit status',
      source: 'operator',
    });
    assert.equal(supportAlertResponse.status, 201);
    const supportAlert = (await supportAlertResponse.json()) as { actor: string; metadata: { source: string } };
    assert.equal(supportAlert.actor, 'user');
    assert.equal(supportAlert.metadata.source, 'user');

    const unauthorizedAdminResponse = await fetch(`${baseUrl}/otc/admin/trades?manual_review_only=false&search=${trade.tradeId}`);
    assert.equal(unauthorizedAdminResponse.status, 401);

    const wrongTokenAdminResponse = await fetch(`${baseUrl}/otc/admin/trades?manual_review_only=false&search=${trade.tradeId}`, {
      headers: { authorization: 'Bearer wrong-admin-token' },
    });
    assert.equal(wrongTokenAdminResponse.status, 401);

    const adminListResponse = await fetch(`${baseUrl}/otc/admin/trades?manual_review_only=false&search=${trade.tradeId}`, {
      headers: adminHeaders,
    });
    assert.equal(adminListResponse.status, 200);
    const adminTrades = (await adminListResponse.json()) as { items: Array<{ tradeId: string; alertCount: number }>; total: number };
    assert.equal(adminTrades.total, 1);
    assert.equal(adminTrades.items.length, 1);
    assert.equal(adminTrades.items[0].tradeId, trade.tradeId);
    assert.equal(adminTrades.items[0].alertCount, 1);

    const supportDetailResponse = await fetch(`${baseUrl}/otc/admin/trades/${trade.tradeId}`, { headers: supportHeaders });
    assert.equal(supportDetailResponse.status, 200);
    const supportDetail = (await supportDetailResponse.json()) as { redaction: string; trade: { buyerPearlAddress: string } };
    assert.equal(supportDetail.redaction, 'support');
    assert.equal(supportDetail.trade.buyerPearlAddress, 'tprl1p...uyer');

    const forbiddenManualReviewResponse = await postJson(baseUrl, `/otc/admin/trades/${trade.tradeId}/manual-review`, {
      idempotencyKey: 'http-manual-review-forbidden',
      reason: 'Support cannot mark manual review',
    }, supportHeaders);
    assert.equal(forbiddenManualReviewResponse.status, 403);

    const manualReviewResponse = await postJson(baseUrl, `/otc/admin/trades/${trade.tradeId}/manual-review`, {
      idempotencyKey: 'http-manual-review-1',
      actor: 'spoofed-operator',
      reason: 'User reported an error; hold for operator inspection',
    }, operatorHeaders);
    assert.equal(manualReviewResponse.status, 200);
    const manualReview = (await manualReviewResponse.json()) as {
      trade: { state: string };
      supportSummary: { publicProofPath: string };
      safeActions: string[];
    };
    assert.equal(manualReview.trade.state, 'failed_manual_review');
    assert.equal(manualReview.supportSummary.publicProofPath, `/otc/trades/${trade.tradeId}/proof`);
    assert.equal(manualReview.safeActions.includes('copy_support_summary'), true);

    const adminDetailResponse = await fetch(`${baseUrl}/otc/admin/trades/${trade.tradeId}`, { headers: adminHeaders });
    assert.equal(adminDetailResponse.status, 200);
    const adminDetail = (await adminDetailResponse.json()) as {
      sideEffects: unknown[];
      events: Array<{ metadata?: { actor?: string } }>;
    };
    assert.equal(adminDetail.sideEffects.length, 4);
    assert.equal(adminDetail.events.some((event) => event.metadata?.actor === 'operator-user'), true);
    assert.equal(adminDetail.events.some((event) => event.metadata?.actor === 'spoofed-operator'), false);
  });
});

test('rate limits public support alerts per trade and caller', async () => {
  const service = new OtcTradeService(
    new InMemoryOtcRepository(),
    { ...config, supportAlertRateLimitMax: 1 },
    escrowAllocator,
    () => new Date('2026-05-16T12:00:00.000Z'),
  );
  const server = createOtcHttpServer(service, { adminToken });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const quoteResponse = await postJson(baseUrl, '/otc/quotes', {
      side: 'buy_prl',
      amountPrl: '1000.00000000',
      settlementAsset: 'USDC',
      settlementNetwork: 'base',
      buyerPearlAddress: 'tprl1pbuyer',
      usdcRefundAddress: '0x2222222222222222222222222222222222222222',
      clientRequestId: 'quote-http-rate-limit',
    });
    const quote = (await quoteResponse.json()) as { quoteId: string };
    const tradeResponse = await postJson(baseUrl, `/otc/quotes/${quote.quoteId}/accept`, {
      buyerPearlAddress: 'tprl1pbuyer',
      buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
      sellerPearlRefundAddress: 'tprl1psellerrefund',
      sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
      clientRequestId: 'accept-http-rate-limit',
    });
    const trade = (await tradeResponse.json()) as { tradeId: string };

    const first = await postJson(baseUrl, `/otc/trades/${trade.tradeId}/support-alerts`, {
      idempotencyKey: 'http-rate-alert-1',
      actor: 'support',
      severity: 'warning',
      message: 'First alert',
      source: 'user',
    }, { 'x-forwarded-for': '203.0.113.10' });
    const second = await postJson(baseUrl, `/otc/trades/${trade.tradeId}/support-alerts`, {
      idempotencyKey: 'http-rate-alert-2',
      actor: 'support',
      severity: 'warning',
      message: 'Second alert',
      source: 'user',
    }, { 'x-forwarded-for': '203.0.113.10' });

    assert.equal(first.status, 201);
    assert.equal(second.status, 429);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('returns mapped HTTP errors', async () => {
  await withServer(async (baseUrl) => {
    const missing = await fetch(`${baseUrl}/otc/trades/missing`);
    assert.equal(missing.status, 404);

    const invalid = await fetch(`${baseUrl}/otc/quotes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    assert.equal(invalid.status, 400);

    const oversized = await fetch(`${baseUrl}/otc/quotes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: 'x'.repeat(70 * 1024) }),
    });
    assert.equal(oversized.status, 413);
  });
});
