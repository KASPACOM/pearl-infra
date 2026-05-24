import { createHash, randomBytes } from 'node:crypto';

import { getAddress, isAddress, verifyMessage } from 'ethers';

import {
  assertTradeTransition,
  formatGrainsToPrl,
  formatMicrosToUsdc,
  type OtcQuote,
  type OtcTrade,
  type OtcTradeDeadlines,
  parsePrlToGrains,
  parseUsdcToMicros,
  createPearlSignerProofMessage,
  type PearlReleaseSigningMode,
  type PearlSignerProofRole,
  normalizeProofPubkey,
  type TradeEvent,
  type TradeState,
  tradeStateIsTerminal,
} from '@kaspacom/pearl-sdk';
import { createPearlEscrowTxTemplateHash, createPearlEscrowUnsignedTx, type PearlEscrowPackage, type PearlEscrowTxTemplate } from '@kaspacom/pearl-escrow';
import { normalizeXOnlyPubkey } from '@kaspacom/pearl-script';
import { getUsdcEscrowNetworkConfig } from '@kaspacom/usdc-escrow-client';
import * as ecc from 'tiny-secp256k1';

import type { OtcRepository } from './repository.js';
import type { PearlIndexedProof, PearlProofReader } from './pearl-proof-reader.js';
import type { SupportAlertNotifier } from './support-alert-notifier.js';
import type {
  AcceptQuoteRequest,
  AdminTradeDebugDetail,
  AdminTradeDebugOptions,
  AdminTradeListPage,
  AdminTradeQuery,
  AdminTradeSummary,
  CreateOrderRequest,
  CreateOrderQuoteRequest,
  CreateQuoteRequest,
  CreateWalletChallengeRequest,
  CreateWalletChallengeResponse,
  MarkManualReviewRequest,
  MarketStats,
  MarkManualReviewOptions,
  OtcApiConfig,
  OtcOrder,
  OtcPointEvent,
  OtcPointsSummary,
  OtcUser,
  OtcUserDashboard,
  OtcUserWalletChallenge,
  OtcUserProfile,
  OtcSideEffect,
  OrderBookPage,
  OrderBookQuery,
  OrderQuoteAcceptContext,
  OrderQuoteResponse,
  PearlReleaseSigningIntent,
  PrepareUsdcCreateTradeRequest,
  PublicTradeProof,
  RecentTradeSummary,
  ReferralCodeLookup,
  RegisterUserRequest,
  ReplaySupportAlertRequest,
  RecordSupportAlertRequest,
  RecordSideEffectRequest,
  UpdateUserProfileRequest,
  UserDashboardRequest,
  UsdcCreateTradeIntent,
  UsdcEscrowVerification,
} from './types.js';
import type { UsdcEscrowReader } from './usdc-escrow-reader.js';

export interface PearlEscrowWatchRegistrar {
  registerPearlEscrowWatch(trade: OtcTrade): Promise<{
    watchId: string;
    address: string;
    network: OtcTrade['pearlEscrow']['network'];
    requiredConfirmations: number;
    metadata: Record<string, unknown>;
  }>;
}

export interface PearlEscrowAllocator {
  allocateEscrow(input: {
    tradeId: string;
    quote: OtcQuote;
    request: AcceptQuoteRequest;
    config: OtcApiConfig;
    deadlines: OtcTradeDeadlines;
  }): Promise<OtcTrade['pearlEscrow']>;
}

export interface SupportAlertOptions {
  rateLimitKey?: string;
  skipRateLimit?: boolean;
}

const SIGNUP_POINTS = 25;
const REFERRAL_SIGNUP_POINTS = 50;
const ORDER_CREATED_POINTS = 10;
const TRADE_COMPLETED_POINTS = 100;
const REFERRAL_ACTIVITY_BONUS_BPS = 1000;

export class MockPearlEscrowAllocator implements PearlEscrowAllocator {
  async allocateEscrow(input: {
    tradeId: string;
    quote: OtcQuote;
    request: AcceptQuoteRequest;
    config: OtcApiConfig;
    deadlines: OtcTradeDeadlines;
  }): Promise<OtcTrade['pearlEscrow']> {
    return {
      network: input.config.pearlNetwork,
      address: `mock:${input.tradeId}`,
      expectedAmountGrains: (parsePrlToGrains(input.quote.amountPrl) + parsePrlToGrains(input.quote.feePrl)).toString(),
      requiredConfirmations: input.config.pearlEscrowConfirmations,
    };
  }
}

export class OtcTradeService {
  private readonly repository: OtcRepository;
  private readonly config: OtcApiConfig;
  private readonly pearlEscrowAllocator: PearlEscrowAllocator;
  private readonly usdcEscrowReader?: UsdcEscrowReader;
  private readonly pearlEscrowWatchRegistrar?: PearlEscrowWatchRegistrar;
  private readonly pearlProofReader?: PearlProofReader;
  private readonly supportAlertNotifier?: SupportAlertNotifier;
  private readonly supportAlertRateLimitBuckets = new Map<string, number[]>();
  private readonly now: () => Date;

  constructor(
    repository: OtcRepository,
    config: OtcApiConfig,
    pearlEscrowAllocator: PearlEscrowAllocator = new MockPearlEscrowAllocator(),
    usdcEscrowReaderOrNow?: UsdcEscrowReader | (() => Date),
    now: () => Date = () => new Date(),
    pearlEscrowWatchRegistrar?: PearlEscrowWatchRegistrar,
    pearlProofReader?: PearlProofReader,
    supportAlertNotifier?: SupportAlertNotifier,
  ) {
    this.repository = repository;
    this.config = config;
    this.pearlEscrowAllocator = pearlEscrowAllocator;
    if (typeof usdcEscrowReaderOrNow === 'function') {
      this.now = usdcEscrowReaderOrNow;
    } else {
      this.usdcEscrowReader = usdcEscrowReaderOrNow;
      this.now = now;
    }
    this.pearlEscrowWatchRegistrar = pearlEscrowWatchRegistrar;
    this.pearlProofReader = pearlProofReader;
    this.supportAlertNotifier = supportAlertNotifier;
  }

  async createWalletChallenge(request: CreateWalletChallengeRequest): Promise<CreateWalletChallengeResponse> {
    validateCreateWalletChallengeRequest(request, this.config.pearlNetwork);
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + 10 * 60 * 1000).toISOString();
    const nonce = randomBytes(16).toString('hex');
    const address = normalizeWalletAddress(request.walletType, request.address);
    const challengeId = createStableId('wallet_challenge', [
      request.walletType,
      request.network.toLowerCase(),
      address.toLowerCase(),
      nonce,
    ]);
    const message = createUserWalletChallengeMessage({
      challengeId,
      walletType: request.walletType,
      network: request.network,
      address,
      nonce,
      expiresAt,
    });
    await this.repository.saveWalletChallenge({
      challengeId,
      walletType: request.walletType,
      network: request.network,
      address,
      message,
      nonce,
      expiresAt,
      createdAt: createdAt.toISOString(),
    });
    return { challengeId, message, expiresAt };
  }

  async registerUser(request: RegisterUserRequest): Promise<OtcUser> {
    const challenge = await this.assertUsableWalletChallenge(request.challengeId);
    verifyWalletChallenge(challenge, request.signature, request.publicKeyHex);
    const now = this.now().toISOString();
    const existing = await this.repository.findUserByWallet(challenge.walletType, challenge.network, challenge.address);
    if (existing) {
      await this.assertConsumeWalletChallenge(challenge.challengeId, now);
      return existing;
    }

    const referredByCode = extractReferralCode(request);
    const userId = createRandomId('user');
    const referredBy = referredByCode
      ? await this.resolveReferralAttribution(userId, referredByCode, request.sourceUrl, now)
      : undefined;
    await this.assertConsumeWalletChallenge(challenge.challengeId, now);
    const user = await this.saveUserWithFreshReferralCode({
      userId,
      challenge,
      request,
      now,
      referredBy,
    });
    return user;
  }

  async updateUserProfile(userId: string, request: UpdateUserProfileRequest): Promise<OtcUserProfile> {
    assertNonEmptyBounded(userId, 'userId', 80);
    const user = await this.repository.findUserById(userId);
    if (!user) {
      throw new Error(`user not found: ${userId}`);
    }
    const challenge = await this.assertUsableWalletChallenge(request.challengeId);
    if (
      challenge.walletType !== user.wallet.walletType ||
      challenge.network !== user.wallet.network ||
      challenge.address.toLowerCase() !== user.wallet.address.toLowerCase()
    ) {
      throw new Error('wallet challenge does not belong to user');
    }
    verifyWalletChallenge(challenge, request.signature, request.publicKeyHex);
    const updatedAt = this.now().toISOString();
    await this.assertConsumeWalletChallenge(challenge.challengeId, updatedAt);
    const profile = await this.repository.updateUserProfile(userId, {
      ...(request.email === undefined ? {} : { email: normalizeEmail(request.email) }),
      ...(request.notificationEmailEnabled === undefined
        ? {}
        : { notificationEmailEnabled: request.notificationEmailEnabled }),
      updatedAt,
    });
    return profile;
  }

  async resolveReferralCode(referralCode: string): Promise<ReferralCodeLookup> {
    const normalized = normalizeReferralCode(referralCode);
    const lookup = await this.repository.findReferralCode(normalized);
    if (!lookup || lookup.status !== 'active') {
      throw new Error(`referral code not found: ${normalized}`);
    }
    return lookup;
  }

  async createOrder(request: CreateOrderRequest): Promise<OtcOrder> {
    validateCreateOrderRequest(request, this.config.pearlNetwork);
    const { user } = await this.verifyAndConsumeUserWalletChallenge(request.userId, request);
    const makerUsdcAddress = getAddress(request.makerUsdcAddress);
    if (getAddress(user.wallet.address) !== makerUsdcAddress) {
      throw new Error('makerUsdcAddress must match the verified user wallet');
    }
    const releaseSigningMode = request.pearlReleaseSigningMode ?? 'manual_after_base_deposit';
    assertOrderMakerSignerProof({
      userId: user.userId,
      side: request.side,
      amountPrl: normalizeAmountString(request.amountPrl),
      priceUsdcPerPrl: normalizeAmountString(request.priceUsdcPerPrl),
      minFillPrl: request.minFillPrl ? normalizeAmountString(request.minFillPrl) : undefined,
      expiresAt: request.expiresAt ? new Date(request.expiresAt).toISOString() : undefined,
      makerPearlAddress: request.makerPearlAddress,
      makerUsdcAddress,
      makerPearlPubkey: request.makerPearlPubkey,
      pearlReleaseSigningMode: releaseSigningMode,
      signatureHex: request.makerPearlPubkeyProof,
    });
    const now = this.now().toISOString();
    const order: OtcOrder = {
      orderId: createRandomId('order'),
      makerUserId: user.userId,
      side: request.side,
      fundingAsset: request.side === 'sell_prl' ? 'PRL' : 'USDC',
      makerPearlAddress: request.makerPearlAddress.trim(),
      makerUsdcAddress,
      makerPearlPubkey: normalizeProofPubkeyForUser(request.makerPearlPubkey),
      makerPearlPubkeyProof: request.makerPearlPubkeyProof.trim(),
      pearlReleaseSigningMode: releaseSigningMode,
      amountPrl: normalizeAmountString(request.amountPrl),
      remainingPrl: normalizeAmountString(request.amountPrl),
      priceUsdcPerPrl: normalizeAmountString(request.priceUsdcPerPrl),
      ...(request.minFillPrl ? { minFillPrl: normalizeAmountString(request.minFillPrl) } : {}),
      status: 'open',
      ...(request.expiresAt ? { expiresAt: new Date(request.expiresAt).toISOString() } : {}),
      createdAt: now,
      updatedAt: now,
    };
    const saved = await this.repository.saveOrder(order);
    await this.awardUserPoints(user, ORDER_CREATED_POINTS, 'order_created', {
      orderId: saved.orderId,
      metadata: { side: saved.side, funding_asset: saved.fundingAsset },
    });
    return saved;
  }

  async createOrderQuote(orderId: string, request: CreateOrderQuoteRequest): Promise<OrderQuoteResponse> {
    validateCreateOrderQuoteRequest(orderId, request, this.config.pearlNetwork);
    const { user } = await this.verifyAndConsumeUserWalletChallenge(request.userId, request);
    const order = await this.repository.findOrderById(orderId);
    if (!order) throw new Error(`order not found: ${orderId}`);
    assertOrderFillable(order, request.amountPrl, this.now());
    if (order.makerUserId === user.userId) {
      throw new Error('maker cannot take their own order');
    }

    const takerUsdcAddress = getAddress(request.usdcAddress);
    const makerRole = getOrderMakerRole(order);
    const quoteRequest: CreateQuoteRequest = {
      side: order.side,
      amountPrl: normalizeAmountString(request.amountPrl),
      settlementAsset: 'USDC',
      settlementNetwork: 'base',
      buyerPearlAddress: makerRole === 'buyer' ? order.makerPearlAddress : request.pearlAddress,
      usdcRefundAddress: makerRole === 'buyer' ? order.makerUsdcAddress : takerUsdcAddress,
      clientRequestId: request.clientRequestId,
    };
    const quote = await this.createQuoteWithPrice(quoteRequest, order.priceUsdcPerPrl);
    await this.repository.saveOrderQuoteLink({
      quoteId: quote.quoteId,
      orderId: order.orderId,
      amountPrl: quote.amountPrl,
      takerPearlAddress: request.pearlAddress,
      takerUsdcAddress,
      createdAt: this.now().toISOString(),
    });
    return {
      quote,
      order,
      makerRole,
      acceptPrefill: createOrderQuoteAcceptPrefill(order, request.pearlAddress, takerUsdcAddress),
    };
  }

  async getOrderQuoteAcceptContext(quoteId: string): Promise<OrderQuoteAcceptContext> {
    assertNonEmptyBounded(quoteId, 'quoteId', 80);
    const link = await this.repository.findOrderQuoteLinkByQuoteId(quoteId);
    if (!link) {
      throw new Error(`order quote link not found: ${quoteId}`);
    }
    const order = await this.repository.findOrderById(link.orderId);
    if (!order) {
      throw new Error(`order not found: ${link.orderId}`);
    }
    const quote = await this.repository.findQuoteById(quoteId);
    if (!quote) {
      throw new Error(`quote not found: ${quoteId}`);
    }
    if (!link.takerPearlAddress || !link.takerUsdcAddress) {
      throw new Error(`quote missing order taker settlement fields: ${quoteId}`);
    }
    const makerRole = getOrderMakerRole(order);
    return {
      quoteId,
      order,
      makerRole,
      acceptPrefill: createOrderQuoteAcceptPrefill(order, link.takerPearlAddress, link.takerUsdcAddress),
    };
  }

  async listOrders(query: OrderBookQuery = {}): Promise<OrderBookPage> {
    return this.repository.listOrders({
      ...query,
      status: query.status ?? 'open',
      sort: query.sort ?? 'best_price',
    });
  }

  async getMarketStats(): Promise<MarketStats> {
    const [trades, orders, verifiedUsers] = await Promise.all([
      this.repository.listTrades(),
      this.repository.listOpenOrdersForStats(),
      this.repository.countUsers(),
    ]);
    const successfulTrades = trades.filter((trade) => trade.state === 'released');
    const activeEscrowTrades = trades.filter((trade) =>
      ['pearl_escrow_pending', 'pearl_escrow_seen', 'pearl_escrow_confirmed', 'usdc_escrow_pending', 'usdc_escrow_confirmed', 'release_pending'].includes(trade.state),
    );
    return {
      successfulTrades: successfulTrades.length,
      totalVolumePrl: sumDecimal(successfulTrades.map((trade) => trade.amountPrl), 8),
      totalVolumeUsdc: sumDecimal(successfulTrades.map((trade) => trade.amountUsdc), 6),
      activeOrderVolumePrl: sumDecimal(orders.map((order) => order.remainingPrl), 8),
      activeEscrowVolumePrl: sumDecimal(activeEscrowTrades.map((trade) => trade.amountPrl), 8),
      verifiedUsers,
      openOrders: orders.length,
    };
  }

  async listRecentTrades(limit = 25): Promise<RecentTradeSummary[]> {
    const trades = await this.repository.listTrades();
    return trades.slice(0, Math.max(1, Math.min(100, Math.floor(limit)))).map((trade) => ({
      tradeId: trade.tradeId,
      side: trade.side,
      amountPrl: trade.amountPrl,
      amountUsdc: trade.amountUsdc,
      priceUsdcPerPrl: calculateImpliedPrice(trade),
      state: trade.state,
      updatedAt: trade.updatedAt,
    }));
  }

  async getUserDashboard(userId: string, request: UserDashboardRequest): Promise<OtcUserDashboard> {
    const { user } = await this.verifyAndConsumeUserWalletChallenge(userId, request);
    const [orders, trades, points] = await Promise.all([
      this.repository.listOrdersByUser(user.userId),
      this.repository.listTradesForUser(user),
      this.getUserPoints(user.userId),
    ]);
    return { user, points, orders, trades };
  }

  async getUserPoints(userId: string): Promise<OtcPointsSummary> {
    const events = await this.repository.listPointEvents(userId);
    return summarizePoints(userId, events);
  }

  private async assertUsableWalletChallenge(challengeId: string) {
    assertNonEmptyBounded(challengeId, 'challengeId', 80);
    const challenge = await this.repository.findWalletChallenge(challengeId);
    if (!challenge) {
      throw new Error(`wallet challenge not found: ${challengeId}`);
    }
    if (challenge.consumedAt) {
      throw new Error('wallet challenge already used');
    }
    if (new Date(challenge.expiresAt).getTime() <= this.now().getTime()) {
      throw new Error('wallet challenge expired');
    }
    return challenge;
  }

  private async assertConsumeWalletChallenge(challengeId: string, consumedAt: string): Promise<void> {
    if (!(await this.repository.consumeWalletChallenge(challengeId, consumedAt))) {
      throw new Error('wallet challenge already used');
    }
  }

  private async verifyAndConsumeUserWalletChallenge(
    userId: string,
    request: UserDashboardRequest,
  ): Promise<{ user: OtcUser; challenge: OtcUserWalletChallenge }> {
    assertNonEmptyBounded(userId, 'userId', 80);
    const user = await this.repository.findUserById(userId);
    if (!user) throw new Error(`user not found: ${userId}`);
    const challenge = await this.assertUsableWalletChallenge(request.challengeId);
    if (
      challenge.walletType !== user.wallet.walletType ||
      challenge.network !== user.wallet.network ||
      challenge.address.toLowerCase() !== user.wallet.address.toLowerCase()
    ) {
      throw new Error('wallet challenge does not belong to user');
    }
    verifyWalletChallenge(challenge, request.signature, request.publicKeyHex);
    await this.assertConsumeWalletChallenge(challenge.challengeId, this.now().toISOString());
    return { user, challenge };
  }

  private async resolveReferralAttribution(
    newUserId: string,
    referralCode: string,
    sourceUrl: string | undefined,
    attributedAt: string,
  ) {
    const lookup = await this.resolveReferralCode(referralCode);
    if (lookup.ownerUserId === newUserId) {
      throw new Error('users cannot refer themselves');
    }
    return {
      referralCode: lookup.referralCode,
      referrerUserId: lookup.ownerUserId,
      ...(sourceUrl ? { sourceUrl: normalizeSourceUrl(sourceUrl) } : {}),
      attributedAt,
    };
  }

  private async saveUserWithFreshReferralCode(input: {
    userId: string;
    challenge: OtcUserWalletChallenge;
    request: RegisterUserRequest;
    now: string;
    referredBy?: {
      referralCode: string;
      referrerUserId: string;
      sourceUrl?: string;
      attributedAt: string;
    };
  }): Promise<OtcUser> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const referralCode = createRandomReferralCode();
      try {
        const user = await this.repository.saveUser({
          userId: input.userId,
          referralCode,
          wallet: {
            userId: input.userId,
            walletType: input.challenge.walletType,
            network: input.challenge.network,
            address: input.challenge.address,
            ...(input.request.publicKeyHex ? { publicKeyHex: normalizeProofPubkeyForUser(input.request.publicKeyHex) } : {}),
            verifiedAt: input.now,
          },
          profile: {
            userId: input.userId,
            ...(input.request.email ? { email: normalizeEmail(input.request.email) } : {}),
            notificationEmailEnabled: input.request.notificationEmailEnabled ?? false,
          },
          ...(input.referredBy ? { referredBy: input.referredBy } : {}),
        });
        await this.awardUserPoints(user, SIGNUP_POINTS, 'signup', {
          metadata: { wallet_type: user.wallet.walletType, network: user.wallet.network },
        });
        if (input.referredBy) {
          const referrer = await this.repository.findUserById(input.referredBy.referrerUserId);
          if (referrer) {
            await this.awardUserPoints(referrer, REFERRAL_SIGNUP_POINTS, 'referral_signup', {
              relatedUserId: user.userId,
              referralCode: input.referredBy.referralCode,
              metadata: { referred_user_id: user.userId },
              applyReferralBonus: false,
            });
          }
        }
        return user;
      } catch (error) {
        if (error instanceof Error && error.name === 'ReferralCodeCollisionError') {
          continue;
        }
        throw error;
      }
    }
    throw new Error('failed to allocate unique referral code');
  }

  private async awardUserPoints(
    user: OtcUser,
    points: number,
    source: OtcPointEvent['source'],
    options: {
      relatedUserId?: string;
      tradeId?: string;
      orderId?: string;
      referralCode?: string;
      metadata?: Record<string, unknown>;
      applyReferralBonus?: boolean;
    } = {},
  ): Promise<void> {
    const createdAt = this.now().toISOString();
    const event = await this.repository.savePointEvent({
      pointEventId: createStableId('points', [
        user.userId,
        source,
        options.relatedUserId ?? '',
        options.tradeId ?? '',
        options.orderId ?? '',
      ]),
      userId: user.userId,
      source,
      points,
      ...(options.relatedUserId ? { relatedUserId: options.relatedUserId } : {}),
      ...(options.tradeId ? { tradeId: options.tradeId } : {}),
      ...(options.orderId ? { orderId: options.orderId } : {}),
      ...(options.referralCode ? { referralCode: options.referralCode } : {}),
      metadata: options.metadata ?? {},
      createdAt,
    });
    if (!event.created || options.applyReferralBonus === false || !user.referredBy) {
      return;
    }
    const bonusPoints = Math.max(1, Math.floor((points * REFERRAL_ACTIVITY_BONUS_BPS) / 10_000));
    const referrer = await this.repository.findUserById(user.referredBy.referrerUserId);
    if (!referrer) return;
    await this.repository.savePointEvent({
      pointEventId: createStableId('points', [
        referrer.userId,
        'referral_activity_bonus',
        user.userId,
        event.event.pointEventId,
      ]),
      userId: referrer.userId,
      source: 'referral_activity_bonus',
      points: bonusPoints,
      relatedUserId: user.userId,
      ...(options.tradeId ? { tradeId: options.tradeId } : {}),
      ...(options.orderId ? { orderId: options.orderId } : {}),
      referralCode: user.referredBy.referralCode,
      metadata: { referred_point_event_id: event.event.pointEventId },
      createdAt,
    });
  }

  private async awardTradeCompletionPoints(trade: OtcTrade): Promise<void> {
    const candidates = [
      await this.repository.findUserByWallet('evm', this.config.baseNetwork, trade.buyerUsdcAddress),
      await this.repository.findUserByWallet('evm', this.config.baseNetwork, trade.sellerUsdcReceiveAddress),
    ].filter((user): user is OtcUser => Boolean(user));
    const uniqueUsers = new Map(candidates.map((user) => [user.userId, user]));
    for (const user of uniqueUsers.values()) {
      await this.awardUserPoints(user, TRADE_COMPLETED_POINTS, 'trade_completed', {
        tradeId: trade.tradeId,
        metadata: { state: trade.state, amount_prl: trade.amountPrl, amount_usdc: trade.amountUsdc },
      });
    }
  }

  async createQuote(request: CreateQuoteRequest): Promise<OtcQuote> {
    validateCreateQuoteRequest(request, this.config.pearlNetwork);
    return this.createQuoteWithPrice(request, this.config.priceUsdcPerPrl);
  }

  private async createQuoteWithPrice(request: CreateQuoteRequest, priceUsdcPerPrl: string): Promise<OtcQuote> {
    const requestHash = createPayloadHash('create_quote', request);
    const existing = await this.repository.findQuoteIdempotencyByClientRequestId(request.clientRequestId);
    if (existing) {
      assertRequestHashMatches('quote', request.clientRequestId, existing.requestHash, requestHash);
      return existing.quote;
    }

    if (request.settlementAsset !== 'USDC' || request.settlementNetwork !== 'base') {
      throw new Error('unsupported settlement route');
    }

    const amounts = calculateQuoteAmounts(request.amountPrl, priceUsdcPerPrl, this.config.feeBps);
    const createdAt = this.now();
    const quote: OtcQuote = {
      quoteId: createStableId('quote', [request.clientRequestId, request.side, amounts.amountPrl]),
      side: request.side,
      ...amounts,
      settlementAsset: 'USDC',
      settlementNetwork: 'base',
      expiresAt: new Date(createdAt.getTime() + this.config.quoteTtlMs).toISOString(),
      status: 'active',
    };

    await this.repository.saveQuote(quote, request.clientRequestId, requestHash);
    return quote;
  }

  async getQuote(quoteId: string): Promise<OtcQuote> {
    const quote = await this.repository.findQuoteById(quoteId);
    if (!quote) {
      throw new Error(`quote not found: ${quoteId}`);
    }
    return quote;
  }

  async acceptQuote(quoteId: string, request: AcceptQuoteRequest): Promise<OtcTrade> {
    validateAcceptQuoteRequest(request, this.config.pearlNetwork);
    const requestHash = createPayloadHash('accept_quote', { quoteId, ...request });
    const existing = await this.repository.findTradeIdempotencyByClientRequestId(request.clientRequestId);
    if (existing) {
      assertRequestHashMatches('trade', request.clientRequestId, existing.requestHash, requestHash);
      await this.ensurePearlEscrowWatch(existing.trade);
      return existing.trade;
    }

    const quote = await this.repository.findQuoteById(quoteId);
    if (!quote) {
      throw new Error(`quote not found: ${quoteId}`);
    }
    if (quote.status !== 'active') {
      throw new Error(`quote is not active: ${quote.status}`);
    }
    const acceptedAt = this.now();
    if (new Date(quote.expiresAt).getTime() <= acceptedAt.getTime()) {
      throw new Error('quote expired');
    }
    if (await this.repository.findTradeByQuoteId(quoteId)) {
      throw new Error('quote already accepted');
    }
    const orderLink = await this.repository.findOrderQuoteLinkByQuoteId(quoteId);
    const linkedOrder = orderLink ? await this.repository.findOrderById(orderLink.orderId) : undefined;
    if (orderLink && !linkedOrder) {
      throw new Error(`linked order not found: ${orderLink.orderId}`);
    }
    if (linkedOrder && orderLink) {
      assertOrderAcceptMatchesMaker(linkedOrder, request, this.config);
      assertOrderFillable(linkedOrder, orderLink.amountPrl, acceptedAt);
    }
    assertEscrowModeMatchesAllocator(request.pearlEscrowMode, this.config);
    assertMultisigSignerProofs(quoteId, request, this.config, linkedOrder);
    this.assertPearlEscrowWatchRegistrarConfigured();

    const tradeId = createStableId('trade', [quote.quoteId, request.clientRequestId]);
    const baseConfig = getUsdcEscrowNetworkConfig(this.config.baseNetwork);
    const timestamp = acceptedAt.toISOString();
    const deadlines = createTradeDeadlines(quote, acceptedAt, this.config);
    const pearlEscrow = await this.pearlEscrowAllocator.allocateEscrow({
      tradeId,
      quote,
      request,
      config: this.config,
      deadlines,
    });
    const trade: OtcTrade = {
      tradeId,
      quoteId,
      state: 'pearl_escrow_pending',
      side: quote.side,
      amountPrl: quote.amountPrl,
      amountUsdc: quote.amountUsdc,
      feePrl: quote.feePrl,
      feeUsdc: quote.feeUsdc,
      buyerPearlAddress: request.buyerPearlAddress,
      buyerUsdcAddress: request.buyerUsdcAddress,
      sellerPearlRefundAddress: request.sellerPearlRefundAddress,
      sellerUsdcReceiveAddress: request.sellerUsdcReceiveAddress,
      pearlEscrowMode: request.pearlEscrowMode ?? defaultPearlEscrowMode(this.config),
      pearlReleaseSigningMode: request.pearlReleaseSigningMode ?? 'manual_after_base_deposit',
      ...(request.buyerPearlPubkey ? { buyerPearlPubkey: request.buyerPearlPubkey } : {}),
      ...(request.sellerPearlPubkey ? { sellerPearlPubkey: request.sellerPearlPubkey } : {}),
      pearlEscrow,
      usdcEscrow: {
        network: 'base',
        chainId: baseConfig.chainId,
        contract: this.config.baseEscrowContract,
        usdcToken: baseConfig.usdcToken,
        tradeKey: createTradeKey(tradeId),
        expectedAmountMicros: (parseUsdcToMicros(quote.amountUsdc) + parseUsdcToMicros(quote.feeUsdc)).toString(),
        requiredConfirmations: baseConfig.requiredConfirmations,
        expiresAt: deadlines.usdcDepositDeadline,
      },
      deadlines,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const acceptedEvent = {
      tradeId,
      fromState: 'quoted',
      toState: 'pearl_escrow_pending',
      source: 'system',
      sourceEventId: createStableId('event', [tradeId, 'accept']),
      observedAt: timestamp,
    } as const;
    await this.repository.saveAcceptedTrade({
      trade,
      clientRequestId: request.clientRequestId,
      requestHash,
      event: acceptedEvent,
      ...(linkedOrder && orderLink
        ? { orderFill: { orderId: linkedOrder.orderId, amountPrl: orderLink.amountPrl, updatedAt: timestamp } }
        : {}),
    });
    await this.ensurePearlEscrowWatch(trade);

    return trade;
  }

  private async ensurePearlEscrowWatch(trade: OtcTrade): Promise<void> {
    if (this.config.pearlEscrowAllocator === 'mock') {
      return;
    }
    this.assertPearlEscrowWatchRegistrarConfigured();
    if (!this.pearlEscrowWatchRegistrar) return;
    const registration = await this.pearlEscrowWatchRegistrar.registerPearlEscrowWatch(trade);
    const timestamp = this.now().toISOString();
    const requestHash = createPayloadHash('pearl_watch_register', {
      tradeId: trade.tradeId,
      watchId: registration.watchId,
      address: registration.address,
      network: registration.network,
      requiredConfirmations: registration.requiredConfirmations,
      expectedAmountGrains: trade.pearlEscrow.expectedAmountGrains,
    });
    await this.repository.saveSideEffect({
      idempotencyKey: createStableId('side-effect', [trade.tradeId, 'pearl-watch-register']),
      requestHash,
      tradeId: trade.tradeId,
      effectType: 'pearl_watch_register',
      status: 'confirmed',
      actor: 'otc-api',
      sourceEventId: registration.watchId,
      metadata: {
        watch_id: registration.watchId,
        address: registration.address,
        network: registration.network,
        required_confirmations: registration.requiredConfirmations,
        ...registration.metadata,
      },
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  private assertPearlEscrowWatchRegistrarConfigured(): void {
    if (this.config.pearlEscrowAllocator !== 'mock' && !this.pearlEscrowWatchRegistrar) {
      throw new Error(`Pearl indexer watch registrar is required when PEARL_ESCROW_ALLOCATOR=${this.config.pearlEscrowAllocator}`);
    }
  }

  async transitionTrade(tradeId: string, toState: TradeState, sourceEventId: string): Promise<OtcTrade> {
    const trade = await this.repository.findTradeById(tradeId);
    if (!trade) {
      throw new Error(`trade not found: ${tradeId}`);
    }
    assertTradeTransition(trade.state, toState);

    const updatedAt = this.now().toISOString();
    const updated: OtcTrade = {
      ...trade,
      state: toState,
      updatedAt,
    };
    await this.repository.updateTrade(updated);
    await this.repository.appendEvent({
      tradeId,
      fromState: trade.state,
      toState,
      source: 'system',
      sourceEventId,
      observedAt: updatedAt,
    });
    if (toState === 'released') {
      await this.awardTradeCompletionPoints(updated);
    }
    return updated;
  }

  async getTrade(tradeId: string): Promise<OtcTrade> {
    const trade = await this.repository.findTradeById(tradeId);
    if (!trade) {
      throw new Error(`trade not found: ${tradeId}`);
    }
    return trade;
  }

  async getPublicProof(tradeId: string): Promise<PublicTradeProof> {
    const trade = await this.getTrade(tradeId);
    const events = await this.repository.listEvents(tradeId);
    const pearlIndexedProof = await this.getPearlIndexedProof(trade);
    return createPublicProof(trade, events, this.now(), pearlIndexedProof);
  }

  async getPearlReleaseSigningIntent(tradeId: string): Promise<PearlReleaseSigningIntent> {
    const trade = await this.getTrade(tradeId);
    const signerSets = getReleaseSignerSets(trade);
    const base: Omit<PearlReleaseSigningIntent, 'status'> = {
      tradeId,
      action: 'release',
      signingMode: trade.pearlReleaseSigningMode,
      signerSets,
      workerCanFinishWithArbiter: signerSets.some((set) => set.includes('arbiter')),
    };

    if (trade.pearlEscrowMode !== 'multisig') {
      return { ...base, status: 'not_ready', reason: 'trade was not allocated with multisig Pearl escrow' };
    }
    const pearlIndexedProof = await this.getPearlIndexedProof(trade);
    const fundingOutpoint = trade.pearlEscrow.fundingOutpoint ?? pearlIndexedProof?.escrowOutpoint;
    if (!fundingOutpoint) {
      return { ...base, status: 'not_ready', reason: 'Pearl funding outpoint is not indexed yet' };
    }

    const fundedTrade = trade.pearlEscrow.fundingOutpoint === fundingOutpoint
      ? trade
      : {
          ...trade,
          pearlEscrow: {
            ...trade.pearlEscrow,
            fundingOutpoint,
          },
        };
    const escrow = pearlEscrowPackageFromTrade(fundedTrade);
    const unsignedTx = createPearlEscrowUnsignedTx({
      escrow,
      kind: 'release',
      feeGrains: this.config.pearlReleaseFeeGrains ?? '0',
    });
    return {
      ...base,
      status: 'ready',
      unsignedTxHex: unsignedTx.unsignedTxHex,
      txTemplateHash: createPearlEscrowTxTemplateHash(unsignedTx),
      inputOutpoint: unsignedTx.inputOutpoint,
      inputAmountGrains: unsignedTx.inputAmountGrains,
      outputAmountGrains: unsignedTx.outputAmountGrains,
      feeGrains: unsignedTx.feeGrains,
      destinationAddress: fundedTrade.buyerPearlAddress,
    };
  }

  private async getPearlIndexedProof(trade: OtcTrade): Promise<PearlIndexedProof | undefined> {
    if (this.config.pearlEscrowAllocator === 'mock') {
      return undefined;
    }
    if (!this.pearlProofReader) {
      throw new Error(`Pearl proof reader is required when PEARL_ESCROW_ALLOCATOR=${this.config.pearlEscrowAllocator}`);
    }
    return this.pearlProofReader.getPearlIndexedProof(trade);
  }

  async prepareUsdcCreateTrade(
    tradeId: string,
    request: PrepareUsdcCreateTradeRequest,
  ): Promise<UsdcCreateTradeIntent> {
    const trade = await this.getTrade(tradeId);
    if (tradeStateIsTerminal(trade.state)) {
      throw new Error(`trade is terminal: ${trade.state}`);
    }
    if (new Date(trade.deadlines.usdcDepositDeadline).getTime() < this.now().getTime()) {
      throw new Error('usdc deposit deadline passed');
    }

    const expected = createExpectedUsdcTerms(trade);
    const sideEffect = await this.saveSideEffect(tradeId, {
      idempotencyKey: request.idempotencyKey,
      effectType: 'usdc_create_trade',
      status: 'prepared',
      actor: request.actor,
      sourceEventId: createStableId('event', [tradeId, 'usdc_create_trade', request.idempotencyKey]),
      chainId: trade.usdcEscrow.chainId,
      metadata: {
        contract: trade.usdcEscrow.contract,
        trade_key: trade.usdcEscrow.tradeKey,
        buyer: expected.buyer,
        seller: expected.seller,
        amount_micros: expected.amountMicros,
        fee_micros: expected.feeMicros,
        expiry_unix_seconds: expected.expiryUnixSeconds,
      },
    });

    return {
      tradeId,
      contract: trade.usdcEscrow.contract,
      chainId: trade.usdcEscrow.chainId,
      tradeKey: trade.usdcEscrow.tradeKey,
      buyer: expected.buyer,
      seller: expected.seller,
      amountMicros: expected.amountMicros,
      feeMicros: expected.feeMicros,
      expiryUnixSeconds: expected.expiryUnixSeconds,
      sideEffect,
    };
  }

  async verifyUsdcEscrowTerms(tradeId: string): Promise<UsdcEscrowVerification> {
    if (!this.usdcEscrowReader) {
      throw new Error('usdc escrow reader unavailable');
    }
    const trade = await this.getTrade(tradeId);
    const expected = createExpectedUsdcTerms(trade);
    const onChain = await this.usdcEscrowReader.getTrade(trade.usdcEscrow.tradeKey);
    const mismatches = compareUsdcTerms(expected, onChain);
    const verified = mismatches.length === 0;
    return {
      tradeId,
      verified,
      depositAllowed:
        verified &&
        onChain.status === 'created' &&
        !tradeStateIsTerminal(trade.state) &&
        new Date(trade.deadlines.usdcDepositDeadline).getTime() >= this.now().getTime(),
      mismatches,
      expected: {
        contract: trade.usdcEscrow.contract,
        chainId: trade.usdcEscrow.chainId,
        tradeKey: trade.usdcEscrow.tradeKey,
        usdcToken: trade.usdcEscrow.usdcToken,
        ...expected,
      },
      onChain,
    };
  }

  async recordSideEffect(tradeId: string, request: RecordSideEffectRequest): Promise<OtcSideEffect> {
    await this.getTrade(tradeId);
    return this.saveSideEffect(tradeId, request);
  }

  async listSideEffects(tradeId: string): Promise<OtcSideEffect[]> {
    await this.getTrade(tradeId);
    return this.repository.listSideEffects(tradeId);
  }

  async listAdminTrades(query: AdminTradeQuery = {}): Promise<AdminTradeListPage> {
    const trades = await this.repository.listTrades();
    const summaries = await Promise.all(
      trades
        .filter((trade) => tradeMatchesAdminQuery(trade, query))
        .map(async (trade) => this.createAdminTradeSummary(trade)),
    );
    const filtered = summaries.filter((summary) => summaryMatchesAdminQuery(summary, query));
    const limit = clampAdminLimit(query.limit);
    const offset = parseCursor(query.cursor);
    const items = filtered.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    return {
      items,
      ...(nextOffset < filtered.length ? { nextCursor: String(nextOffset) } : {}),
      total: filtered.length,
      limit,
    };
  }

  async getAdminTradeDebug(tradeId: string, options: AdminTradeDebugOptions = {}): Promise<AdminTradeDebugDetail> {
    const trade = await this.getTrade(tradeId);
    const [events, sideEffects, proof] = await Promise.all([
      this.repository.listEvents(tradeId),
      this.repository.listSideEffects(tradeId),
      this.getPublicProof(tradeId),
    ]);
    const redaction = options.redaction ?? 'admin';
    const visibleTrade = redactTradeForAdmin(trade, redaction);
    const visibleSideEffects = sideEffects.map((effect) => redactSideEffectForAdmin(effect, redaction));
    return {
      trade: visibleTrade,
      events,
      sideEffects: visibleSideEffects,
      proof,
      currentBlockers: getCurrentBlockers(trade, sideEffects, this.now()),
      deadlineBreaches: getDeadlineBreaches(trade, this.now()),
      safeActions: getSafeAdminActions(trade, sideEffects),
      redaction,
      supportSummary: createSupportSummary(trade, sideEffects, this.now()),
    };
  }

  async recordSupportAlert(
    tradeId: string,
    request: RecordSupportAlertRequest,
    options: SupportAlertOptions = {},
  ): Promise<OtcSideEffect> {
    const trade = await this.getTrade(tradeId);
    assertNonEmpty(request.idempotencyKey, 'idempotencyKey');
    assertNonEmpty(request.message, 'message');
    assertNonEmpty(request.actor, 'actor');
    assertOneOf(request.severity, 'severity', ['info', 'warning', 'critical']);
    if (request.source !== undefined) {
      assertOneOf(request.source, 'source', ['user', 'operator', 'system']);
    }
    if (!options.skipRateLimit) {
      this.assertSupportAlertRateLimit(tradeId, request.severity, options.rateLimitKey ?? 'anonymous');
    }
    const { sideEffect, created } = await this.saveSideEffectWithCreated(tradeId, {
      idempotencyKey: request.idempotencyKey,
      effectType: 'support_alert',
      status: request.severity === 'critical' ? 'failed' : 'prepared',
      actor: request.actor,
      sourceEventId: createStableId('event', [tradeId, 'support-alert', request.idempotencyKey]),
      metadata: {
        ...(request.metadata ?? {}),
        severity: request.severity,
        message: request.message,
        source: request.source ?? 'user',
        ...(request.contact ? { contact: request.contact } : {}),
      },
    });
    if (created) {
      await this.deliverSupportAlert(trade, sideEffect);
    }
    return sideEffect;
  }

  private assertSupportAlertRateLimit(tradeId: string, severity: string, rateLimitKey: string): void {
    const limit = this.config.supportAlertRateLimitMax;
    const windowMs = this.config.supportAlertRateLimitWindowMs;
    if (limit <= 0 || windowMs <= 0) {
      return;
    }
    const nowMs = this.now().getTime();
    const bucketKey = `${tradeId}:${severity}:${rateLimitKey}`;
    const recent = (this.supportAlertRateLimitBuckets.get(bucketKey) ?? []).filter((timestamp) => nowMs - timestamp < windowMs);
    if (recent.length >= limit) {
      throw new Error('support alert rate limit exceeded');
    }
    this.supportAlertRateLimitBuckets.set(bucketKey, [...recent, nowMs]);
  }

  async markManualReview(
    tradeId: string,
    request: MarkManualReviewRequest,
    options: MarkManualReviewOptions = {},
  ): Promise<AdminTradeDebugDetail> {
    const trade = await this.getTrade(tradeId);
    assertNonEmpty(request.idempotencyKey, 'idempotencyKey');
    assertNonEmpty(request.reason, 'reason');
    const actor = options.actor ?? request.actor;
    assertNonEmpty(actor, 'actor');
    const timestamp = this.now().toISOString();
    if (trade.state !== 'failed_manual_review') {
      assertTradeTransition(trade.state, 'failed_manual_review');
      await this.repository.updateTrade({
        ...trade,
        state: 'failed_manual_review',
        updatedAt: timestamp,
      });
      await this.repository.appendEvent({
        tradeId,
        fromState: trade.state,
        toState: 'failed_manual_review',
        source: 'admin',
        sourceEventId: createStableId('event', [tradeId, 'manual-review', request.idempotencyKey]),
        observedAt: timestamp,
        metadata: {
          actor,
          reason: request.reason,
        },
      });
    }
    await this.saveSideEffect(tradeId, {
      idempotencyKey: request.idempotencyKey,
      effectType: 'manual_review_note',
      status: 'confirmed',
      actor,
      sourceEventId: createStableId('event', [tradeId, 'manual-review-note', request.idempotencyKey]),
      metadata: {
        ...(request.metadata ?? {}),
        reason: request.reason,
      },
    });
    return this.getAdminTradeDebug(tradeId);
  }

  async replaySupportAlertDelivery(
    tradeId: string,
    supportAlertIdempotencyKey: string,
    request: ReplaySupportAlertRequest,
    options: MarkManualReviewOptions = {},
  ): Promise<OtcSideEffect> {
    const trade = await this.getTrade(tradeId);
    assertNonEmpty(supportAlertIdempotencyKey, 'supportAlertIdempotencyKey');
    assertNonEmpty(request.idempotencyKey, 'idempotencyKey');
    const actor = options.actor ?? request.actor;
    assertNonEmpty(actor, 'actor');
    if (!this.supportAlertNotifier) {
      throw new Error('support alert notifier unavailable');
    }
    const sideEffects = await this.repository.listSideEffects(tradeId);
    const alert = sideEffects.find(
      (effect) => effect.idempotencyKey === supportAlertIdempotencyKey && effect.effectType === 'support_alert',
    );
    if (!alert) {
      throw new Error(`support alert not found: ${supportAlertIdempotencyKey}`);
    }
    try {
      await this.supportAlertNotifier.notifySupportAlert({
        trade,
        alert,
        supportSummary: createSupportSummary(trade, sideEffects, this.now()),
      });
      return this.saveSideEffect(tradeId, {
        idempotencyKey: request.idempotencyKey,
        effectType: 'support_alert_delivery',
        status: 'confirmed',
        actor,
        sourceEventId: createStableId('event', [tradeId, 'support-alert-replay', request.idempotencyKey]),
        metadata: {
          supportAlertIdempotencyKey,
          replay: true,
        },
      });
    } catch (error) {
      return this.saveSideEffect(tradeId, {
        idempotencyKey: request.idempotencyKey,
        effectType: 'support_alert_delivery',
        status: 'failed',
        actor,
        sourceEventId: createStableId('event', [tradeId, 'support-alert-replay', request.idempotencyKey]),
        metadata: {
          supportAlertIdempotencyKey,
          replay: true,
          error: error instanceof Error ? error.message : 'unknown support alert delivery error',
        },
      });
    }
  }

  private async saveSideEffect(tradeId: string, request: RecordSideEffectRequest): Promise<OtcSideEffect> {
    const { sideEffect } = await this.saveSideEffectWithCreated(tradeId, request);
    return sideEffect;
  }

  private async saveSideEffectWithCreated(
    tradeId: string,
    request: RecordSideEffectRequest,
  ): Promise<{ sideEffect: OtcSideEffect; created: boolean }> {
    const timestamp = this.now().toISOString();
    return this.repository.saveSideEffect({
      idempotencyKey: request.idempotencyKey,
      requestHash: createPayloadHash('side_effect', { tradeId, ...request }),
      tradeId,
      effectType: request.effectType,
      status: request.status,
      actor: request.actor,
      ...(request.sourceEventId ? { sourceEventId: request.sourceEventId } : {}),
      ...(request.txHash ? { txHash: request.txHash } : {}),
      ...(request.outpoint ? { outpoint: request.outpoint } : {}),
      ...(request.blockNumber == null ? {} : { blockNumber: request.blockNumber }),
      ...(request.blockHash ? { blockHash: request.blockHash } : {}),
      ...(request.chainId == null ? {} : { chainId: request.chainId }),
      metadata: request.metadata ?? {},
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  private async deliverSupportAlert(trade: OtcTrade, alert: OtcSideEffect): Promise<void> {
    if (!this.supportAlertNotifier) {
      return;
    }
    const sideEffects = await this.repository.listSideEffects(trade.tradeId);
    const deliveryIdempotencyKey = createStableId('side-effect', [
      trade.tradeId,
      'support-alert-delivery',
      alert.idempotencyKey,
    ]);
    try {
      await this.supportAlertNotifier.notifySupportAlert({
        trade,
        alert,
        supportSummary: createSupportSummary(trade, sideEffects, this.now()),
      });
      await this.saveSideEffect(trade.tradeId, {
        idempotencyKey: deliveryIdempotencyKey,
        effectType: 'support_alert_delivery',
        status: 'confirmed',
        actor: 'system',
        sourceEventId: createStableId('event', [trade.tradeId, 'support-alert-delivery', alert.idempotencyKey]),
        metadata: {
          supportAlertIdempotencyKey: alert.idempotencyKey,
        },
      });
    } catch (error) {
      await this.saveSideEffect(trade.tradeId, {
        idempotencyKey: deliveryIdempotencyKey,
        effectType: 'support_alert_delivery',
        status: 'failed',
        actor: 'system',
        sourceEventId: createStableId('event', [trade.tradeId, 'support-alert-delivery', alert.idempotencyKey]),
        metadata: {
          supportAlertIdempotencyKey: alert.idempotencyKey,
          error: error instanceof Error ? error.message : 'unknown support alert delivery error',
        },
      });
    }
  }

  private async createAdminTradeSummary(trade: OtcTrade): Promise<AdminTradeSummary> {
    const sideEffects = await this.repository.listSideEffects(trade.tradeId);
    const now = this.now();
    return {
      tradeId: trade.tradeId,
      quoteId: trade.quoteId,
      state: trade.state,
      side: trade.side,
      amountPrl: trade.amountPrl,
      amountUsdc: trade.amountUsdc,
      ageMs: Math.max(0, now.getTime() - new Date(trade.createdAt).getTime()),
      updatedAgeMs: Math.max(0, now.getTime() - new Date(trade.updatedAt).getTime()),
      currentBlockers: getCurrentBlockers(trade, sideEffects, now),
      deadlineBreaches: getDeadlineBreaches(trade, now),
      manualReview: isManualReviewTrade(trade),
      alertCount: sideEffects.filter((effect) => effect.effectType === 'support_alert').length,
      failedSideEffectCount: sideEffects.filter((effect) => effect.status === 'failed').length,
      ...getAlertSummaryFields(sideEffects),
      safeActions: getSafeAdminActions(trade, sideEffects),
      updatedAt: trade.updatedAt,
    };
  }
}

function summaryMatchesAdminQuery(summary: AdminTradeSummary, query: AdminTradeQuery): boolean {
  if (query.manualReviewOnly && !summary.manualReview) {
    return false;
  }
  if (query.severity && summary.latestAlertSeverity !== query.severity) {
    return false;
  }
  if (query.failedSideEffectOnly && summary.failedSideEffectCount === 0) {
    return false;
  }
  if (query.deadlineBreachedOnly && summary.deadlineBreaches.length === 0) {
    return false;
  }
  if (query.blocker && !summary.currentBlockers.includes(query.blocker)) {
    return false;
  }
  if (query.minUpdatedAgeMs != null && summary.updatedAgeMs < query.minUpdatedAgeMs) {
    return false;
  }
  if (query.alertDeliveryStatus && summary.alertDeliveryStatus !== query.alertDeliveryStatus) {
    return false;
  }
  return true;
}

function getAlertSummaryFields(
  sideEffects: OtcSideEffect[],
): Pick<AdminTradeSummary, 'latestAlertSeverity' | 'alertDeliveryStatus'> {
  const latestAlert = sideEffects
    .filter((effect) => effect.effectType === 'support_alert')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const latestDelivery = sideEffects
    .filter((effect) => effect.effectType === 'support_alert_delivery')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return {
    ...(isAlertSeverity(latestAlert?.metadata.severity) ? { latestAlertSeverity: latestAlert.metadata.severity } : {}),
    ...(latestDelivery ? { alertDeliveryStatus: latestDelivery.status } : {}),
  };
}

function clampAdminLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) {
    return 50;
  }
  return Math.min(100, Math.max(1, Math.floor(limit)));
}

function parseCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0;
  }
  const parsed = Number(cursor);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function tradeMatchesAdminQuery(trade: OtcTrade, query: AdminTradeQuery): boolean {
  if (query.state && trade.state !== query.state) {
    return false;
  }
  if (!query.search) {
    return true;
  }
  const needle = query.search.toLowerCase();
  return [
    trade.tradeId,
    trade.quoteId,
    trade.buyerPearlAddress,
    trade.buyerUsdcAddress,
    trade.sellerPearlRefundAddress,
    trade.sellerUsdcReceiveAddress,
    trade.pearlEscrow.address,
    trade.pearlEscrow.fundingOutpoint,
    trade.pearlEscrow.releaseTxid,
    trade.pearlEscrow.refundTxid,
    trade.usdcEscrow.tradeKey,
    trade.usdcEscrow.depositTxHash,
    trade.usdcEscrow.releaseTxHash,
    trade.usdcEscrow.refundTxHash,
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(needle));
}

function redactTradeForAdmin(trade: OtcTrade, redaction: AdminTradeDebugOptions['redaction']): OtcTrade {
  if (redaction !== 'support') {
    return trade;
  }
  return {
    ...trade,
    buyerPearlAddress: redactValue(trade.buyerPearlAddress),
    buyerUsdcAddress: redactValue(trade.buyerUsdcAddress),
    sellerPearlRefundAddress: redactValue(trade.sellerPearlRefundAddress),
    sellerUsdcReceiveAddress: redactValue(trade.sellerUsdcReceiveAddress),
    pearlEscrow: {
      ...trade.pearlEscrow,
      address: redactValue(trade.pearlEscrow.address),
    },
  };
}

function redactSideEffectForAdmin(
  sideEffect: OtcSideEffect,
  redaction: AdminTradeDebugOptions['redaction'],
): OtcSideEffect {
  if (redaction !== 'support') {
    return sideEffect;
  }
  const metadata = { ...sideEffect.metadata };
  if (metadata.contact) {
    metadata.contact = redactValue(String(metadata.contact));
  }
  return {
    ...sideEffect,
    metadata,
  };
}

function redactValue(value: string): string {
  if (value.length <= 10) {
    return '[redacted]';
  }
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function getCurrentBlockers(trade: OtcTrade, sideEffects: OtcSideEffect[], now: Date): string[] {
  const blockers = new Set<string>();
  if (isManualReviewTrade(trade)) {
    blockers.add(`manual_review:${trade.state}`);
  }
  for (const breach of getDeadlineBreaches(trade, now)) {
    blockers.add(`deadline:${breach}`);
  }
  for (const effect of sideEffects) {
    if (effect.status === 'failed') {
      blockers.add(`failed_side_effect:${effect.effectType}`);
    }
  }
  if (trade.state === 'pearl_escrow_pending') blockers.add('waiting_for_prl_funding');
  if (trade.state === 'usdc_escrow_pending') blockers.add('waiting_for_usdc_deposit');
  if (trade.state === 'release_pending') blockers.add('waiting_for_prl_release_confirmation');
  if (tradeStateIsTerminal(trade.state)) blockers.add(`terminal:${trade.state}`);
  return Array.from(blockers).sort();
}

function getDeadlineBreaches(trade: OtcTrade, now: Date): string[] {
  const breaches: string[] = [];
  const deadlines = [
    ['quote_expires_at', trade.deadlines.quoteExpiresAt],
    ['pearl_funding_deadline', trade.deadlines.pearlFundingDeadline],
    ['usdc_deposit_deadline', trade.deadlines.usdcDepositDeadline],
    ['settlement_deadline', trade.deadlines.settlementDeadline],
    ['refund_available_at', trade.deadlines.refundAvailableAt],
  ] as const;
  for (const [name, value] of deadlines) {
    if (new Date(value).getTime() < now.getTime() && !tradeStateIsTerminal(trade.state)) {
      breaches.push(name);
    }
  }
  return breaches;
}

function getSafeAdminActions(trade: OtcTrade, sideEffects: OtcSideEffect[]): string[] {
  const actions = new Set<string>(['record_support_alert', 'copy_support_summary']);
  if (!tradeStateIsTerminal(trade.state)) {
    actions.add('mark_manual_review');
    actions.add('refresh_proof');
  }
  if (sideEffects.some((effect) => effect.status === 'failed')) {
    actions.add('inspect_failed_side_effect');
  }
  if (sideEffects.some((effect) => effect.effectType === 'pearl_watch_register' && effect.status === 'failed')) {
    actions.add('retry_watch_registration');
  }
  if (trade.state === 'prl_release_failed') {
    actions.add('inspect_prl_release_package');
  }
  return Array.from(actions).sort();
}

function createSupportSummary(
  trade: OtcTrade,
  sideEffects: OtcSideEffect[],
  now: Date,
): AdminTradeDebugDetail['supportSummary'] {
  const blockers = getCurrentBlockers(trade, sideEffects, now);
  const nextDeadline = findNextDeadline(trade, now);
  return {
    headline: `Trade ${trade.tradeId} is ${trade.state}`,
    waitingOn: blockers.length > 0 ? blockers : ['no_current_blocker_detected'],
    ...(nextDeadline ? { nextDeadline } : {}),
    publicProofPath: `/otc/trades/${trade.tradeId}/proof`,
  };
}

function findNextDeadline(
  trade: OtcTrade,
  now: Date,
): AdminTradeDebugDetail['supportSummary']['nextDeadline'] | undefined {
  return [
    ['quote_expires_at', trade.deadlines.quoteExpiresAt],
    ['pearl_funding_deadline', trade.deadlines.pearlFundingDeadline],
    ['usdc_deposit_deadline', trade.deadlines.usdcDepositDeadline],
    ['settlement_deadline', trade.deadlines.settlementDeadline],
    ['refund_available_at', trade.deadlines.refundAvailableAt],
  ]
    .map(([name, at]) => ({ name, at, msRemaining: new Date(at).getTime() - now.getTime() }))
    .filter((deadline) => deadline.msRemaining >= 0)
    .sort((a, b) => a.msRemaining - b.msRemaining)[0];
}

function isManualReviewTrade(trade: OtcTrade): boolean {
  return [
    'failed_manual_review',
    'late_prl_funding',
    'usdc_refunded',
    'prl_release_failed',
    'amount_mismatch',
    'reorged',
    'stale_indexer',
    'unknown_spend',
  ].includes(trade.state);
}

function assertNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} is required`);
  }
}

function assertOneOf<T extends string>(value: unknown, field: string, allowed: readonly T[]): asserts value is T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${field} is invalid`);
  }
}

function isAlertSeverity(value: unknown): value is 'info' | 'warning' | 'critical' {
  return value === 'info' || value === 'warning' || value === 'critical';
}

function validateCreateWalletChallengeRequest(
  request: CreateWalletChallengeRequest,
  pearlNetwork: OtcApiConfig['pearlNetwork'],
): void {
  if (request.walletType !== 'evm' && request.walletType !== 'pearl') {
    throw new Error('walletType must be evm or pearl');
  }
  assertNonEmptyBounded(request.network, 'network', 40);
  if (request.walletType === 'evm') {
    assertEvmAddress(request.address, 'address');
  } else {
    assertLikelyPearlAddress(request.address, 'address', pearlNetwork);
  }
}

function validateCreateOrderRequest(request: CreateOrderRequest, pearlNetwork: OtcApiConfig['pearlNetwork']): void {
  assertNonEmptyBounded(request.userId, 'userId', 80);
  assertOneOf(request.side, 'side', ['buy_prl', 'sell_prl']);
  assertLikelyPearlAddress(request.makerPearlAddress, 'makerPearlAddress', pearlNetwork);
  assertEvmAddress(request.makerUsdcAddress, 'makerUsdcAddress');
  assertLikelyPearlPubkey(request.makerPearlPubkey, 'makerPearlPubkey');
  assertLikelySchnorrSignature(request.makerPearlPubkeyProof, 'makerPearlPubkeyProof');
  if (
    request.pearlReleaseSigningMode &&
    !['preauthorize_release', 'manual_after_base_deposit'].includes(request.pearlReleaseSigningMode)
  ) {
    throw new Error('pearlReleaseSigningMode must be preauthorize_release or manual_after_base_deposit');
  }
  assertPositiveAmount(request.amountPrl, 'amountPrl', parsePrlToGrains);
  assertPositiveDecimal(request.priceUsdcPerPrl, 'priceUsdcPerPrl', 6);
  if (request.minFillPrl) {
    assertPositiveAmount(request.minFillPrl, 'minFillPrl', parsePrlToGrains);
  }
  if (request.expiresAt && Number.isNaN(new Date(request.expiresAt).getTime())) {
    throw new Error('expiresAt must be a valid timestamp');
  }
  assertNonEmptyBounded(request.challengeId, 'challengeId', 80);
  assertNonEmptyBounded(request.signature, 'signature', 1024);
}

function validateCreateOrderQuoteRequest(
  orderId: string,
  request: CreateOrderQuoteRequest,
  pearlNetwork: OtcApiConfig['pearlNetwork'],
): void {
  assertNonEmptyBounded(orderId, 'orderId', 80);
  assertNonEmptyBounded(request.userId, 'userId', 80);
  assertPositiveAmount(request.amountPrl, 'amountPrl', parsePrlToGrains);
  assertLikelyPearlAddress(request.pearlAddress, 'pearlAddress', pearlNetwork);
  assertEvmAddress(request.usdcAddress, 'usdcAddress');
  assertNonEmptyBounded(request.clientRequestId, 'clientRequestId', 128);
  assertNonEmptyBounded(request.challengeId, 'challengeId', 80);
  assertNonEmptyBounded(request.signature, 'signature', 1024);
}

function validateCreateQuoteRequest(request: CreateQuoteRequest, pearlNetwork: OtcApiConfig['pearlNetwork']): void {
  assertOneOf(request.side, 'side', ['buy_prl', 'sell_prl']);
  assertOneOf(request.settlementAsset, 'settlementAsset', ['USDC']);
  assertOneOf(request.settlementNetwork, 'settlementNetwork', ['base']);
  assertNonEmptyBounded(request.clientRequestId, 'clientRequestId', 128);
  assertPositiveAmount(request.amountPrl, 'amountPrl', parsePrlToGrains);
  assertLikelyPearlAddress(request.buyerPearlAddress, 'buyerPearlAddress', pearlNetwork);
  assertEvmAddress(request.usdcRefundAddress, 'usdcRefundAddress');
}

function validateAcceptQuoteRequest(request: AcceptQuoteRequest, pearlNetwork: OtcApiConfig['pearlNetwork']): void {
  assertNonEmptyBounded(request.clientRequestId, 'clientRequestId', 128);
  assertLikelyPearlAddress(request.buyerPearlAddress, 'buyerPearlAddress', pearlNetwork);
  assertLikelyPearlAddress(request.sellerPearlRefundAddress, 'sellerPearlRefundAddress', pearlNetwork);
  assertEvmAddress(request.buyerUsdcAddress, 'buyerUsdcAddress');
  assertEvmAddress(request.sellerUsdcReceiveAddress, 'sellerUsdcReceiveAddress');
  if (request.pearlEscrowMode && !['coordinator', 'multisig'].includes(request.pearlEscrowMode)) {
    throw new Error('pearlEscrowMode must be coordinator or multisig');
  }
  if (
    request.pearlReleaseSigningMode &&
    !['preauthorize_release', 'manual_after_base_deposit'].includes(request.pearlReleaseSigningMode)
  ) {
    throw new Error('pearlReleaseSigningMode must be preauthorize_release or manual_after_base_deposit');
  }
  if (request.buyerPearlPubkey != null) assertLikelyPearlPubkey(request.buyerPearlPubkey, 'buyerPearlPubkey');
  if (request.sellerPearlPubkey != null) assertLikelyPearlPubkey(request.sellerPearlPubkey, 'sellerPearlPubkey');
  if (request.buyerPearlPubkeyProof != null) assertLikelySchnorrSignature(request.buyerPearlPubkeyProof, 'buyerPearlPubkeyProof');
  if (request.sellerPearlPubkeyProof != null) assertLikelySchnorrSignature(request.sellerPearlPubkeyProof, 'sellerPearlPubkeyProof');
}

function assertMultisigSignerProofs(
  quoteId: string,
  request: AcceptQuoteRequest,
  config: OtcApiConfig,
  linkedOrder?: OtcOrder,
): void {
  if ((request.pearlEscrowMode ?? defaultPearlEscrowMode(config)) !== 'multisig') {
    return;
  }

  assertLikelyPearlPubkey(request.buyerPearlPubkey, 'buyerPearlPubkey');
  assertLikelyPearlPubkey(request.sellerPearlPubkey, 'sellerPearlPubkey');

  const releaseSigningMode = request.pearlReleaseSigningMode ?? 'manual_after_base_deposit';
  const makerRole = linkedOrder?.side === 'buy_prl' ? 'buyer' : linkedOrder?.side === 'sell_prl' ? 'seller' : undefined;
  if (makerRole !== 'buyer') {
    assertSignerProof({
      quoteId,
      role: 'buyer',
      pearlAddress: request.buyerPearlAddress,
      usdcAddress: request.buyerUsdcAddress,
      pearlPubkey: request.buyerPearlPubkey,
      releaseSigningMode,
      signatureHex: request.buyerPearlPubkeyProof,
      fieldName: 'buyerPearlPubkeyProof',
    });
  }
  if (makerRole !== 'seller') {
    assertSignerProof({
      quoteId,
      role: 'seller',
      pearlAddress: request.sellerPearlRefundAddress,
      usdcAddress: request.sellerUsdcReceiveAddress,
      pearlPubkey: request.sellerPearlPubkey,
      releaseSigningMode,
      signatureHex: request.sellerPearlPubkeyProof,
      fieldName: 'sellerPearlPubkeyProof',
    });
  }
}

function assertSignerProof(input: Omit<VerifyPearlSignerProofInput, 'signatureHex'> & {
  signatureHex?: string;
  fieldName: 'buyerPearlPubkeyProof' | 'sellerPearlPubkeyProof';
}): void {
  assertLikelySchnorrSignature(input.signatureHex, input.fieldName);
  if (!verifyPearlSignerProof({
    quoteId: input.quoteId,
    role: input.role,
    pearlAddress: input.pearlAddress,
    usdcAddress: input.usdcAddress,
    pearlPubkey: input.pearlPubkey,
    releaseSigningMode: input.releaseSigningMode,
    signatureHex: input.signatureHex,
  })) {
    throw new Error(`${input.fieldName} does not verify against signer pubkey and accept terms`);
  }
}

interface VerifyPearlSignerProofInput {
  quoteId: string;
  role: PearlSignerProofRole;
  pearlAddress: string;
  usdcAddress: string;
  pearlPubkey: string;
  releaseSigningMode: PearlReleaseSigningMode;
  signatureHex: string;
}

function verifyPearlSignerProof(input: VerifyPearlSignerProofInput): boolean {
  const pubkey = normalizeXOnlyPubkey(input.pearlPubkey);
  const signature = parseSchnorrSignature(input.signatureHex);
  const messageHash = createPearlSignerProofHash(input);
  return ecc.verifySchnorr(messageHash, pubkey, signature);
}

function assertOrderMakerSignerProof(input: {
  userId: string;
  side: OtcOrder['side'];
  amountPrl: string;
  priceUsdcPerPrl: string;
  minFillPrl?: string;
  expiresAt?: string;
  makerPearlAddress: string;
  makerUsdcAddress: string;
  makerPearlPubkey: string;
  pearlReleaseSigningMode: PearlReleaseSigningMode;
  signatureHex: string;
}): void {
  const pubkey = normalizeXOnlyPubkey(input.makerPearlPubkey);
  const signature = parseSchnorrSignature(input.signatureHex);
  const messageHash = createOrderMakerSignerProofHash(input);
  if (!ecc.verifySchnorr(messageHash, pubkey, signature)) {
    throw new Error('makerPearlPubkeyProof does not verify against order terms');
  }
}

function createOrderMakerSignerProofMessage(input: Omit<Parameters<typeof assertOrderMakerSignerProof>[0], 'signatureHex'>): string {
  return [
    'Pearl OTC order signer proof v1',
    `maker_user_id=${input.userId}`,
    `side=${input.side}`,
    `amount_prl=${input.amountPrl}`,
    `price_usdc_per_prl=${input.priceUsdcPerPrl}`,
    `min_fill_prl=${input.minFillPrl ?? ''}`,
    `expires_at=${input.expiresAt ?? ''}`,
    `maker_role=${input.side === 'buy_prl' ? 'buyer' : 'seller'}`,
    `maker_pearl_address=${input.makerPearlAddress.trim()}`,
    `maker_usdc_address=${input.makerUsdcAddress.trim().toLowerCase()}`,
    `maker_pearl_pubkey=${normalizeProofPubkey(input.makerPearlPubkey)}`,
    `release_signing_mode=${input.pearlReleaseSigningMode}`,
  ].join('\n');
}

function createOrderMakerSignerProofHash(input: Omit<Parameters<typeof assertOrderMakerSignerProof>[0], 'signatureHex'>): Uint8Array {
  return createHash('sha256').update(createOrderMakerSignerProofMessage(input)).digest();
}

function assertOrderFillable(order: OtcOrder, amountPrl: string, now: Date): void {
  if (!['open', 'partially_filled'].includes(order.status)) {
    throw new Error(`order is not fillable: ${order.status}`);
  }
  if (order.expiresAt && new Date(order.expiresAt).getTime() <= now.getTime()) {
    throw new Error('order expired');
  }
  const fill = parsePrlToGrains(amountPrl);
  if (fill > parsePrlToGrains(order.remainingPrl)) {
    throw new Error('order remaining amount is too small');
  }
  if (order.minFillPrl && fill < parsePrlToGrains(order.minFillPrl)) {
    throw new Error('amountPrl is below order minimum fill');
  }
}

function getOrderMakerRole(order: OtcOrder): 'buyer' | 'seller' {
  return order.side === 'buy_prl' ? 'buyer' : 'seller';
}

function createOrderQuoteAcceptPrefill(order: OtcOrder, takerPearlAddress: string, takerUsdcAddress: string): Partial<AcceptQuoteRequest> {
  const makerRole = getOrderMakerRole(order);
  const takerRole = makerRole === 'buyer' ? 'seller' : 'buyer';
  return {
    pearlReleaseSigningMode: order.pearlReleaseSigningMode,
    ...(makerRole === 'buyer'
      ? { buyerPearlAddress: order.makerPearlAddress, buyerUsdcAddress: order.makerUsdcAddress, buyerPearlPubkey: order.makerPearlPubkey }
      : { sellerPearlRefundAddress: order.makerPearlAddress, sellerUsdcReceiveAddress: order.makerUsdcAddress, sellerPearlPubkey: order.makerPearlPubkey }),
    ...(takerRole === 'buyer'
      ? { buyerPearlAddress: takerPearlAddress, buyerUsdcAddress: takerUsdcAddress }
      : { sellerPearlRefundAddress: takerPearlAddress, sellerUsdcReceiveAddress: takerUsdcAddress }),
  };
}

function assertOrderAcceptMatchesMaker(order: OtcOrder, request: AcceptQuoteRequest, config: OtcApiConfig): void {
  if ((request.pearlEscrowMode ?? defaultPearlEscrowMode(config)) !== 'multisig') {
    throw new Error('order-linked quotes require multisig Pearl escrow');
  }
  const makerRole = getOrderMakerRole(order);
  if (request.pearlReleaseSigningMode !== order.pearlReleaseSigningMode) {
    throw new Error('order-linked quote release signing mode does not match maker order');
  }
  if (makerRole === 'buyer') {
    if (request.buyerPearlAddress !== order.makerPearlAddress || getAddress(request.buyerUsdcAddress) !== getAddress(order.makerUsdcAddress)) {
      throw new Error('buyer settlement fields do not match maker order');
    }
    if (normalizeProofPubkey(request.buyerPearlPubkey ?? '') !== order.makerPearlPubkey) {
      throw new Error('buyer signer pubkey does not match maker order');
    }
    return;
  }
  if (
    request.sellerPearlRefundAddress !== order.makerPearlAddress ||
    getAddress(request.sellerUsdcReceiveAddress) !== getAddress(order.makerUsdcAddress)
  ) {
    throw new Error('seller settlement fields do not match maker order');
  }
  if (normalizeProofPubkey(request.sellerPearlPubkey ?? '') !== order.makerPearlPubkey) {
    throw new Error('seller signer pubkey does not match maker order');
  }
}

function verifyWalletChallenge(
  challenge: OtcUserWalletChallenge,
  signature: string,
  publicKeyHex: string | undefined,
): void {
  if (challenge.walletType === 'evm') {
    const recovered = getAddress(verifyMessage(challenge.message, signature));
    if (recovered !== getAddress(challenge.address)) {
      throw new Error('EVM wallet challenge signature does not match address');
    }
    return;
  }

  void publicKeyHex;
  throw new Error('Pearl wallet user registration is blocked until address-to-pubkey ownership verification is implemented');
}

function createPearlSignerProofHash(input: Omit<VerifyPearlSignerProofInput, 'signatureHex'>): Uint8Array {
  return createHash('sha256').update(createPearlSignerProofMessage(input)).digest();
}

function parseSchnorrSignature(signatureHex: string): Uint8Array {
  const normalized = signatureHex.trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]{128}$/.test(normalized)) {
    throw new Error('Pearl signer proof must be a 64-byte BIP340 signature hex');
  }
  return Buffer.from(normalized, 'hex');
}

function assertPositiveAmount(
  value: unknown,
  field: string,
  parse: (value: string) => bigint,
): void {
  assertNonEmptyBounded(value, field, 80);
  const parsed = parse(value);
  if (parsed <= 0n) {
    throw new Error(`${field} must be greater than zero`);
  }
}

function assertPositiveDecimal(value: unknown, field: string, decimals: number): void {
  assertNonEmptyBounded(value, field, 80);
  const pattern = new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`);
  if (!pattern.test(value) || Number(value) <= 0) {
    throw new Error(`${field} must be a positive decimal`);
  }
}

function assertNonEmptyBounded(value: unknown, field: string, maxLength: number): asserts value is string {
  assertNonEmpty(value, field);
  if (value.length > maxLength) {
    throw new Error(`${field} exceeds ${maxLength} characters`);
  }
}

function assertEvmAddress(value: unknown, field: string): asserts value is string {
  assertNonEmptyBounded(value, field, 128);
  if (!isAddress(value)) {
    throw new Error(`${field} must be a valid EVM address`);
  }
}

function assertLikelyPearlAddress(
  value: unknown,
  field: string,
  network?: OtcApiConfig['pearlNetwork'],
): asserts value is string {
  assertNonEmptyBounded(value, field, 160);
  const prefixes = network === 'mainnet'
    ? ['prl1']
    : network === 'regtest' || network === 'simnet'
      ? ['rprl1']
      : ['tprl1'];
  if (!prefixes.some((prefix) => value.toLowerCase().startsWith(prefix))) {
    throw new Error(`${field} must be a Pearl ${network ?? 'testnet'} address`);
  }
}

function assertLikelyPearlPubkey(value: unknown, field: string): asserts value is string {
  assertNonEmptyBounded(value, field, 132);
  if (!/^(?:0x)?(?:[0-9a-fA-F]{64}|0[23][0-9a-fA-F]{64})$/.test(value)) {
    throw new Error(`${field} must be an x-only or compressed secp256k1 public key`);
  }
}

function assertLikelySchnorrSignature(value: unknown, field: string): asserts value is string {
  assertNonEmptyBounded(value, field, 130);
  if (!/^(?:0x)?[0-9a-fA-F]{128}$/.test(value)) {
    throw new Error(`${field} must be a 64-byte BIP340 signature hex`);
  }
}

export function createPublicProof(
  trade: OtcTrade,
  events: TradeEvent[],
  observedAt: Date,
  pearlIndexedProof?: PearlIndexedProof,
): PublicTradeProof {
  return {
    tradeId: trade.tradeId,
    status: trade.state,
    deadlines: trade.deadlines,
    quote: {
      side: trade.side,
      amountPrl: trade.amountPrl,
      amountUsdc: trade.amountUsdc,
      feePrl: trade.feePrl,
      feeUsdc: trade.feeUsdc,
      priceUsdcPerPrl: calculateImpliedPrice(trade),
    },
    pearl: {
      escrowAddress: trade.pearlEscrow.address,
      escrowOutpoint: pearlIndexedProof?.escrowOutpoint ?? trade.pearlEscrow.fundingOutpoint,
      escrowConfirmations: pearlIndexedProof?.escrowConfirmations ?? 0,
      releaseTxid: pearlIndexedProof?.releaseTxid ?? trade.pearlEscrow.releaseTxid,
      refundTxid: pearlIndexedProof?.refundTxid ?? trade.pearlEscrow.refundTxid,
    },
    base: {
      chainId: trade.usdcEscrow.chainId,
      contract: trade.usdcEscrow.contract,
      usdcToken: trade.usdcEscrow.usdcToken,
      tradeKey: trade.usdcEscrow.tradeKey,
      depositTxHash: trade.usdcEscrow.depositTxHash,
      releaseTxHash: trade.usdcEscrow.releaseTxHash,
      refundTxHash: trade.usdcEscrow.refundTxHash,
      requiredConfirmations: trade.usdcEscrow.requiredConfirmations,
    },
    events: mergeProofEvents(events, pearlIndexedProof?.events ?? []),
    observedAt: observedAt.toISOString(),
  };
}

function mergeProofEvents(events: TradeEvent[], indexedEvents: TradeEvent[]): TradeEvent[] {
  const bySourceEventId = new Map<string, TradeEvent>();
  for (const event of [...events, ...indexedEvents]) {
    bySourceEventId.set(event.sourceEventId, event);
  }
  return Array.from(bySourceEventId.values()).sort((a, b) => a.observedAt.localeCompare(b.observedAt));
}

function calculateImpliedPrice(trade: OtcTrade): string {
  const prl = Number(trade.amountPrl);
  const usdc = Number(trade.amountUsdc);
  if (!Number.isFinite(prl) || prl === 0 || !Number.isFinite(usdc)) {
    return '0.000000';
  }
  return (usdc / prl).toFixed(6);
}

function sumDecimal(values: string[], decimals: number): string {
  return values.reduce((total, value) => total + Number(value), 0).toFixed(decimals);
}

function summarizePoints(userId: string, events: OtcPointEvent[]): OtcPointsSummary {
  const bySource: OtcPointsSummary['bySource'] = {};
  let totalPoints = 0;
  for (const event of events) {
    totalPoints += event.points;
    bySource[event.source] = (bySource[event.source] ?? 0) + event.points;
  }
  return {
    userId,
    totalPoints,
    bySource,
    recent: events.slice(0, 25),
  };
}

function createStableId(prefix: string, parts: readonly string[]): string {
  const hash = createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24);
  return `${prefix}_${hash}`;
}

function createRandomId(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString('hex')}`;
}

function createRandomReferralCode(): string {
  return randomBytes(8)
    .toString('base64url')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 10)
    .toUpperCase();
}

function createUserWalletChallengeMessage(input: {
  challengeId: string;
  walletType: string;
  network: string;
  address: string;
  nonce: string;
  expiresAt: string;
}): string {
  return [
    'Pearl OTC user wallet v1',
    `challenge_id=${input.challengeId}`,
    `wallet_type=${input.walletType}`,
    `network=${input.network}`,
    `address=${input.address}`,
    `nonce=${input.nonce}`,
    `expires_at=${input.expiresAt}`,
  ].join('\n');
}

function normalizeWalletAddress(walletType: string, address: string): string {
  return walletType === 'evm' ? getAddress(address) : address.trim();
}

function extractReferralCode(request: Pick<RegisterUserRequest, 'referralCode' | 'sourceUrl'>): string | undefined {
  if (request.referralCode) {
    return normalizeReferralCode(request.referralCode);
  }
  if (!request.sourceUrl) {
    return undefined;
  }
  const sourceUrl = normalizeSourceUrl(request.sourceUrl);
  const ref = new URL(sourceUrl).searchParams.get('ref');
  return ref ? normalizeReferralCode(ref) : undefined;
}

function normalizeReferralCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,32}$/.test(normalized)) {
    throw new Error('referralCode must be 3-32 characters using letters, numbers, underscore, or dash');
  }
  return normalized;
}

function normalizeEmail(value: string): string {
  assertNonEmptyBounded(value, 'email', 254);
  const normalized = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error('email must be a valid email address');
  }
  return normalized;
}

function normalizeAmountString(value: string): string {
  return value.trim();
}

function normalizeSourceUrl(value: string): string {
  assertNonEmptyBounded(value, 'sourceUrl', 2048);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('sourceUrl must be a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('sourceUrl must be an http or https URL');
  }
  return url.toString();
}

function normalizeProofPubkeyForUser(value: string): string {
  assertLikelyPearlPubkey(value, 'publicKeyHex');
  return normalizeProofPubkey(value);
}

function createPayloadHash(kind: string, payload: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify({ kind, payload: canonicalize(payload) })).digest('hex')}`;
}

function assertRequestHashMatches(kind: string, key: string, existingHash: string | undefined, requestHash: string): void {
  if (existingHash && existingHash !== requestHash) {
    throw new Error(`${kind} idempotency key reuse with different payload: ${key}`);
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function createTradeKey(tradeId: string): string {
  return `0x${createHash('sha256').update(tradeId).digest('hex')}`;
}

function defaultPearlEscrowMode(config: OtcApiConfig): 'coordinator' | 'multisig' {
  return config.pearlEscrowAllocator === 'p2tr_multisig' ? 'multisig' : 'coordinator';
}

function assertEscrowModeMatchesAllocator(requestedMode: AcceptQuoteRequest['pearlEscrowMode'], config: OtcApiConfig): void {
  const actualMode = defaultPearlEscrowMode(config);
  if (requestedMode && requestedMode !== actualMode) {
    throw new Error(`pearlEscrowMode ${requestedMode} is not available for allocator ${config.pearlEscrowAllocator}`);
  }
}

function createExpectedUsdcTerms(trade: OtcTrade): {
  buyer: string;
  seller: string;
  amountMicros: string;
  feeMicros: string;
  expiryUnixSeconds: number;
} {
  return {
    buyer: trade.buyerUsdcAddress,
    seller: trade.sellerUsdcReceiveAddress,
    amountMicros: parseUsdcToMicros(trade.amountUsdc).toString(),
    feeMicros: parseUsdcToMicros(trade.feeUsdc).toString(),
    expiryUnixSeconds: Math.floor(new Date(trade.usdcEscrow.expiresAt).getTime() / 1000),
  };
}

function pearlEscrowPackageFromTrade(trade: OtcTrade): PearlEscrowPackage {
  const releaseTemplate = assertPearlTxTemplate(trade.pearlEscrow.releaseTemplate, 'releaseTemplate');
  const refundTemplate = assertPearlTxTemplate(trade.pearlEscrow.refundTemplate, 'refundTemplate');
  const internalPubkeyHex = assertTradeString(trade.pearlEscrow.internalPubkeyHex, 'internalPubkeyHex');
  const taprootOutputScriptHex = assertTradeString(trade.pearlEscrow.taprootOutputScriptHex, 'taprootOutputScriptHex');
  const fundingOutpoint = assertTradeString(trade.pearlEscrow.fundingOutpoint, 'fundingOutpoint');

  return {
    tradeId: trade.tradeId,
    network: trade.pearlEscrow.network,
    escrowAddress: trade.pearlEscrow.address,
    escrowScriptType: trade.pearlEscrow.escrowScriptType ?? 'p2tr',
    expectedAmountGrains: trade.pearlEscrow.expectedAmountGrains,
    requiredConfirmations: trade.pearlEscrow.requiredConfirmations,
    fundingOutpoint,
    ...(trade.pearlEscrow.refundEligibleAfterHeight == null
      ? {}
      : { refundEligibleAfterHeight: trade.pearlEscrow.refundEligibleAfterHeight }),
    ...(trade.pearlEscrow.refundEligibleAfterUnixTime == null
      ? {}
      : { refundEligibleAfterUnixTime: trade.pearlEscrow.refundEligibleAfterUnixTime }),
    releaseTemplate,
    refundTemplate,
    keys: {
      internalPubkeyHex,
      ...(trade.pearlEscrow.internalKeyPolicy ? { internalKeyPolicy: trade.pearlEscrow.internalKeyPolicy } : {}),
      ...(trade.pearlEscrow.scriptNonceHex ? { scriptNonceHex: trade.pearlEscrow.scriptNonceHex } : {}),
      taprootOutputScriptHex,
      signerPubkeys: trade.pearlEscrow.signerPubkeys ?? {},
      ...(trade.pearlEscrow.taprootScriptLeaves ? { taprootScriptLeaves: trade.pearlEscrow.taprootScriptLeaves } : {}),
    },
    createdAt: trade.createdAt,
    verification: {
      simnetVerified: trade.pearlEscrow.simnetVerified ?? false,
    },
  };
}

function getReleaseSignerSets(trade: OtcTrade): string[][] {
  const template = trade.pearlEscrow.releaseTemplate;
  if (!template || typeof template !== 'object') return [];
  const policy = (template as { signingPolicy?: { requiredSigners?: string[]; alternativeSignerSets?: string[][] } }).signingPolicy;
  return [
    ...(policy?.requiredSigners?.length ? [policy.requiredSigners] : []),
    ...(policy?.alternativeSignerSets ?? []),
  ];
}

function assertPearlTxTemplate(value: unknown, field: string): PearlEscrowTxTemplate {
  if (!value || typeof value !== 'object') {
    throw new Error(`trade Pearl escrow ${field} is required`);
  }
  const candidate = value as Partial<PearlEscrowTxTemplate>;
  if (!Array.isArray(candidate.inputs) || !Array.isArray(candidate.outputs) || !candidate.signingPolicy) {
    throw new Error(`trade Pearl escrow ${field} is malformed`);
  }
  return candidate as PearlEscrowTxTemplate;
}

function assertTradeString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`trade Pearl escrow ${field} is required`);
  }
  return value;
}

function compareUsdcTerms(
  expected: ReturnType<typeof createExpectedUsdcTerms>,
  onChain: NonNullable<UsdcEscrowVerification['onChain']>,
): string[] {
  const mismatches: string[] = [];
  if (onChain.status === 'none') mismatches.push('status');
  if (onChain.buyer.toLowerCase() !== expected.buyer.toLowerCase()) mismatches.push('buyer');
  if (onChain.seller.toLowerCase() !== expected.seller.toLowerCase()) mismatches.push('seller');
  if (onChain.amountMicros !== expected.amountMicros) mismatches.push('amount');
  if (onChain.feeMicros !== expected.feeMicros) mismatches.push('fee');
  if (onChain.expiryUnixSeconds !== expected.expiryUnixSeconds) mismatches.push('expiry');
  return mismatches;
}

function createTradeDeadlines(quote: OtcQuote, acceptedAt: Date, config: OtcApiConfig): OtcTradeDeadlines {
  return {
    quoteExpiresAt: quote.expiresAt,
    pearlFundingDeadline: new Date(acceptedAt.getTime() + config.pearlFundingTtlMs).toISOString(),
    usdcDepositDeadline: new Date(acceptedAt.getTime() + config.usdcDepositTtlMs).toISOString(),
    settlementDeadline: new Date(acceptedAt.getTime() + config.settlementTtlMs).toISOString(),
    refundAvailableAt: new Date(acceptedAt.getTime() + config.usdcDepositTtlMs).toISOString(),
  };
}

function calculateQuoteAmounts(
  amountPrl: string,
  priceUsdcPerPrl: string,
  feeBps: number,
): Pick<OtcQuote, 'amountPrl' | 'amountUsdc' | 'feePrl' | 'feeUsdc' | 'priceUsdcPerPrl'> {
  const amountGrains = parsePrlToGrains(amountPrl);
  const priceMicros = parseUsdcToMicros(priceUsdcPerPrl);
  const amountUsdcMicros = (amountGrains * priceMicros) / 100_000_000n;
  const feeUsdcMicros = (amountUsdcMicros * BigInt(feeBps)) / 10_000n;

  return {
    amountPrl: formatGrainsToPrl(amountGrains),
    amountUsdc: formatMicrosToUsdc(amountUsdcMicros),
    feePrl: '0.00000000',
    feeUsdc: formatMicrosToUsdc(feeUsdcMicros),
    priceUsdcPerPrl,
  };
}
