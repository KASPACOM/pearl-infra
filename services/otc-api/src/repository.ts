import type { OtcQuote, OtcTrade, TradeEvent } from '@kaspacom/pearl-sdk';

import type { PgQueryClient, PgTransactionalClient } from './postgres.js';
import type {
  AdminUserQuery,
  OtcReferralAttribution,
  OtcEmailVerificationToken,
  OtcNotificationDelivery,
  OtcNotificationDeliveryStatus,
  OtcNotificationPreference,
  OtcNotificationTarget,
  OtcOrder,
  OtcOrderQuoteLink,
  OtcOrderSweep,
  OtcOrderSweepStatus,
  OtcPointEvent,
  SaveOrderSweepInput,
  OtcSideEffect,
  OtcUser,
  OtcUserProfile,
  OtcUserWallet,
  OtcUserWalletChallenge,
  OrderBookPage,
  OrderBookQuery,
  ReferralCodeLookup,
} from './types.js';

export interface QuoteIdempotencyRecord {
  quote: OtcQuote;
  requestHash?: string;
}

export interface TradeIdempotencyRecord {
  trade: OtcTrade;
  requestHash?: string;
}

export interface OtcUserListPage {
  items: OtcUser[];
  total: number;
  limit: number;
  nextCursor?: string;
}

export interface SaveAcceptedTradeInput {
  trade: OtcTrade;
  clientRequestId: string;
  requestHash?: string;
  event: TradeEvent;
  orderFill?: {
    orderId: string;
    amountPrl: string;
    updatedAt: string;
  };
}

export interface PearlEscrowAllocationInput {
  tradeId: string;
  allocatorKey: string;
  derivationPrefix: string;
  derivationIndex: number;
  derivationPath: string;
  escrowAddress: string;
  internalPubkeyHex: string;
  taprootOutputScriptHex: string;
}

export interface PearlEscrowAllocation extends PearlEscrowAllocationInput {
  createdAt: string;
}

export interface OrderPrefundAllocationInput {
  orderId: string;
  allocatorKey: string;
  derivationPrefix: string;
  derivationIndex: number;
  derivationPath: string;
  escrowAddress: string;
  internalPubkeyHex: string;
  taprootOutputScriptHex: string;
  scriptLeaves: Array<{
    kind: string;
    requiredSigners: readonly string[];
    scriptHex: string;
    leafVersion: number;
    controlBlockHex: string;
    lockTime?: number;
  }>;
  signerPubkeys: { maker: string; operator: string; arbiter?: string };
}

export interface OrderPrefundAllocation extends OrderPrefundAllocationInput {
  createdAt: string;
}

export class PearlEscrowDerivationCollisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PearlEscrowDerivationCollisionError';
  }
}

export interface OtcRepository {
  saveQuote(quote: OtcQuote, clientRequestId: string, requestHash?: string): Promise<void>;
  findQuoteById(quoteId: string): Promise<OtcQuote | undefined>;
  findQuoteByClientRequestId(clientRequestId: string): Promise<OtcQuote | undefined>;
  findQuoteIdempotencyByClientRequestId(clientRequestId: string): Promise<QuoteIdempotencyRecord | undefined>;
  saveTrade(trade: OtcTrade, clientRequestId: string, requestHash?: string): Promise<void>;
  saveAcceptedTrade(input: SaveAcceptedTradeInput): Promise<void>;
  findTradeById(tradeId: string): Promise<OtcTrade | undefined>;
  listTrades(): Promise<OtcTrade[]>;
  findTradeByQuoteId(quoteId: string): Promise<OtcTrade | undefined>;
  findTradeByClientRequestId(clientRequestId: string): Promise<OtcTrade | undefined>;
  findTradeIdempotencyByClientRequestId(clientRequestId: string): Promise<TradeIdempotencyRecord | undefined>;
  updateTrade(trade: OtcTrade): Promise<void>;
  findPearlEscrowAllocationByTradeId(tradeId: string): Promise<PearlEscrowAllocation | undefined>;
  reservePearlEscrowAllocation(
    allocation: PearlEscrowAllocationInput,
  ): Promise<{ allocation: PearlEscrowAllocation; created: boolean }>;
  appendEvent(event: TradeEvent): Promise<void>;
  listEvents(tradeId: string): Promise<TradeEvent[]>;
  saveSideEffect(sideEffect: OtcSideEffect): Promise<{ sideEffect: OtcSideEffect; created: boolean }>;
  updateSideEffect(sideEffect: OtcSideEffect): Promise<OtcSideEffect>;
  findSideEffectByIdempotencyKey(idempotencyKey: string): Promise<OtcSideEffect | undefined>;
  listSideEffects(tradeId: string): Promise<OtcSideEffect[]>;
  saveWalletChallenge(challenge: OtcUserWalletChallenge): Promise<void>;
  findWalletChallenge(challengeId: string): Promise<OtcUserWalletChallenge | undefined>;
  consumeWalletChallenge(challengeId: string, consumedAt: string): Promise<boolean>;
  findUserByWallet(walletType: OtcUserWallet['walletType'], network: string, address: string): Promise<OtcUser | undefined>;
  findUserById(userId: string): Promise<OtcUser | undefined>;
  listUsers(query?: AdminUserQuery): Promise<OtcUserListPage>;
  saveUser(input: SaveUserInput): Promise<OtcUser>;
  addUserWallet(userId: string, wallet: Omit<OtcUserWallet, 'userId' | 'createdAt'>): Promise<OtcUser>;
  updateUserProfile(userId: string, profile: UpdateUserProfileInput): Promise<OtcUserProfile>;
  findReferralCode(referralCode: string): Promise<ReferralCodeLookup | undefined>;
  countUsers(): Promise<number>;
  saveEmailVerificationToken(token: OtcEmailVerificationToken): Promise<void>;
  findEmailVerificationTokenByHash(tokenHash: string): Promise<OtcEmailVerificationToken | undefined>;
  consumeEmailVerificationToken(tokenId: string, consumedAt: string): Promise<OtcUserProfile>;
  listNotificationPreferences(userId: string): Promise<OtcNotificationPreference[]>;
  saveNotificationPreferences(userId: string, preferences: Omit<OtcNotificationPreference, 'userId' | 'createdAt' | 'updatedAt'>[], updatedAt: string): Promise<OtcNotificationPreference[]>;
  saveNotificationDelivery(delivery: OtcNotificationDelivery): Promise<{ delivery: OtcNotificationDelivery; created: boolean }>;
  listNotificationDeliveries(query?: { status?: OtcNotificationDeliveryStatus; limit?: number }): Promise<OtcNotificationDelivery[]>;
  updateNotificationDelivery(deliveryId: string, input: { status: OtcNotificationDeliveryStatus; error?: string; nextAttemptAt?: string; updatedAt: string }): Promise<OtcNotificationDelivery>;
  unsubscribeNotificationByTokenHash(tokenHash: string, updatedAt: string): Promise<OtcNotificationDelivery>;
  listNotificationTargets(notificationType: OtcNotificationPreference['notificationType'], channel: OtcNotificationPreference['channel']): Promise<OtcNotificationTarget[]>;
  saveOrder(order: OtcOrder): Promise<OtcOrder>;
  findOrderById(orderId: string): Promise<OtcOrder | undefined>;
  listOrders(query?: OrderBookQuery): Promise<OrderBookPage>;
  listOpenOrdersForStats(): Promise<OtcOrder[]>;
  listOrdersByUser(userId: string): Promise<OtcOrder[]>;
  reserveOrderFill(orderId: string, amountPrl: string, updatedAt: string): Promise<OtcOrder>;
  findOrderPrefundAllocationByOrderId(orderId: string): Promise<OrderPrefundAllocation | undefined>;
  reserveOrderPrefundAllocation(
    allocation: OrderPrefundAllocationInput,
  ): Promise<{ allocation: OrderPrefundAllocation; created: boolean }>;
  listOrdersByPrefundState(
    state: import('@kaspacom/pearl-sdk').OtcOrderPrefundState,
    limit?: number,
  ): Promise<OtcOrder[]>;
  applyPrefundFundedObservation(input: {
    orderId: string;
    fundingOutpoint: string;
    fundedGrains: string;
    fundedAt: string;
    updatedAt: string;
  }): Promise<OtcOrder>;
  applyPrefundExpired(orderId: string, updatedAt: string): Promise<OtcOrder>;
  saveOrderSweep(input: SaveOrderSweepInput): Promise<OtcOrderSweep>;
  findOrderSweepById(sweepId: string): Promise<OtcOrderSweep | undefined>;
  findOrderSweepByTradeId(tradeId: string): Promise<OtcOrderSweep | undefined>;
  listOrderSweepsByOrderId(orderId: string): Promise<OtcOrderSweep[]>;
  updateOrderSweep(input: {
    sweepId: string;
    status?: OtcOrderSweepStatus;
    sweepPsbtBase64?: string;
    sweepTxid?: string;
    changeOutpoint?: string;
    changeGrains?: string;
    failureReason?: string;
    updatedAt: string;
  }): Promise<OtcOrderSweep>;
  applyOrderPrefundSweepProgress(input: {
    orderId: string;
    sweptGrains: string;
    newRemainingGrains: string;
    newState: 'partially_swept' | 'fully_swept';
    updatedAt: string;
  }): Promise<OtcOrder>;
  applyPrefundRefundPending(input: { orderId: string; updatedAt: string }): Promise<OtcOrder>;
  applyPrefundRefunded(input: { orderId: string; refundTxid: string; updatedAt: string }): Promise<OtcOrder>;
  saveOrderQuoteLink(link: OtcOrderQuoteLink): Promise<void>;
  findOrderQuoteLinkByQuoteId(quoteId: string): Promise<OtcOrderQuoteLink | undefined>;
  savePointEvent(event: OtcPointEvent): Promise<{ event: OtcPointEvent; created: boolean }>;
  listPointEvents(userId: string): Promise<OtcPointEvent[]>;
  listTradesForUser(user: OtcUser): Promise<OtcTrade[]>;
}

export class ReferralCodeCollisionError extends Error {
  constructor(referralCode: string) {
    super(`referral code already exists: ${referralCode}`);
    this.name = 'ReferralCodeCollisionError';
  }
}

function normalizeListLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || !limit) {
    return 25;
  }
  return Math.min(100, Math.max(1, Math.floor(limit)));
}

function parseListCursor(cursor: string | undefined): number {
  if (!cursor) {
    return 0;
  }
  const parsed = Number(cursor);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

export interface SaveUserInput {
  userId: string;
  referralCode: string;
  wallet: Omit<OtcUserWallet, 'createdAt'>;
  profile: Omit<OtcUserProfile, 'createdAt' | 'updatedAt'>;
  referredBy?: {
    referralCode: string;
    referrerUserId: string;
    sourceUrl?: string;
    attributedAt: string;
  };
}

export interface UpdateUserProfileInput {
  email?: string;
  notificationEmailEnabled?: boolean;
  updatedAt: string;
}

export class InMemoryOtcRepository implements OtcRepository {
  private readonly quotes = new Map<string, OtcQuote>();
  private readonly quoteClientRequests = new Map<string, string>();
  private readonly quoteRequestHashes = new Map<string, string>();
  private readonly trades = new Map<string, OtcTrade>();
  private readonly tradeClientRequests = new Map<string, string>();
  private readonly tradeRequestHashes = new Map<string, string>();
  private readonly tradeByQuote = new Map<string, string>();
  private readonly pearlEscrowAllocations = new Map<string, PearlEscrowAllocation>();
  private readonly pearlEscrowAllocationByDerivation = new Map<string, string>();
  private readonly orderPrefundAllocations = new Map<string, OrderPrefundAllocation>();
  private readonly orderPrefundAllocationByDerivation = new Map<string, string>();
  private readonly orderSweeps = new Map<string, OtcOrderSweep>();
  private readonly orderSweepByTradeId = new Map<string, string>();
  private readonly events = new Map<string, TradeEvent[]>();
  private readonly sideEffects = new Map<string, OtcSideEffect>();
  private readonly walletChallenges = new Map<string, OtcUserWalletChallenge>();
  private readonly users = new Map<string, OtcUser>();
  private readonly userByWallet = new Map<string, string>();
  private readonly referralByCode = new Map<string, ReferralCodeLookup>();
  private readonly emailVerificationTokens = new Map<string, OtcEmailVerificationToken>();
  private readonly emailVerificationTokenByHash = new Map<string, string>();
  private readonly notificationPreferences = new Map<string, OtcNotificationPreference>();
  private readonly notificationDeliveries = new Map<string, OtcNotificationDelivery>();
  private readonly notificationDeliveryByIdempotencyKey = new Map<string, string>();
  private readonly orders = new Map<string, OtcOrder>();
  private readonly orderQuoteLinks = new Map<string, OtcOrderQuoteLink>();
  private readonly pointEvents = new Map<string, OtcPointEvent>();

  async saveQuote(quote: OtcQuote, clientRequestId: string, requestHash?: string): Promise<void> {
    this.quotes.set(quote.quoteId, quote);
    this.quoteClientRequests.set(clientRequestId, quote.quoteId);
    if (requestHash) this.quoteRequestHashes.set(clientRequestId, requestHash);
  }

  async findQuoteById(quoteId: string): Promise<OtcQuote | undefined> {
    return this.quotes.get(quoteId);
  }

  async findQuoteByClientRequestId(clientRequestId: string): Promise<OtcQuote | undefined> {
    const quoteId = this.quoteClientRequests.get(clientRequestId);
    return quoteId ? this.quotes.get(quoteId) : undefined;
  }

  async findQuoteIdempotencyByClientRequestId(clientRequestId: string): Promise<QuoteIdempotencyRecord | undefined> {
    const quote = await this.findQuoteByClientRequestId(clientRequestId);
    if (!quote) return undefined;
    return {
      quote,
      ...(this.quoteRequestHashes.has(clientRequestId) ? { requestHash: this.quoteRequestHashes.get(clientRequestId) } : {}),
    };
  }

  async saveTrade(trade: OtcTrade, clientRequestId: string, requestHash?: string): Promise<void> {
    this.trades.set(trade.tradeId, trade);
    this.tradeClientRequests.set(clientRequestId, trade.tradeId);
    this.tradeByQuote.set(trade.quoteId, trade.tradeId);
    if (requestHash) this.tradeRequestHashes.set(clientRequestId, requestHash);
  }

  async saveAcceptedTrade(input: SaveAcceptedTradeInput): Promise<void> {
    if (input.orderFill) {
      await this.reserveOrderFill(input.orderFill.orderId, input.orderFill.amountPrl, input.orderFill.updatedAt);
    }
    await this.saveTrade(input.trade, input.clientRequestId, input.requestHash);
    await this.appendEvent(input.event);
  }

  async findTradeById(tradeId: string): Promise<OtcTrade | undefined> {
    return this.trades.get(tradeId);
  }

  async listTrades(): Promise<OtcTrade[]> {
    return Array.from(this.trades.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async findTradeByQuoteId(quoteId: string): Promise<OtcTrade | undefined> {
    const tradeId = this.tradeByQuote.get(quoteId);
    return tradeId ? this.trades.get(tradeId) : undefined;
  }

  async findTradeByClientRequestId(clientRequestId: string): Promise<OtcTrade | undefined> {
    const tradeId = this.tradeClientRequests.get(clientRequestId);
    return tradeId ? this.trades.get(tradeId) : undefined;
  }

  async findTradeIdempotencyByClientRequestId(clientRequestId: string): Promise<TradeIdempotencyRecord | undefined> {
    const trade = await this.findTradeByClientRequestId(clientRequestId);
    if (!trade) return undefined;
    return {
      trade,
      ...(this.tradeRequestHashes.has(clientRequestId) ? { requestHash: this.tradeRequestHashes.get(clientRequestId) } : {}),
    };
  }

  async updateTrade(trade: OtcTrade): Promise<void> {
    this.trades.set(trade.tradeId, trade);
  }

  async findPearlEscrowAllocationByTradeId(tradeId: string): Promise<PearlEscrowAllocation | undefined> {
    return this.pearlEscrowAllocations.get(tradeId);
  }

  async reservePearlEscrowAllocation(
    allocation: PearlEscrowAllocationInput,
  ): Promise<{ allocation: PearlEscrowAllocation; created: boolean }> {
    const existing = this.pearlEscrowAllocations.get(allocation.tradeId);
    if (existing) {
      return { allocation: existing, created: false };
    }
    const derivationKey = formatPearlEscrowDerivationKey(allocation);
    const existingTradeId = this.pearlEscrowAllocationByDerivation.get(derivationKey);
    if (existingTradeId && existingTradeId !== allocation.tradeId) {
      throw new PearlEscrowDerivationCollisionError(
        `Pearl escrow derivation already allocated: ${allocation.derivationPath}`,
      );
    }
    const persisted: PearlEscrowAllocation = {
      ...allocation,
      createdAt: new Date().toISOString(),
    };
    this.pearlEscrowAllocations.set(allocation.tradeId, persisted);
    this.pearlEscrowAllocationByDerivation.set(derivationKey, allocation.tradeId);
    return { allocation: persisted, created: true };
  }

  async appendEvent(event: TradeEvent): Promise<void> {
    const existing = this.events.get(event.tradeId) ?? [];
    if (existing.some((candidate) => candidate.sourceEventId === event.sourceEventId)) {
      return;
    }
    this.events.set(event.tradeId, [...existing, event]);
  }

  async listEvents(tradeId: string): Promise<TradeEvent[]> {
    return this.events.get(tradeId) ?? [];
  }

  async saveSideEffect(sideEffect: OtcSideEffect): Promise<{ sideEffect: OtcSideEffect; created: boolean }> {
    const existing = this.sideEffects.get(sideEffect.idempotencyKey);
    if (existing) {
      assertIdempotencyHashMatch('side effect', sideEffect.idempotencyKey, existing.requestHash, sideEffect.requestHash);
      return { sideEffect: existing, created: false };
    }
    this.sideEffects.set(sideEffect.idempotencyKey, sideEffect);
    return { sideEffect, created: true };
  }

  async updateSideEffect(sideEffect: OtcSideEffect): Promise<OtcSideEffect> {
    if (!this.sideEffects.has(sideEffect.idempotencyKey)) {
      throw new Error(`side effect not found: ${sideEffect.idempotencyKey}`);
    }
    this.sideEffects.set(sideEffect.idempotencyKey, sideEffect);
    return sideEffect;
  }

  async findSideEffectByIdempotencyKey(idempotencyKey: string): Promise<OtcSideEffect | undefined> {
    return this.sideEffects.get(idempotencyKey);
  }

  async listSideEffects(tradeId: string): Promise<OtcSideEffect[]> {
    return Array.from(this.sideEffects.values())
      .filter((sideEffect) => sideEffect.tradeId === tradeId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async saveWalletChallenge(challenge: OtcUserWalletChallenge): Promise<void> {
    this.walletChallenges.set(challenge.challengeId, challenge);
  }

  async findWalletChallenge(challengeId: string): Promise<OtcUserWalletChallenge | undefined> {
    return this.walletChallenges.get(challengeId);
  }

  async consumeWalletChallenge(challengeId: string, consumedAt: string): Promise<boolean> {
    const challenge = this.walletChallenges.get(challengeId);
    if (!challenge || challenge.consumedAt) return false;
    this.walletChallenges.set(challengeId, { ...challenge, consumedAt });
    return true;
  }

  async findUserByWallet(
    walletType: OtcUserWallet['walletType'],
    network: string,
    address: string,
  ): Promise<OtcUser | undefined> {
    const userId = this.userByWallet.get(formatWalletKey(walletType, network, address));
    const user = userId ? this.users.get(userId) : undefined;
    if (!user) return undefined;
    const matchedWallet = user.wallets.find((wallet) => walletMatches(wallet, walletType, network, address)) ?? user.wallet;
    return { ...user, wallet: matchedWallet };
  }

  async findUserById(userId: string): Promise<OtcUser | undefined> {
    return this.users.get(userId);
  }

  async listUsers(query: AdminUserQuery = {}): Promise<OtcUserListPage> {
    const search = query.search?.trim().toLowerCase();
    const offset = parseListCursor(query.cursor);
    const limit = normalizeListLimit(query.limit);
    const filtered = Array.from(this.users.values())
      .filter((user) => {
        if (query.walletType && !user.wallets.some((wallet) => wallet.walletType === query.walletType)) {
          return false;
        }
        if (query.referrerUserId && user.referredBy?.referrerUserId !== query.referrerUserId) {
          return false;
        }
        if (!search) {
          return true;
        }
        return [
          user.userId,
          user.referralCode,
          user.profile.email ?? '',
          user.referredBy?.referrerUserId ?? '',
          ...user.wallets.flatMap((wallet) => [wallet.address, wallet.network, wallet.publicKeyHex ?? '']),
        ].some((value) => value.toLowerCase().includes(search));
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.userId.localeCompare(right.userId));
    const items = filtered.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    return {
      items,
      total: filtered.length,
      limit,
      ...(nextOffset < filtered.length ? { nextCursor: String(nextOffset) } : {}),
    };
  }

  async saveUser(input: SaveUserInput): Promise<OtcUser> {
    const existing = await this.findUserByWallet(input.wallet.walletType, input.wallet.network, input.wallet.address);
    if (existing) {
      return existing;
    }
    const existingReferralCode = this.referralByCode.get(input.referralCode);
    if (existingReferralCode && existingReferralCode.ownerUserId !== input.userId) {
      throw new ReferralCodeCollisionError(input.referralCode);
    }
    const createdAt = input.wallet.verifiedAt;
    const user: OtcUser = {
      userId: input.userId,
      referralCode: input.referralCode,
      wallet: { ...input.wallet, createdAt },
      wallets: [{ ...input.wallet, createdAt }],
      profile: {
        ...input.profile,
        createdAt,
        updatedAt: createdAt,
      },
      ...(input.referredBy
        ? {
            referredBy: {
              referredUserId: input.userId,
              referrerUserId: input.referredBy.referrerUserId,
              referralCode: input.referredBy.referralCode,
              ...(input.referredBy.sourceUrl ? { sourceUrl: input.referredBy.sourceUrl } : {}),
              attributedAt: input.referredBy.attributedAt,
            },
          }
        : {}),
      createdAt,
      updatedAt: createdAt,
    };
    this.users.set(user.userId, user);
    this.userByWallet.set(formatWalletKey(input.wallet.walletType, input.wallet.network, input.wallet.address), user.userId);
    this.referralByCode.set(input.referralCode, {
      referralCode: input.referralCode,
      ownerUserId: user.userId,
      status: 'active',
      createdAt,
    });
    return user;
  }

  async addUserWallet(userId: string, wallet: Omit<OtcUserWallet, 'userId' | 'createdAt'>): Promise<OtcUser> {
    const user = this.users.get(userId);
    if (!user) throw new Error(`user not found: ${userId}`);
    const existingUserId = this.userByWallet.get(formatWalletKey(wallet.walletType, wallet.network, wallet.address));
    if (existingUserId && existingUserId !== userId) {
      throw new Error('wallet already belongs to another user');
    }
    const existingWallet = user.wallets.find((candidate) =>
      walletMatches(candidate, wallet.walletType, wallet.network, wallet.address),
    );
    if (existingWallet) {
      return { ...user, wallet: existingWallet };
    }
    const linkedWallet: OtcUserWallet = { ...wallet, userId, createdAt: wallet.verifiedAt };
    const updated: OtcUser = {
      ...user,
      wallets: [...user.wallets, linkedWallet],
      updatedAt: wallet.verifiedAt,
    };
    this.users.set(userId, updated);
    this.userByWallet.set(formatWalletKey(wallet.walletType, wallet.network, wallet.address), userId);
    return { ...updated, wallet: linkedWallet };
  }

  async updateUserProfile(userId: string, profile: UpdateUserProfileInput): Promise<OtcUserProfile> {
    const user = this.users.get(userId);
    if (!user) throw new Error(`user not found: ${userId}`);
    const emailChanged = profile.email !== undefined && profile.email !== user.profile.email;
    const { emailVerifiedAt: existingEmailVerifiedAt, ...profileWithoutEmailVerification } = user.profile;
    const updatedProfile: OtcUserProfile = {
      ...(emailChanged ? profileWithoutEmailVerification : user.profile),
      ...(profile.email === undefined ? {} : { email: profile.email }),
      ...(profile.notificationEmailEnabled === undefined
        ? {}
        : { notificationEmailEnabled: profile.notificationEmailEnabled }),
      ...(emailChanged ? { notificationEmailEnabled: false } : {}),
      updatedAt: profile.updatedAt,
    };
    this.users.set(userId, { ...user, profile: updatedProfile, updatedAt: profile.updatedAt });
    return updatedProfile;
  }

  async findReferralCode(referralCode: string): Promise<ReferralCodeLookup | undefined> {
    return this.referralByCode.get(referralCode);
  }

  async countUsers(): Promise<number> {
    return this.users.size;
  }

  async saveEmailVerificationToken(token: OtcEmailVerificationToken): Promise<void> {
    this.emailVerificationTokens.set(token.tokenId, token);
    this.emailVerificationTokenByHash.set(token.tokenHash, token.tokenId);
  }

  async findEmailVerificationTokenByHash(tokenHash: string): Promise<OtcEmailVerificationToken | undefined> {
    const tokenId = this.emailVerificationTokenByHash.get(tokenHash);
    return tokenId ? this.emailVerificationTokens.get(tokenId) : undefined;
  }

  async consumeEmailVerificationToken(tokenId: string, consumedAt: string): Promise<OtcUserProfile> {
    const token = this.emailVerificationTokens.get(tokenId);
    if (!token) throw new Error(`email verification token not found: ${tokenId}`);
    if (token.consumedAt) throw new Error('email verification token already used');
    const user = this.users.get(token.userId);
    if (!user) throw new Error(`user not found: ${token.userId}`);
    const consumed = { ...token, consumedAt };
    const profile: OtcUserProfile = {
      ...user.profile,
      email: token.email,
      emailVerifiedAt: consumedAt,
      notificationEmailEnabled: user.profile.notificationEmailEnabled,
      updatedAt: consumedAt,
    };
    this.emailVerificationTokens.set(tokenId, consumed);
    this.users.set(user.userId, { ...user, profile, updatedAt: consumedAt });
    return profile;
  }

  async listNotificationPreferences(userId: string): Promise<OtcNotificationPreference[]> {
    return Array.from(this.notificationPreferences.values())
      .filter((preference) => preference.userId === userId)
      .sort((left, right) => `${left.channel}:${left.notificationType}`.localeCompare(`${right.channel}:${right.notificationType}`));
  }

  async saveNotificationPreferences(
    userId: string,
    preferences: Omit<OtcNotificationPreference, 'userId' | 'createdAt' | 'updatedAt'>[],
    updatedAt: string,
  ): Promise<OtcNotificationPreference[]> {
    for (const preference of preferences) {
      const key = formatNotificationPreferenceKey(userId, preference.notificationType, preference.channel);
      const existing = this.notificationPreferences.get(key);
      this.notificationPreferences.set(key, {
        userId,
        notificationType: preference.notificationType,
        channel: preference.channel,
        enabled: preference.enabled,
        createdAt: existing?.createdAt ?? updatedAt,
        updatedAt,
      });
    }
    return this.listNotificationPreferences(userId);
  }

  async saveNotificationDelivery(delivery: OtcNotificationDelivery): Promise<{ delivery: OtcNotificationDelivery; created: boolean }> {
    const existingId = this.notificationDeliveryByIdempotencyKey.get(delivery.idempotencyKey);
    if (existingId) {
      const existing = this.notificationDeliveries.get(existingId);
      if (!existing) throw new Error(`notification delivery not found: ${existingId}`);
      return { delivery: existing, created: false };
    }
    this.notificationDeliveries.set(delivery.deliveryId, delivery);
    this.notificationDeliveryByIdempotencyKey.set(delivery.idempotencyKey, delivery.deliveryId);
    return { delivery, created: true };
  }

  async listNotificationDeliveries(query: { status?: OtcNotificationDeliveryStatus; limit?: number } = {}): Promise<OtcNotificationDelivery[]> {
    return Array.from(this.notificationDeliveries.values())
      .filter((delivery) => !query.status || delivery.status === query.status)
      .sort((left, right) => left.nextAttemptAt.localeCompare(right.nextAttemptAt) || left.createdAt.localeCompare(right.createdAt))
      .slice(0, query.limit ?? 100);
  }

  async updateNotificationDelivery(
    deliveryId: string,
    input: { status: OtcNotificationDeliveryStatus; error?: string; nextAttemptAt?: string; updatedAt: string },
  ): Promise<OtcNotificationDelivery> {
    const delivery = this.notificationDeliveries.get(deliveryId);
    if (!delivery) throw new Error(`notification delivery not found: ${deliveryId}`);
    const updated: OtcNotificationDelivery = {
      ...delivery,
      status: input.status,
      attempts: input.status === 'failed' ? delivery.attempts + 1 : delivery.attempts,
      ...(input.status === 'sent' ? { lastError: undefined } : input.error ? { lastError: input.error } : {}),
      ...(input.nextAttemptAt ? { nextAttemptAt: input.nextAttemptAt } : {}),
      ...(input.status === 'sent' ? { sentAt: input.updatedAt } : {}),
      updatedAt: input.updatedAt,
    };
    this.notificationDeliveries.set(deliveryId, updated);
    return updated;
  }

  async unsubscribeNotificationByTokenHash(tokenHash: string, updatedAt: string): Promise<OtcNotificationDelivery> {
    const delivery = Array.from(this.notificationDeliveries.values()).find((candidate) => candidate.unsubscribeTokenHash === tokenHash);
    if (!delivery) throw new Error('unsubscribe token not found');
    if (delivery.userId) {
      await this.saveNotificationPreferences(delivery.userId, [{
        notificationType: delivery.notificationType,
        channel: delivery.channel,
        enabled: false,
      }], updatedAt);
    }
    const updated = { ...delivery, status: 'unsubscribed' as const, updatedAt };
    this.notificationDeliveries.set(delivery.deliveryId, updated);
    return updated;
  }

  async listNotificationTargets(
    notificationType: OtcNotificationPreference['notificationType'],
    channel: OtcNotificationPreference['channel'],
  ): Promise<OtcNotificationTarget[]> {
    const targets: OtcNotificationTarget[] = [];
    for (const preference of this.notificationPreferences.values()) {
      if (preference.notificationType !== notificationType || preference.channel !== channel || !preference.enabled) {
        continue;
      }
      const user = this.users.get(preference.userId);
      if (!user) continue;
      if (channel === 'email' && user.profile.email && user.profile.emailVerifiedAt) {
        targets.push({ user, channel, recipient: user.profile.email });
      }
    }
    return targets.sort((left, right) => left.user.userId.localeCompare(right.user.userId));
  }

  async saveOrder(order: OtcOrder): Promise<OtcOrder> {
    this.orders.set(order.orderId, order);
    return order;
  }

  async findOrderById(orderId: string): Promise<OtcOrder | undefined> {
    return this.orders.get(orderId);
  }

  async listOrders(query: OrderBookQuery = {}): Promise<OrderBookPage> {
    const limit = normalizeLimit(query.limit);
    const offset = parseCursor(query.cursor);
    const filtered = Array.from(this.orders.values()).filter((order) => orderMatchesQuery(order, query));
    filtered.sort((left, right) => compareOrders(left, right, query.sort));
    const page = filtered.slice(offset, offset + limit);
    return {
      items: page,
      total: filtered.length,
      limit,
      ...(offset + limit < filtered.length ? { nextCursor: String(offset + limit) } : {}),
    };
  }

  async listOpenOrdersForStats(): Promise<OtcOrder[]> {
    return Array.from(this.orders.values()).filter((order) => order.status === 'open' || order.status === 'partially_filled');
  }

  async listOrdersByUser(userId: string): Promise<OtcOrder[]> {
    return Array.from(this.orders.values())
      .filter((order) => order.makerUserId === userId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async reserveOrderFill(orderId: string, amountPrl: string, updatedAt: string): Promise<OtcOrder> {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`order not found: ${orderId}`);
    if (!['open', 'partially_filled'].includes(order.status)) {
      throw new Error(`order is not fillable: ${order.status}`);
    }
    const remaining = parseDecimalUnits(order.remainingPrl, 8);
    const fill = parseDecimalUnits(amountPrl, 8);
    if (remaining < fill) {
      throw new Error('order remaining amount is too small');
    }
    const nextRemaining = remaining - fill;
    const updated: OtcOrder = {
      ...order,
      remainingPrl: formatDecimalUnits(nextRemaining, 8),
      status: nextRemaining === 0n ? 'filled' : 'partially_filled',
      updatedAt,
    };
    this.orders.set(orderId, updated);
    return updated;
  }

  async saveOrderQuoteLink(link: OtcOrderQuoteLink): Promise<void> {
    this.orderQuoteLinks.set(link.quoteId, link);
  }

  async findOrderQuoteLinkByQuoteId(quoteId: string): Promise<OtcOrderQuoteLink | undefined> {
    return this.orderQuoteLinks.get(quoteId);
  }

  async findOrderPrefundAllocationByOrderId(orderId: string): Promise<OrderPrefundAllocation | undefined> {
    return this.orderPrefundAllocations.get(orderId);
  }

  async listOrdersByPrefundState(
    state: import('@kaspacom/pearl-sdk').OtcOrderPrefundState,
    limit = 100,
  ): Promise<OtcOrder[]> {
    return Array.from(this.orders.values())
      .filter((order) => order.prefundState === state)
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
      .slice(0, Math.max(1, Math.min(500, Math.floor(limit))));
  }

  async applyPrefundFundedObservation(input: {
    orderId: string;
    fundingOutpoint: string;
    fundedGrains: string;
    fundedAt: string;
    updatedAt: string;
  }): Promise<OtcOrder> {
    const order = this.orders.get(input.orderId);
    if (!order) throw new Error(`order not found: ${input.orderId}`);
    if (order.prefundState !== 'pending_funding') {
      throw new Error(`order ${input.orderId} not pending funding (state=${order.prefundState})`);
    }
    const updated: OtcOrder = {
      ...order,
      prefundState: 'funded',
      prefundFundedOutpoint: input.fundingOutpoint,
      prefundFundedGrains: input.fundedGrains,
      prefundRemainingGrains: input.fundedGrains,
      prefundFundedAt: input.fundedAt,
      updatedAt: input.updatedAt,
    };
    this.orders.set(input.orderId, updated);
    return updated;
  }

  async applyPrefundExpired(orderId: string, updatedAt: string): Promise<OtcOrder> {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`order not found: ${orderId}`);
    if (order.prefundState !== 'pending_funding') {
      throw new Error(`order ${orderId} not pending funding (state=${order.prefundState})`);
    }
    const updated: OtcOrder = {
      ...order,
      prefundState: 'expired',
      status: 'expired',
      updatedAt,
    };
    this.orders.set(orderId, updated);
    return updated;
  }

  async saveOrderSweep(input: SaveOrderSweepInput): Promise<OtcOrderSweep> {
    if (this.orderSweepByTradeId.has(input.tradeId)) {
      throw new Error(`sweep already exists for trade: ${input.tradeId}`);
    }
    const now = new Date().toISOString();
    const sweep: OtcOrderSweep = {
      sweepId: input.sweepId,
      orderId: input.orderId,
      tradeId: input.tradeId,
      inputOutpoint: input.inputOutpoint,
      sweptGrains: input.sweptGrains,
      ...(input.changeOutpoint ? { changeOutpoint: input.changeOutpoint } : {}),
      ...(input.changeGrains ? { changeGrains: input.changeGrains } : {}),
      ...(input.sweepPsbtBase64 ? { sweepPsbtBase64: input.sweepPsbtBase64 } : {}),
      status: input.status,
      createdAt: now,
      updatedAt: now,
    };
    this.orderSweeps.set(input.sweepId, sweep);
    this.orderSweepByTradeId.set(input.tradeId, input.sweepId);
    return sweep;
  }

  async findOrderSweepById(sweepId: string): Promise<OtcOrderSweep | undefined> {
    return this.orderSweeps.get(sweepId);
  }

  async findOrderSweepByTradeId(tradeId: string): Promise<OtcOrderSweep | undefined> {
    const sweepId = this.orderSweepByTradeId.get(tradeId);
    return sweepId ? this.orderSweeps.get(sweepId) : undefined;
  }

  async listOrderSweepsByOrderId(orderId: string): Promise<OtcOrderSweep[]> {
    return Array.from(this.orderSweeps.values())
      .filter((sweep) => sweep.orderId === orderId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async updateOrderSweep(input: {
    sweepId: string;
    status?: OtcOrderSweepStatus;
    sweepPsbtBase64?: string;
    sweepTxid?: string;
    changeOutpoint?: string;
    changeGrains?: string;
    failureReason?: string;
    updatedAt: string;
  }): Promise<OtcOrderSweep> {
    const existing = this.orderSweeps.get(input.sweepId);
    if (!existing) throw new Error(`sweep not found: ${input.sweepId}`);
    const updated: OtcOrderSweep = {
      ...existing,
      ...(input.status ? { status: input.status } : {}),
      ...(input.sweepPsbtBase64 ? { sweepPsbtBase64: input.sweepPsbtBase64 } : {}),
      ...(input.sweepTxid ? { sweepTxid: input.sweepTxid } : {}),
      ...(input.changeOutpoint ? { changeOutpoint: input.changeOutpoint } : {}),
      ...(input.changeGrains ? { changeGrains: input.changeGrains } : {}),
      ...(input.failureReason ? { failureReason: input.failureReason } : {}),
      updatedAt: input.updatedAt,
    };
    this.orderSweeps.set(input.sweepId, updated);
    return updated;
  }

  async applyOrderPrefundSweepProgress(input: {
    orderId: string;
    sweptGrains: string;
    newRemainingGrains: string;
    newState: 'partially_swept' | 'fully_swept';
    updatedAt: string;
  }): Promise<OtcOrder> {
    const order = this.orders.get(input.orderId);
    if (!order) throw new Error(`order not found: ${input.orderId}`);
    if (!['funded', 'partially_swept'].includes(order.prefundState ?? '')) {
      throw new Error(`order ${input.orderId} not eligible for sweep progress (state=${order.prefundState})`);
    }
    const updated: OtcOrder = {
      ...order,
      prefundRemainingGrains: input.newRemainingGrains,
      prefundState: input.newState,
      updatedAt: input.updatedAt,
    };
    this.orders.set(input.orderId, updated);
    return updated;
  }

  async applyPrefundRefundPending(input: { orderId: string; updatedAt: string }): Promise<OtcOrder> {
    const order = this.orders.get(input.orderId);
    if (!order) throw new Error(`order not found: ${input.orderId}`);
    if (!['funded', 'partially_swept'].includes(order.prefundState ?? '')) {
      throw new Error(
        `order ${input.orderId} not eligible for refund_pending (state=${order.prefundState})`,
      );
    }
    const updated: OtcOrder = {
      ...order,
      prefundState: 'refund_pending',
      updatedAt: input.updatedAt,
    };
    this.orders.set(input.orderId, updated);
    return updated;
  }

  async applyPrefundRefunded(input: { orderId: string; refundTxid: string; updatedAt: string }): Promise<OtcOrder> {
    const order = this.orders.get(input.orderId);
    if (!order) throw new Error(`order not found: ${input.orderId}`);
    if (order.prefundState !== 'refund_pending') {
      throw new Error(`order ${input.orderId} not in refund_pending (state=${order.prefundState})`);
    }
    const updated: OtcOrder = {
      ...order,
      prefundState: 'refunded',
      prefundRefundTxid: input.refundTxid,
      status: 'cancelled',
      updatedAt: input.updatedAt,
    };
    this.orders.set(input.orderId, updated);
    return updated;
  }

  async reserveOrderPrefundAllocation(
    allocation: OrderPrefundAllocationInput,
  ): Promise<{ allocation: OrderPrefundAllocation; created: boolean }> {
    const existing = this.orderPrefundAllocations.get(allocation.orderId);
    if (existing) {
      return { allocation: existing, created: false };
    }
    const derivationKey = formatOrderPrefundDerivationKey(allocation);
    const existingOrderId = this.orderPrefundAllocationByDerivation.get(derivationKey);
    if (existingOrderId && existingOrderId !== allocation.orderId) {
      throw new PearlEscrowDerivationCollisionError(
        `Order prefund derivation already allocated: ${allocation.derivationPath}`,
      );
    }
    const persisted: OrderPrefundAllocation = {
      ...allocation,
      createdAt: new Date().toISOString(),
    };
    this.orderPrefundAllocations.set(allocation.orderId, persisted);
    this.orderPrefundAllocationByDerivation.set(derivationKey, allocation.orderId);
    return { allocation: persisted, created: true };
  }

  async savePointEvent(event: OtcPointEvent): Promise<{ event: OtcPointEvent; created: boolean }> {
    const existing = this.pointEvents.get(event.pointEventId);
    if (existing) return { event: existing, created: false };
    this.pointEvents.set(event.pointEventId, event);
    return { event, created: true };
  }

  async listPointEvents(userId: string): Promise<OtcPointEvent[]> {
    return Array.from(this.pointEvents.values())
      .filter((event) => event.userId === userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async listTradesForUser(user: OtcUser): Promise<OtcTrade[]> {
    const addresses = new Set(user.wallets.map((wallet) => wallet.address.toLowerCase()));
    return Array.from(this.trades.values())
      .filter(
        (trade) =>
          addresses.has(trade.buyerUsdcAddress.toLowerCase()) ||
          addresses.has(trade.sellerUsdcReceiveAddress.toLowerCase()) ||
          addresses.has(trade.buyerPearlAddress.toLowerCase()) ||
          addresses.has(trade.sellerPearlRefundAddress.toLowerCase()),
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
}

type QuoteRow = Record<string, unknown> & {
  quote: OtcQuote;
  request_hash?: string | null;
}

type TradeRow = Record<string, unknown> & {
  trade: OtcTrade;
  request_hash?: string | null;
}

type EventRow = Record<string, unknown> & {
  event: TradeEvent;
}

type SideEffectRow = Record<string, unknown> & {
  idempotency_key: string;
  request_hash?: string | null;
  trade_id: string;
  effect_type: string;
  status: string;
  actor: string;
  source_event_id: string | null;
  tx_hash: string | null;
  outpoint: string | null;
  block_number: string | number | null;
  block_hash: string | null;
  chain_id: string | number | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

type PearlEscrowAllocationRow = Record<string, unknown> & {
  trade_id: string;
  allocator_key: string;
  derivation_prefix: string;
  derivation_index: string | number;
  derivation_path: string;
  escrow_address: string;
  internal_pubkey_hex: string;
  taproot_output_script_hex: string;
  created_at: Date | string;
}

type OrderPrefundAllocationRow = Record<string, unknown> & {
  order_id: string;
  allocator_key: string;
  derivation_prefix: string;
  derivation_index: string | number;
  derivation_path: string;
  escrow_address: string;
  internal_pubkey_hex: string;
  taproot_output_script_hex: string;
  script_leaves: OrderPrefundAllocation['scriptLeaves'] | string;
  signer_pubkeys: OrderPrefundAllocation['signerPubkeys'] | string;
  created_at: Date | string;
}

type OrderSweepRow = Record<string, unknown> & {
  sweep_id: string;
  order_id: string;
  trade_id: string;
  input_outpoint: string;
  swept_grains: string | number;
  change_outpoint: string | null;
  change_grains: string | number | null;
  sweep_psbt_base64: string | null;
  sweep_txid: string | null;
  status: OtcOrderSweepStatus;
  failure_reason: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

type WalletChallengeRow = Record<string, unknown> & {
  challenge_id: string;
  wallet_type: string;
  network: string;
  address: string;
  message: string;
  nonce: string;
  expires_at: Date | string;
  consumed_at: Date | string | null;
  created_at: Date | string;
}

type UserRow = Record<string, unknown> & {
  user_id: string;
  referral_code: string;
  status?: string;
  user_created_at: Date | string;
  user_updated_at: Date | string;
  wallet_type: string;
  network: string;
  address: string;
  public_key_hex: string | null;
  verified_at: Date | string;
  wallet_created_at: Date | string;
  email: string | null;
  email_verified_at: Date | string | null;
  notification_email_enabled: boolean;
  profile_created_at: Date | string;
  profile_updated_at: Date | string;
  referrer_user_id: string | null;
  referred_by_code: string | null;
  source_url: string | null;
  attributed_at: Date | string | null;
}

type UserWalletRow = Record<string, unknown> & {
  user_id: string;
  wallet_type: string;
  network: string;
  address: string;
  public_key_hex: string | null;
  verified_at: Date | string;
  created_at?: Date | string;
  wallet_created_at?: Date | string;
}

type ReferralCodeRow = Record<string, unknown> & {
  referral_code: string;
  owner_user_id: string;
  status: 'active' | 'disabled';
  created_at: Date | string;
}

type EmailVerificationTokenRow = Record<string, unknown> & {
  token_id: string;
  user_id: string;
  email: string;
  token_hash: string;
  expires_at: Date | string;
  consumed_at: Date | string | null;
  created_at: Date | string;
}

type NotificationPreferenceRow = Record<string, unknown> & {
  user_id: string;
  notification_type: OtcNotificationPreference['notificationType'];
  channel: OtcNotificationPreference['channel'];
  enabled: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

type NotificationDeliveryRow = Record<string, unknown> & {
  delivery_id: string;
  user_id: string | null;
  notification_type: OtcNotificationDelivery['notificationType'];
  channel: OtcNotificationDelivery['channel'];
  recipient: string;
  status: OtcNotificationDelivery['status'];
  idempotency_key: string;
  payload: Record<string, unknown> | string;
  unsubscribe_token_hash: string | null;
  attempts: number;
  last_error: string | null;
  next_attempt_at: Date | string;
  sent_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

type OrderRow = Record<string, unknown> & {
  order_id: string;
  maker_user_id: string;
  side: OtcOrder['side'];
  funding_asset: OtcOrder['fundingAsset'];
  maker_pearl_address: string | null;
  maker_usdc_address: string | null;
  maker_pearl_pubkey: string | null;
  maker_pearl_pubkey_proof: string | null;
  pearl_release_signing_mode: OtcOrder['pearlReleaseSigningMode'] | null;
  amount_prl: string | number;
  remaining_prl: string | number;
  price_usdc_per_prl: string | number;
  min_fill_prl: string | number | null;
  status: OtcOrder['status'];
  expires_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  prefund_mode: OtcOrder['prefundMode'] | null;
  prefund_state: OtcOrder['prefundState'] | null;
  prefund_escrow_address: string | null;
  prefund_funded_outpoint: string | null;
  prefund_funded_grains: string | number | null;
  prefund_remaining_grains: string | number | null;
  prefund_funded_at: Date | string | null;
  prefund_refund_eligible_after_unixtime: string | number | null;
  prefund_refund_txid: string | null;
  total_count?: string | number;
}

type OrderQuoteLinkRow = Record<string, unknown> & {
  quote_id: string;
  order_id: string;
  amount_prl: string | number;
  taker_user_id?: string | null;
  taker_pearl_address?: string | null;
  taker_usdc_address?: string | null;
  created_at: Date | string;
}

type PointEventRow = Record<string, unknown> & {
  point_event_id: string;
  user_id: string;
  source: OtcPointEvent['source'];
  points: string | number;
  related_user_id: string | null;
  trade_id: string | null;
  order_id: string | null;
  referral_code: string | null;
  metadata: Record<string, unknown>;
  created_at: Date | string;
}

export class PgOtcRepository implements OtcRepository {
  private readonly client: PgTransactionalClient;

  constructor(client: PgTransactionalClient) {
    this.client = client;
  }

  async saveQuote(quote: OtcQuote, clientRequestId: string, requestHash?: string): Promise<void> {
    const result = await this.client.query(
      `INSERT INTO otc_quotes (quote_id, client_request_id, request_hash, quote)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (client_request_id) DO NOTHING`,
      [quote.quoteId, clientRequestId, requestHash ?? null, JSON.stringify(quote)],
    );
    if ((result.rowCount ?? 0) === 0) {
      const existing = await this.findQuoteIdempotencyByClientRequestId(clientRequestId);
      if (!existing) throw new Error(`quote insert failed: ${clientRequestId}`);
      assertIdempotencyHashMatch('quote', clientRequestId, existing.requestHash, requestHash);
    }
  }

  async findQuoteById(quoteId: string): Promise<OtcQuote | undefined> {
    const result = await this.client.query<QuoteRow>('SELECT quote FROM otc_quotes WHERE quote_id = $1', [quoteId]);
    return result.rows[0]?.quote;
  }

  async findQuoteByClientRequestId(clientRequestId: string): Promise<OtcQuote | undefined> {
    const result = await this.client.query<QuoteRow>('SELECT quote FROM otc_quotes WHERE client_request_id = $1', [
      clientRequestId,
    ]);
    return result.rows[0]?.quote;
  }

  async findQuoteIdempotencyByClientRequestId(clientRequestId: string): Promise<QuoteIdempotencyRecord | undefined> {
    const result = await this.client.query<QuoteRow>('SELECT quote, request_hash FROM otc_quotes WHERE client_request_id = $1', [
      clientRequestId,
    ]);
    const row = result.rows[0];
    if (!row) return undefined;
    return { quote: row.quote, ...(row.request_hash ? { requestHash: row.request_hash } : {}) };
  }

  async saveTrade(trade: OtcTrade, clientRequestId: string, requestHash?: string): Promise<void> {
    const result = await this.client.query(
      `INSERT INTO otc_trades (trade_id, quote_id, client_request_id, request_hash, state, trade)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT DO NOTHING`,
      [trade.tradeId, trade.quoteId, clientRequestId, requestHash ?? null, trade.state, JSON.stringify(trade)],
    );
    if ((result.rowCount ?? 0) === 0) {
      const existing = await this.findTradeIdempotencyByClientRequestId(clientRequestId);
      if (existing) {
        assertIdempotencyHashMatch('trade', clientRequestId, existing.requestHash, requestHash);
        return;
      }
      if (await this.findTradeByQuoteId(trade.quoteId)) {
        throw new Error('quote already accepted');
      }
      throw new Error(`trade insert failed: ${clientRequestId}`);
    }
  }

  async saveAcceptedTrade(input: SaveAcceptedTradeInput): Promise<void> {
    await this.client.withTransaction(async (tx) => {
      const result = await tx.query(
        `INSERT INTO otc_trades (trade_id, quote_id, client_request_id, request_hash, state, trade)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT DO NOTHING`,
        [
          input.trade.tradeId,
          input.trade.quoteId,
          input.clientRequestId,
          input.requestHash ?? null,
          input.trade.state,
          JSON.stringify(input.trade),
        ],
      );
      if ((result.rowCount ?? 0) === 0) {
        const existing = await findTradeIdempotencyByClientRequestIdWithClient(tx, input.clientRequestId);
        if (existing) {
          assertIdempotencyHashMatch('trade', input.clientRequestId, existing.requestHash, input.requestHash);
          return;
        }
        if (await findTradeByQuoteIdWithClient(tx, input.trade.quoteId)) {
          throw new Error('quote already accepted');
        }
        throw new Error(`trade insert failed: ${input.clientRequestId}`);
      }
      if (input.orderFill) {
        const fillResult = await tx.query(
          `UPDATE otc_orders
              SET remaining_prl = remaining_prl - $2::numeric,
                  status = CASE WHEN remaining_prl - $2::numeric = 0 THEN 'filled' ELSE 'partially_filled' END,
                  updated_at = $3
            WHERE order_id = $1
              AND status IN ('open', 'partially_filled')
              AND remaining_prl >= $2::numeric
              AND (expires_at IS NULL OR expires_at > $3)`,
          [input.orderFill.orderId, input.orderFill.amountPrl, input.orderFill.updatedAt],
        );
        if ((fillResult.rowCount ?? 0) === 0) {
          throw new Error('order is no longer fillable for requested amount');
        }
      }
      await tx.query(
        `INSERT INTO otc_trade_events (trade_id, source_event_id, event, observed_at)
         VALUES ($1, $2, $3::jsonb, $4)
         ON CONFLICT (trade_id, source_event_id) DO NOTHING`,
        [input.event.tradeId, input.event.sourceEventId, JSON.stringify(input.event), input.event.observedAt],
      );
    });
  }

  async findTradeById(tradeId: string): Promise<OtcTrade | undefined> {
    const result = await this.client.query<TradeRow>('SELECT trade FROM otc_trades WHERE trade_id = $1', [tradeId]);
    return result.rows[0]?.trade;
  }

  async listTrades(): Promise<OtcTrade[]> {
    const result = await this.client.query<TradeRow>(
      `SELECT trade
         FROM otc_trades
        ORDER BY updated_at DESC, trade_id ASC`,
    );
    return result.rows.map((row) => row.trade);
  }

  async findTradeByQuoteId(quoteId: string): Promise<OtcTrade | undefined> {
    const result = await this.client.query<TradeRow>('SELECT trade FROM otc_trades WHERE quote_id = $1', [quoteId]);
    return result.rows[0]?.trade;
  }

  async findTradeByClientRequestId(clientRequestId: string): Promise<OtcTrade | undefined> {
    const result = await this.client.query<TradeRow>('SELECT trade FROM otc_trades WHERE client_request_id = $1', [
      clientRequestId,
    ]);
    return result.rows[0]?.trade;
  }

  async findTradeIdempotencyByClientRequestId(clientRequestId: string): Promise<TradeIdempotencyRecord | undefined> {
    const result = await this.client.query<TradeRow>('SELECT trade, request_hash FROM otc_trades WHERE client_request_id = $1', [
      clientRequestId,
    ]);
    const row = result.rows[0];
    if (!row) return undefined;
    return { trade: row.trade, ...(row.request_hash ? { requestHash: row.request_hash } : {}) };
  }

  async updateTrade(trade: OtcTrade): Promise<void> {
    await this.client.query(
      `UPDATE otc_trades
          SET state = $2, trade = $3::jsonb, updated_at = now()
        WHERE trade_id = $1`,
      [trade.tradeId, trade.state, JSON.stringify(trade)],
    );
  }

  async findPearlEscrowAllocationByTradeId(tradeId: string): Promise<PearlEscrowAllocation | undefined> {
    const result = await this.client.query<PearlEscrowAllocationRow>(
      `SELECT trade_id, allocator_key, derivation_prefix, derivation_index,
              derivation_path, escrow_address, internal_pubkey_hex,
              taproot_output_script_hex, created_at
         FROM pearl_escrow_allocations
        WHERE trade_id = $1`,
      [tradeId],
    );
    return result.rows[0] ? rowToPearlEscrowAllocation(result.rows[0]) : undefined;
  }

  async reservePearlEscrowAllocation(
    allocation: PearlEscrowAllocationInput,
  ): Promise<{ allocation: PearlEscrowAllocation; created: boolean }> {
    const existingTrade = await this.findPearlEscrowAllocationByTradeId(allocation.tradeId);
    if (existingTrade) {
      return { allocation: existingTrade, created: false };
    }

    const existingDerivation = await this.findPearlEscrowAllocationByDerivation(allocation);
    if (existingDerivation && existingDerivation.tradeId !== allocation.tradeId) {
      throw new PearlEscrowDerivationCollisionError(
        `Pearl escrow derivation already allocated: ${allocation.derivationPath}`,
      );
    }

    try {
      const result = await this.client.query<PearlEscrowAllocationRow>(
        `INSERT INTO pearl_escrow_allocations (
           trade_id, allocator_key, derivation_prefix, derivation_index,
           derivation_path, escrow_address, internal_pubkey_hex, taproot_output_script_hex
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (trade_id) DO NOTHING
         RETURNING trade_id, allocator_key, derivation_prefix, derivation_index,
                   derivation_path, escrow_address, internal_pubkey_hex,
                   taproot_output_script_hex, created_at`,
        [
          allocation.tradeId,
          allocation.allocatorKey,
          allocation.derivationPrefix,
          allocation.derivationIndex,
          allocation.derivationPath,
          allocation.escrowAddress,
          allocation.internalPubkeyHex,
          allocation.taprootOutputScriptHex,
        ],
      );
      if ((result.rowCount ?? 0) > 0) {
        return { allocation: rowToPearlEscrowAllocation(result.rows[0]), created: true };
      }
      const createdByConcurrentRequest = await this.findPearlEscrowAllocationByTradeId(allocation.tradeId);
      if (createdByConcurrentRequest) {
        return { allocation: createdByConcurrentRequest, created: false };
      }
      throw new Error(`Pearl escrow allocation insert failed: ${allocation.tradeId}`);
    } catch (error) {
      if (isPgUniqueViolation(error, 'pearl_escrow_allocations_derivation_unique')) {
        throw new PearlEscrowDerivationCollisionError(
          `Pearl escrow derivation already allocated: ${allocation.derivationPath}`,
        );
      }
      throw error;
    }
  }

  private async findPearlEscrowAllocationByDerivation(
    allocation: PearlEscrowAllocationInput,
  ): Promise<PearlEscrowAllocation | undefined> {
    const result = await this.client.query<PearlEscrowAllocationRow>(
      `SELECT trade_id, allocator_key, derivation_prefix, derivation_index,
              derivation_path, escrow_address, internal_pubkey_hex,
              taproot_output_script_hex, created_at
         FROM pearl_escrow_allocations
        WHERE allocator_key = $1
          AND derivation_prefix = $2
          AND derivation_index = $3`,
      [allocation.allocatorKey, allocation.derivationPrefix, allocation.derivationIndex],
    );
    return result.rows[0] ? rowToPearlEscrowAllocation(result.rows[0]) : undefined;
  }

  async listOrdersByPrefundState(
    state: import('@kaspacom/pearl-sdk').OtcOrderPrefundState,
    limit = 100,
  ): Promise<OtcOrder[]> {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const result = await this.client.query<OrderRow>(
      `SELECT ${ORDER_SELECT_COLUMNS}
         FROM otc_orders
        WHERE prefund_state = $1
        ORDER BY updated_at ASC
        LIMIT $2`,
      [state, safeLimit],
    );
    return result.rows.map(rowToOrder);
  }

  async applyPrefundFundedObservation(input: {
    orderId: string;
    fundingOutpoint: string;
    fundedGrains: string;
    fundedAt: string;
    updatedAt: string;
  }): Promise<OtcOrder> {
    const result = await this.client.query<OrderRow>(
      `UPDATE otc_orders
          SET prefund_state = 'funded',
              prefund_funded_outpoint = $2,
              prefund_funded_grains = $3::numeric,
              prefund_remaining_grains = $3::numeric,
              prefund_funded_at = $4,
              updated_at = $5
        WHERE order_id = $1
          AND prefund_state = 'pending_funding'
        RETURNING ${ORDER_SELECT_COLUMNS}`,
      [input.orderId, input.fundingOutpoint, input.fundedGrains, input.fundedAt, input.updatedAt],
    );
    if (!result.rows[0]) {
      throw new Error(`order ${input.orderId} not pending funding (concurrent transition or unknown order)`);
    }
    return rowToOrder(result.rows[0]);
  }

  async applyPrefundExpired(orderId: string, updatedAt: string): Promise<OtcOrder> {
    const result = await this.client.query<OrderRow>(
      `UPDATE otc_orders
          SET prefund_state = 'expired',
              status = 'expired',
              updated_at = $2
        WHERE order_id = $1
          AND prefund_state = 'pending_funding'
        RETURNING ${ORDER_SELECT_COLUMNS}`,
      [orderId, updatedAt],
    );
    if (!result.rows[0]) {
      throw new Error(`order ${orderId} not pending funding (concurrent transition or unknown order)`);
    }
    return rowToOrder(result.rows[0]);
  }

  async saveOrderSweep(input: SaveOrderSweepInput): Promise<OtcOrderSweep> {
    const result = await this.client.query<OrderSweepRow>(
      `INSERT INTO otc_order_sweeps (
         sweep_id, order_id, trade_id, input_outpoint, swept_grains,
         change_outpoint, change_grains, sweep_psbt_base64, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING sweep_id, order_id, trade_id, input_outpoint, swept_grains,
                 change_outpoint, change_grains, sweep_psbt_base64, sweep_txid,
                 status, failure_reason, created_at, updated_at`,
      [
        input.sweepId,
        input.orderId,
        input.tradeId,
        input.inputOutpoint,
        input.sweptGrains,
        input.changeOutpoint ?? null,
        input.changeGrains ?? null,
        input.sweepPsbtBase64 ?? null,
        input.status,
      ],
    );
    return rowToOrderSweep(result.rows[0]);
  }

  async findOrderSweepById(sweepId: string): Promise<OtcOrderSweep | undefined> {
    const result = await this.client.query<OrderSweepRow>(
      `SELECT sweep_id, order_id, trade_id, input_outpoint, swept_grains,
              change_outpoint, change_grains, sweep_psbt_base64, sweep_txid,
              status, failure_reason, created_at, updated_at
         FROM otc_order_sweeps
        WHERE sweep_id = $1`,
      [sweepId],
    );
    return result.rows[0] ? rowToOrderSweep(result.rows[0]) : undefined;
  }

  async findOrderSweepByTradeId(tradeId: string): Promise<OtcOrderSweep | undefined> {
    const result = await this.client.query<OrderSweepRow>(
      `SELECT sweep_id, order_id, trade_id, input_outpoint, swept_grains,
              change_outpoint, change_grains, sweep_psbt_base64, sweep_txid,
              status, failure_reason, created_at, updated_at
         FROM otc_order_sweeps
        WHERE trade_id = $1`,
      [tradeId],
    );
    return result.rows[0] ? rowToOrderSweep(result.rows[0]) : undefined;
  }

  async listOrderSweepsByOrderId(orderId: string): Promise<OtcOrderSweep[]> {
    const result = await this.client.query<OrderSweepRow>(
      `SELECT sweep_id, order_id, trade_id, input_outpoint, swept_grains,
              change_outpoint, change_grains, sweep_psbt_base64, sweep_txid,
              status, failure_reason, created_at, updated_at
         FROM otc_order_sweeps
        WHERE order_id = $1
        ORDER BY created_at ASC`,
      [orderId],
    );
    return result.rows.map(rowToOrderSweep);
  }

  async updateOrderSweep(input: {
    sweepId: string;
    status?: OtcOrderSweepStatus;
    sweepPsbtBase64?: string;
    sweepTxid?: string;
    changeOutpoint?: string;
    changeGrains?: string;
    failureReason?: string;
    updatedAt: string;
  }): Promise<OtcOrderSweep> {
    const result = await this.client.query<OrderSweepRow>(
      `UPDATE otc_order_sweeps
          SET status = COALESCE($2, status),
              sweep_psbt_base64 = COALESCE($3, sweep_psbt_base64),
              sweep_txid = COALESCE($4, sweep_txid),
              change_outpoint = COALESCE($5, change_outpoint),
              change_grains = COALESCE($6::numeric, change_grains),
              failure_reason = COALESCE($7, failure_reason),
              updated_at = $8
        WHERE sweep_id = $1
        RETURNING sweep_id, order_id, trade_id, input_outpoint, swept_grains,
                  change_outpoint, change_grains, sweep_psbt_base64, sweep_txid,
                  status, failure_reason, created_at, updated_at`,
      [
        input.sweepId,
        input.status ?? null,
        input.sweepPsbtBase64 ?? null,
        input.sweepTxid ?? null,
        input.changeOutpoint ?? null,
        input.changeGrains ?? null,
        input.failureReason ?? null,
        input.updatedAt,
      ],
    );
    if (!result.rows[0]) {
      throw new Error(`sweep not found: ${input.sweepId}`);
    }
    return rowToOrderSweep(result.rows[0]);
  }

  async applyOrderPrefundSweepProgress(input: {
    orderId: string;
    sweptGrains: string;
    newRemainingGrains: string;
    newState: 'partially_swept' | 'fully_swept';
    updatedAt: string;
  }): Promise<OtcOrder> {
    const result = await this.client.query<OrderRow>(
      `UPDATE otc_orders
          SET prefund_remaining_grains = $2::numeric,
              prefund_state = $3,
              updated_at = $4
        WHERE order_id = $1
          AND prefund_state IN ('funded', 'partially_swept')
        RETURNING ${ORDER_SELECT_COLUMNS}`,
      [input.orderId, input.newRemainingGrains, input.newState, input.updatedAt],
    );
    if (!result.rows[0]) {
      throw new Error(`order ${input.orderId} not eligible for sweep progress (concurrent transition or unknown order)`);
    }
    return rowToOrder(result.rows[0]);
  }

  async applyPrefundRefundPending(input: { orderId: string; updatedAt: string }): Promise<OtcOrder> {
    const result = await this.client.query<OrderRow>(
      `UPDATE otc_orders
          SET prefund_state = 'refund_pending',
              updated_at = $2
        WHERE order_id = $1
          AND prefund_state IN ('funded', 'partially_swept')
        RETURNING ${ORDER_SELECT_COLUMNS}`,
      [input.orderId, input.updatedAt],
    );
    if (!result.rows[0]) {
      throw new Error(`order ${input.orderId} not eligible for refund_pending (concurrent transition or unknown order)`);
    }
    return rowToOrder(result.rows[0]);
  }

  async applyPrefundRefunded(input: { orderId: string; refundTxid: string; updatedAt: string }): Promise<OtcOrder> {
    const result = await this.client.query<OrderRow>(
      `UPDATE otc_orders
          SET prefund_state = 'refunded',
              prefund_refund_txid = $2,
              status = 'cancelled',
              updated_at = $3
        WHERE order_id = $1
          AND prefund_state = 'refund_pending'
        RETURNING ${ORDER_SELECT_COLUMNS}`,
      [input.orderId, input.refundTxid, input.updatedAt],
    );
    if (!result.rows[0]) {
      throw new Error(`order ${input.orderId} not in refund_pending (concurrent transition or unknown order)`);
    }
    return rowToOrder(result.rows[0]);
  }

  async findOrderPrefundAllocationByOrderId(orderId: string): Promise<OrderPrefundAllocation | undefined> {
    const result = await this.client.query<OrderPrefundAllocationRow>(
      `SELECT order_id, allocator_key, derivation_prefix, derivation_index,
              derivation_path, escrow_address, internal_pubkey_hex,
              taproot_output_script_hex, script_leaves, signer_pubkeys, created_at
         FROM otc_order_prefund_allocations
        WHERE order_id = $1`,
      [orderId],
    );
    return result.rows[0] ? rowToOrderPrefundAllocation(result.rows[0]) : undefined;
  }

  async reserveOrderPrefundAllocation(
    allocation: OrderPrefundAllocationInput,
  ): Promise<{ allocation: OrderPrefundAllocation; created: boolean }> {
    const existingOrder = await this.findOrderPrefundAllocationByOrderId(allocation.orderId);
    if (existingOrder) {
      return { allocation: existingOrder, created: false };
    }
    const existingDerivation = await this.findOrderPrefundAllocationByDerivation(allocation);
    if (existingDerivation && existingDerivation.orderId !== allocation.orderId) {
      throw new PearlEscrowDerivationCollisionError(
        `Order prefund derivation already allocated: ${allocation.derivationPath}`,
      );
    }
    try {
      const result = await this.client.query<OrderPrefundAllocationRow>(
        `INSERT INTO otc_order_prefund_allocations (
           order_id, allocator_key, derivation_prefix, derivation_index,
           derivation_path, escrow_address, internal_pubkey_hex, taproot_output_script_hex,
           script_leaves, signer_pubkeys
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb)
         ON CONFLICT (order_id) DO NOTHING
         RETURNING order_id, allocator_key, derivation_prefix, derivation_index,
                   derivation_path, escrow_address, internal_pubkey_hex,
                   taproot_output_script_hex, script_leaves, signer_pubkeys, created_at`,
        [
          allocation.orderId,
          allocation.allocatorKey,
          allocation.derivationPrefix,
          allocation.derivationIndex,
          allocation.derivationPath,
          allocation.escrowAddress,
          allocation.internalPubkeyHex,
          allocation.taprootOutputScriptHex,
          JSON.stringify(allocation.scriptLeaves),
          JSON.stringify(allocation.signerPubkeys),
        ],
      );
      if ((result.rowCount ?? 0) > 0) {
        return { allocation: rowToOrderPrefundAllocation(result.rows[0]), created: true };
      }
      const createdConcurrently = await this.findOrderPrefundAllocationByOrderId(allocation.orderId);
      if (createdConcurrently) {
        return { allocation: createdConcurrently, created: false };
      }
      throw new Error(`Order prefund allocation insert failed: ${allocation.orderId}`);
    } catch (error) {
      if (isPgUniqueViolation(error, 'otc_order_prefund_allocations_derivation_unique')) {
        throw new PearlEscrowDerivationCollisionError(
          `Order prefund derivation already allocated: ${allocation.derivationPath}`,
        );
      }
      throw error;
    }
  }

  private async findOrderPrefundAllocationByDerivation(
    allocation: OrderPrefundAllocationInput,
  ): Promise<OrderPrefundAllocation | undefined> {
    const result = await this.client.query<OrderPrefundAllocationRow>(
      `SELECT order_id, allocator_key, derivation_prefix, derivation_index,
              derivation_path, escrow_address, internal_pubkey_hex,
              taproot_output_script_hex, script_leaves, signer_pubkeys, created_at
         FROM otc_order_prefund_allocations
        WHERE allocator_key = $1
          AND derivation_prefix = $2
          AND derivation_index = $3`,
      [allocation.allocatorKey, allocation.derivationPrefix, allocation.derivationIndex],
    );
    return result.rows[0] ? rowToOrderPrefundAllocation(result.rows[0]) : undefined;
  }

  async appendEvent(event: TradeEvent): Promise<void> {
    await this.client.query(
      `INSERT INTO otc_trade_events (trade_id, source_event_id, event, observed_at)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (trade_id, source_event_id) DO NOTHING`,
      [event.tradeId, event.sourceEventId, JSON.stringify(event), event.observedAt],
    );
  }

  async listEvents(tradeId: string): Promise<TradeEvent[]> {
    const result = await this.client.query<EventRow>(
      `SELECT event
         FROM otc_trade_events
        WHERE trade_id = $1
        ORDER BY observed_at ASC, event_id ASC`,
      [tradeId],
    );
    return result.rows.map((row) => row.event);
  }

  async saveSideEffect(sideEffect: OtcSideEffect): Promise<{ sideEffect: OtcSideEffect; created: boolean }> {
    const result = await this.client.query<SideEffectRow>(
      `INSERT INTO otc_side_effects (
         idempotency_key, request_hash, trade_id, effect_type, status, actor, source_event_id,
         tx_hash, outpoint, block_number, block_hash, chain_id, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING idempotency_key, request_hash, trade_id, effect_type, status, actor, source_event_id,
                 tx_hash, outpoint, block_number, block_hash, chain_id, metadata,
                 created_at, updated_at`,
      [
        sideEffect.idempotencyKey,
        sideEffect.requestHash ?? null,
        sideEffect.tradeId,
        sideEffect.effectType,
        sideEffect.status,
        sideEffect.actor,
        sideEffect.sourceEventId ?? null,
        sideEffect.txHash ?? null,
        sideEffect.outpoint ?? null,
        sideEffect.blockNumber ?? null,
        sideEffect.blockHash ?? null,
        sideEffect.chainId ?? null,
        JSON.stringify(sideEffect.metadata),
      ],
    );
    if ((result.rowCount ?? 0) > 0) {
      return { sideEffect: rowToSideEffect(result.rows[0]), created: true };
    }
    const existing = await this.findSideEffectByIdempotencyKey(sideEffect.idempotencyKey);
    if (!existing) {
      throw new Error(`side effect insert failed: ${sideEffect.idempotencyKey}`);
    }
    assertIdempotencyHashMatch('side effect', sideEffect.idempotencyKey, existing.requestHash, sideEffect.requestHash);
    return { sideEffect: existing, created: false };
  }

  async updateSideEffect(sideEffect: OtcSideEffect): Promise<OtcSideEffect> {
    const result = await this.client.query<SideEffectRow>(
      `UPDATE otc_side_effects
          SET request_hash = $2,
              trade_id = $3,
              effect_type = $4,
              status = $5,
              actor = $6,
              source_event_id = $7,
              tx_hash = $8,
              outpoint = $9,
              block_number = $10,
              block_hash = $11,
              chain_id = $12,
              metadata = $13::jsonb,
              updated_at = now()
        WHERE idempotency_key = $1
        RETURNING idempotency_key, request_hash, trade_id, effect_type, status, actor, source_event_id,
                  tx_hash, outpoint, block_number, block_hash, chain_id, metadata,
                  created_at, updated_at`,
      [
        sideEffect.idempotencyKey,
        sideEffect.requestHash ?? null,
        sideEffect.tradeId,
        sideEffect.effectType,
        sideEffect.status,
        sideEffect.actor,
        sideEffect.sourceEventId ?? null,
        sideEffect.txHash ?? null,
        sideEffect.outpoint ?? null,
        sideEffect.blockNumber ?? null,
        sideEffect.blockHash ?? null,
        sideEffect.chainId ?? null,
        JSON.stringify(sideEffect.metadata),
      ],
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new Error(`side effect not found: ${sideEffect.idempotencyKey}`);
    }
    return rowToSideEffect(result.rows[0]);
  }

  async findSideEffectByIdempotencyKey(idempotencyKey: string): Promise<OtcSideEffect | undefined> {
    const result = await this.client.query<SideEffectRow>(
      `SELECT idempotency_key, request_hash, trade_id, effect_type, status, actor, source_event_id,
              tx_hash, outpoint, block_number, block_hash, chain_id, metadata,
              created_at, updated_at
         FROM otc_side_effects
        WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
    return result.rows[0] ? rowToSideEffect(result.rows[0]) : undefined;
  }

  async listSideEffects(tradeId: string): Promise<OtcSideEffect[]> {
    const result = await this.client.query<SideEffectRow>(
      `SELECT idempotency_key, request_hash, trade_id, effect_type, status, actor, source_event_id,
              tx_hash, outpoint, block_number, block_hash, chain_id, metadata,
              created_at, updated_at
         FROM otc_side_effects
        WHERE trade_id = $1
        ORDER BY created_at ASC, idempotency_key ASC`,
      [tradeId],
    );
    return result.rows.map(rowToSideEffect);
  }

  async saveWalletChallenge(challenge: OtcUserWalletChallenge): Promise<void> {
    await this.client.query(
      `INSERT INTO otc_user_wallet_challenges (
         challenge_id, wallet_type, network, address, message, nonce, expires_at, consumed_at, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        challenge.challengeId,
        challenge.walletType,
        challenge.network,
        challenge.address,
        challenge.message,
        challenge.nonce,
        challenge.expiresAt,
        challenge.consumedAt ?? null,
        challenge.createdAt,
      ],
    );
  }

  async findWalletChallenge(challengeId: string): Promise<OtcUserWalletChallenge | undefined> {
    const result = await this.client.query<WalletChallengeRow>(
      `SELECT challenge_id, wallet_type, network, address, message, nonce, expires_at, consumed_at, created_at
         FROM otc_user_wallet_challenges
        WHERE challenge_id = $1`,
      [challengeId],
    );
    return result.rows[0] ? rowToWalletChallenge(result.rows[0]) : undefined;
  }

  async consumeWalletChallenge(challengeId: string, consumedAt: string): Promise<boolean> {
    const result = await this.client.query(
      `UPDATE otc_user_wallet_challenges
          SET consumed_at = $2
        WHERE challenge_id = $1
          AND consumed_at IS NULL`,
      [challengeId, consumedAt],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async findUserByWallet(
    walletType: OtcUserWallet['walletType'],
    network: string,
    address: string,
  ): Promise<OtcUser | undefined> {
    return findUserByWalletWithClient(this.client, walletType, network, address);
  }

  async findUserById(userId: string): Promise<OtcUser | undefined> {
    return findUserByIdWithClient(this.client, userId);
  }

  async listUsers(query: AdminUserQuery = {}): Promise<OtcUserListPage> {
    const limit = normalizeListLimit(query.limit);
    const offset = parseListCursor(query.cursor);
    const where: string[] = ['u.status = $1'];
    const values: unknown[] = ['active'];
    if (query.walletType) {
      values.push(query.walletType);
      where.push(`EXISTS (
        SELECT 1 FROM otc_user_wallets filter_wallet
         WHERE filter_wallet.user_id = u.user_id
           AND filter_wallet.wallet_type = $${values.length}
      )`);
    }
    if (query.referrerUserId) {
      values.push(query.referrerUserId);
      where.push(`attr.referrer_user_id = $${values.length}`);
    }
    if (query.search?.trim()) {
      values.push(`%${query.search.trim().toLowerCase()}%`);
      where.push(`(
        lower(u.user_id) LIKE $${values.length}
        OR lower(rc.referral_code) LIKE $${values.length}
        OR lower(COALESCE(p.email, '')) LIKE $${values.length}
        OR lower(COALESCE(attr.referrer_user_id, '')) LIKE $${values.length}
        OR EXISTS (
          SELECT 1 FROM otc_user_wallets search_wallet
           WHERE search_wallet.user_id = u.user_id
             AND (
               lower(search_wallet.address) LIKE $${values.length}
               OR lower(search_wallet.network) LIKE $${values.length}
               OR lower(COALESCE(search_wallet.public_key_hex, '')) LIKE $${values.length}
             )
        )
      )`);
    }
    const whereSql = where.join(' AND ');
    const totalResult = await this.client.query<{ count: string | number }>(
      `SELECT count(*) AS count
         FROM otc_users u
         JOIN otc_user_profiles p ON p.user_id = u.user_id
         JOIN otc_referral_codes rc ON rc.owner_user_id = u.user_id
         LEFT JOIN otc_referral_attributions attr ON attr.referred_user_id = u.user_id
        WHERE ${whereSql}`,
      values,
    );
    const total = Number(totalResult.rows[0]?.count ?? 0);
    const pageValues = [...values, limit, offset];
    const idResult = await this.client.query<{ user_id: string }>(
      `SELECT u.user_id
         FROM otc_users u
         JOIN otc_user_profiles p ON p.user_id = u.user_id
         JOIN otc_referral_codes rc ON rc.owner_user_id = u.user_id
         LEFT JOIN otc_referral_attributions attr ON attr.referred_user_id = u.user_id
        WHERE ${whereSql}
        ORDER BY u.created_at DESC, u.user_id ASC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      pageValues,
    );
    const items = (await Promise.all(idResult.rows.map((row) => findUserByIdWithClient(this.client, row.user_id))))
      .filter((user): user is OtcUser => Boolean(user));
    const nextOffset = offset + items.length;
    return {
      items,
      total,
      limit,
      ...(nextOffset < total ? { nextCursor: String(nextOffset) } : {}),
    };
  }

  async saveUser(input: SaveUserInput): Promise<OtcUser> {
    return this.client.withTransaction(async (tx) => {
      const existing = await findUserByWalletWithClient(tx, input.wallet.walletType, input.wallet.network, input.wallet.address);
      if (existing) {
        return existing;
      }

      await tx.query(
        `INSERT INTO otc_users (user_id, created_at, updated_at)
         VALUES ($1, $2, $2)
         ON CONFLICT (user_id) DO NOTHING`,
        [input.userId, input.wallet.verifiedAt],
      );
      await tx.query(
        `INSERT INTO otc_user_wallets (
           user_id, wallet_type, network, address, public_key_hex, verified_at, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $6)
         ON CONFLICT (wallet_type, network, address) DO NOTHING`,
        [
          input.userId,
          input.wallet.walletType,
          input.wallet.network,
          input.wallet.address,
          input.wallet.publicKeyHex ?? null,
          input.wallet.verifiedAt,
        ],
      );
      await tx.query(
        `INSERT INTO otc_user_profiles (
           user_id, email, notification_email_enabled, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $4)
         ON CONFLICT (user_id) DO NOTHING`,
        [
          input.userId,
          input.profile.email ?? null,
          input.profile.notificationEmailEnabled,
          input.wallet.verifiedAt,
        ],
      );
      await tx.query(
        `INSERT INTO otc_referral_codes (referral_code, owner_user_id, created_at, updated_at)
         VALUES ($1, $2, $3, $3)
         ON CONFLICT (referral_code) DO NOTHING`,
        [input.referralCode, input.userId, input.wallet.verifiedAt],
      );
      const referralCodeOwner = await tx.query<ReferralCodeRow>(
        `SELECT referral_code, owner_user_id, status, created_at
           FROM otc_referral_codes
          WHERE referral_code = $1`,
        [input.referralCode],
      );
      if (referralCodeOwner.rows[0]?.owner_user_id !== input.userId) {
        throw new ReferralCodeCollisionError(input.referralCode);
      }
      if (input.referredBy && input.referredBy.referrerUserId !== input.userId) {
        await tx.query(
          `INSERT INTO otc_referral_attributions (
             referred_user_id, referrer_user_id, referral_code, source_url, attributed_at
           ) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (referred_user_id) DO NOTHING`,
          [
            input.userId,
            input.referredBy.referrerUserId,
            input.referredBy.referralCode,
            input.referredBy.sourceUrl ?? null,
            input.referredBy.attributedAt,
          ],
        );
      }

      const saved = await findUserByIdWithClient(tx, input.userId);
      if (!saved) throw new Error(`user insert failed: ${input.userId}`);
      return saved;
    });
  }

  async addUserWallet(userId: string, wallet: Omit<OtcUserWallet, 'userId' | 'createdAt'>): Promise<OtcUser> {
    return this.client.withTransaction(async (tx) => {
      const user = await findUserByIdWithClient(tx, userId);
      if (!user) throw new Error(`user not found: ${userId}`);
      const existing = await findUserByWalletWithClient(tx, wallet.walletType, wallet.network, wallet.address);
      if (existing && existing.userId !== userId) {
        throw new Error('wallet already belongs to another user');
      }
      await tx.query(
        `INSERT INTO otc_user_wallets (
           user_id, wallet_type, network, address, public_key_hex, verified_at, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $6)
         ON CONFLICT (wallet_type, network, address) DO NOTHING`,
        [userId, wallet.walletType, wallet.network, wallet.address, wallet.publicKeyHex ?? null, wallet.verifiedAt],
      );
      await tx.query('UPDATE otc_users SET updated_at = $2 WHERE user_id = $1', [userId, wallet.verifiedAt]);
      const saved = await findUserByWalletWithClient(tx, wallet.walletType, wallet.network, wallet.address);
      if (!saved) throw new Error(`wallet link failed: ${userId}`);
      if (saved.userId !== userId) {
        throw new Error('wallet already belongs to another user');
      }
      return saved;
    });
  }

  async updateUserProfile(userId: string, profile: UpdateUserProfileInput): Promise<OtcUserProfile> {
    const result = await this.client.query<UserRow>(
      `UPDATE otc_user_profiles
          SET email = COALESCE($2, email),
              email_verified_at = CASE
                WHEN $2::text IS NOT NULL AND $2::text <> COALESCE(email, '') THEN NULL
                ELSE email_verified_at
              END,
              notification_email_enabled = CASE
                WHEN $2::text IS NOT NULL AND $2::text <> COALESCE(email, '') THEN false
                ELSE COALESCE($3, notification_email_enabled)
              END,
              updated_at = $4
        WHERE user_id = $1
        RETURNING user_id, email, email_verified_at, notification_email_enabled,
                  created_at AS profile_created_at, updated_at AS profile_updated_at`,
      [userId, profile.email ?? null, profile.notificationEmailEnabled ?? null, profile.updatedAt],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`user not found: ${userId}`);
    return {
      userId: row.user_id,
      ...(row.email ? { email: row.email } : {}),
      ...(row.email_verified_at ? { emailVerifiedAt: formatPgDate(row.email_verified_at) } : {}),
      notificationEmailEnabled: row.notification_email_enabled,
      createdAt: formatPgDate(row.profile_created_at),
      updatedAt: formatPgDate(row.profile_updated_at),
    };
  }

  async findReferralCode(referralCode: string): Promise<ReferralCodeLookup | undefined> {
    const result = await this.client.query<ReferralCodeRow>(
      `SELECT referral_code, owner_user_id, status, created_at
         FROM otc_referral_codes
        WHERE referral_code = $1`,
      [referralCode],
    );
    return result.rows[0] ? rowToReferralCode(result.rows[0]) : undefined;
  }

  async countUsers(): Promise<number> {
    const result = await this.client.query<{ count: string | number }>('SELECT count(*) AS count FROM otc_users WHERE status = $1', [
      'active',
    ]);
    return Number(result.rows[0]?.count ?? 0);
  }

  async saveEmailVerificationToken(token: OtcEmailVerificationToken): Promise<void> {
    await this.client.query(
      `INSERT INTO otc_email_verification_tokens (
         token_id, user_id, email, token_hash, expires_at, consumed_at, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (token_id) DO NOTHING`,
      [token.tokenId, token.userId, token.email, token.tokenHash, token.expiresAt, token.consumedAt ?? null, token.createdAt],
    );
  }

  async findEmailVerificationTokenByHash(tokenHash: string): Promise<OtcEmailVerificationToken | undefined> {
    const result = await this.client.query<EmailVerificationTokenRow>(
      `SELECT token_id, user_id, email, token_hash, expires_at, consumed_at, created_at
         FROM otc_email_verification_tokens
        WHERE token_hash = $1`,
      [tokenHash],
    );
    return result.rows[0] ? rowToEmailVerificationToken(result.rows[0]) : undefined;
  }

  async consumeEmailVerificationToken(tokenId: string, consumedAt: string): Promise<OtcUserProfile> {
    return this.client.withTransaction(async (tx) => {
      const tokenResult = await tx.query<EmailVerificationTokenRow>(
        `UPDATE otc_email_verification_tokens
            SET consumed_at = $2
          WHERE token_id = $1
            AND consumed_at IS NULL
            AND expires_at > $2
          RETURNING token_id, user_id, email, token_hash, expires_at, consumed_at, created_at`,
        [tokenId, consumedAt],
      );
      const token = tokenResult.rows[0];
      if (!token) {
        throw new Error('email verification token is invalid, expired, or already used');
      }
      const profileResult = await tx.query<UserRow>(
        `UPDATE otc_user_profiles
            SET email = $2,
                email_verified_at = $3,
                updated_at = $3
          WHERE user_id = $1
          RETURNING user_id, email, email_verified_at, notification_email_enabled,
                    created_at AS profile_created_at, updated_at AS profile_updated_at`,
        [token.user_id, token.email, consumedAt],
      );
      const row = profileResult.rows[0];
      if (!row) throw new Error(`user not found: ${token.user_id}`);
      return rowToUserProfile(row);
    });
  }

  async listNotificationPreferences(userId: string): Promise<OtcNotificationPreference[]> {
    const result = await this.client.query<NotificationPreferenceRow>(
      `SELECT user_id, notification_type, channel, enabled, created_at, updated_at
         FROM otc_notification_preferences
        WHERE user_id = $1
        ORDER BY channel ASC, notification_type ASC`,
      [userId],
    );
    return result.rows.map(rowToNotificationPreference);
  }

  async saveNotificationPreferences(
    userId: string,
    preferences: Omit<OtcNotificationPreference, 'userId' | 'createdAt' | 'updatedAt'>[],
    updatedAt: string,
  ): Promise<OtcNotificationPreference[]> {
    for (const preference of preferences) {
      await this.client.query(
        `INSERT INTO otc_notification_preferences (
           user_id, notification_type, channel, enabled, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $5)
         ON CONFLICT (user_id, notification_type, channel) DO UPDATE
            SET enabled = EXCLUDED.enabled,
                updated_at = EXCLUDED.updated_at`,
        [userId, preference.notificationType, preference.channel, preference.enabled, updatedAt],
      );
    }
    return this.listNotificationPreferences(userId);
  }

  async saveNotificationDelivery(delivery: OtcNotificationDelivery): Promise<{ delivery: OtcNotificationDelivery; created: boolean }> {
    const result = await this.client.query<NotificationDeliveryRow>(
      `INSERT INTO otc_notification_deliveries (
         delivery_id, user_id, notification_type, channel, recipient, status,
         idempotency_key, payload, unsubscribe_token_hash, attempts, last_error,
         next_attempt_at, sent_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING delivery_id, user_id, notification_type, channel, recipient, status,
                 idempotency_key, payload, unsubscribe_token_hash, attempts, last_error,
                 next_attempt_at, sent_at, created_at, updated_at`,
      [
        delivery.deliveryId,
        delivery.userId ?? null,
        delivery.notificationType,
        delivery.channel,
        delivery.recipient,
        delivery.status,
        delivery.idempotencyKey,
        JSON.stringify(delivery.payload),
        delivery.unsubscribeTokenHash ?? null,
        delivery.attempts,
        delivery.lastError ?? null,
        delivery.nextAttemptAt,
        delivery.sentAt ?? null,
        delivery.createdAt,
        delivery.updatedAt,
      ],
    );
    if ((result.rowCount ?? 0) > 0) {
      return { delivery: rowToNotificationDelivery(result.rows[0]), created: true };
    }
    const existing = await this.client.query<NotificationDeliveryRow>(
      `SELECT delivery_id, user_id, notification_type, channel, recipient, status,
              idempotency_key, payload, unsubscribe_token_hash, attempts, last_error,
              next_attempt_at, sent_at, created_at, updated_at
         FROM otc_notification_deliveries
        WHERE idempotency_key = $1`,
      [delivery.idempotencyKey],
    );
    return { delivery: rowToNotificationDelivery(existing.rows[0]), created: false };
  }

  async listNotificationDeliveries(query: { status?: OtcNotificationDeliveryStatus; limit?: number } = {}): Promise<OtcNotificationDelivery[]> {
    const values: unknown[] = [];
    const where: string[] = [];
    if (query.status) {
      values.push(query.status);
      where.push(`status = $${values.length}`);
    }
    values.push(Math.max(1, Math.min(query.limit ?? 100, 500)));
    const result = await this.client.query<NotificationDeliveryRow>(
      `SELECT delivery_id, user_id, notification_type, channel, recipient, status,
              idempotency_key, payload, unsubscribe_token_hash, attempts, last_error,
              next_attempt_at, sent_at, created_at, updated_at
         FROM otc_notification_deliveries
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY next_attempt_at ASC, created_at ASC
        LIMIT $${values.length}`,
      values,
    );
    return result.rows.map(rowToNotificationDelivery);
  }

  async updateNotificationDelivery(
    deliveryId: string,
    input: { status: OtcNotificationDeliveryStatus; error?: string; nextAttemptAt?: string; updatedAt: string },
  ): Promise<OtcNotificationDelivery> {
    const result = await this.client.query<NotificationDeliveryRow>(
      `UPDATE otc_notification_deliveries
          SET status = $2,
              attempts = attempts + CASE WHEN $2 = 'failed' THEN 1 ELSE 0 END,
              last_error = CASE
                WHEN $2 = 'sent' THEN NULL
                ELSE COALESCE($3, last_error)
              END,
              next_attempt_at = COALESCE($4, next_attempt_at),
              sent_at = CASE WHEN $2 = 'sent' THEN $5 ELSE sent_at END,
              updated_at = $5
        WHERE delivery_id = $1
        RETURNING delivery_id, user_id, notification_type, channel, recipient, status,
                  idempotency_key, payload, unsubscribe_token_hash, attempts, last_error,
                  next_attempt_at, sent_at, created_at, updated_at`,
      [deliveryId, input.status, input.error ?? null, input.nextAttemptAt ?? null, input.updatedAt],
    );
    if (!result.rows[0]) throw new Error(`notification delivery not found: ${deliveryId}`);
    return rowToNotificationDelivery(result.rows[0]);
  }

  async unsubscribeNotificationByTokenHash(tokenHash: string, updatedAt: string): Promise<OtcNotificationDelivery> {
    return this.client.withTransaction(async (tx) => {
      const deliveryResult = await tx.query<NotificationDeliveryRow>(
        `UPDATE otc_notification_deliveries
            SET status = 'unsubscribed',
                updated_at = $2
          WHERE unsubscribe_token_hash = $1
          RETURNING delivery_id, user_id, notification_type, channel, recipient, status,
                    idempotency_key, payload, unsubscribe_token_hash, attempts, last_error,
                    next_attempt_at, sent_at, created_at, updated_at`,
        [tokenHash, updatedAt],
      );
      const delivery = deliveryResult.rows[0];
      if (!delivery) throw new Error('unsubscribe token not found');
      if (delivery.user_id) {
        await tx.query(
          `INSERT INTO otc_notification_preferences (
             user_id, notification_type, channel, enabled, created_at, updated_at
           ) VALUES ($1, $2, $3, false, $4, $4)
           ON CONFLICT (user_id, notification_type, channel) DO UPDATE
              SET enabled = false,
                  updated_at = EXCLUDED.updated_at`,
          [delivery.user_id, delivery.notification_type, delivery.channel, updatedAt],
        );
      }
      return rowToNotificationDelivery(delivery);
    });
  }

  async listNotificationTargets(
    notificationType: OtcNotificationPreference['notificationType'],
    channel: OtcNotificationPreference['channel'],
  ): Promise<OtcNotificationTarget[]> {
    const result = await this.client.query<UserRow>(
      `${USER_SELECT_FIELDS}
       JOIN otc_notification_preferences pref
         ON pref.user_id = u.user_id
        AND pref.notification_type = $1
        AND pref.channel = $2
        AND pref.enabled = true
       WHERE $2 = 'email'
         AND p.email IS NOT NULL
         AND p.email_verified_at IS NOT NULL
       ORDER BY u.user_id ASC`,
      [notificationType, channel],
    );
    return result.rows.map((row) => ({
      user: rowToUser(row),
      channel,
      recipient: row.email ?? '',
    })).filter((target) => target.recipient);
  }

  async saveOrder(order: OtcOrder): Promise<OtcOrder> {
    const result = await this.client.query<OrderRow>(
      `INSERT INTO otc_orders (
         order_id, maker_user_id, side, funding_asset, maker_pearl_address,
         maker_usdc_address, maker_pearl_pubkey, maker_pearl_pubkey_proof,
         pearl_release_signing_mode, amount_prl, remaining_prl,
         price_usdc_per_prl, min_fill_prl, status, expires_at, created_at, updated_at,
         prefund_mode, prefund_state, prefund_escrow_address,
         prefund_funded_outpoint, prefund_funded_grains, prefund_remaining_grains,
         prefund_funded_at, prefund_refund_eligible_after_unixtime, prefund_refund_txid
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                 $18, $19, $20, $21, $22, $23, $24, $25, $26)
       ON CONFLICT (order_id) DO UPDATE
          SET remaining_prl = EXCLUDED.remaining_prl,
              status = EXCLUDED.status,
              updated_at = EXCLUDED.updated_at,
              prefund_state = COALESCE(EXCLUDED.prefund_state, otc_orders.prefund_state),
              prefund_funded_outpoint = COALESCE(EXCLUDED.prefund_funded_outpoint, otc_orders.prefund_funded_outpoint),
              prefund_funded_grains = COALESCE(EXCLUDED.prefund_funded_grains, otc_orders.prefund_funded_grains),
              prefund_remaining_grains = COALESCE(EXCLUDED.prefund_remaining_grains, otc_orders.prefund_remaining_grains),
              prefund_funded_at = COALESCE(EXCLUDED.prefund_funded_at, otc_orders.prefund_funded_at),
              prefund_refund_txid = COALESCE(EXCLUDED.prefund_refund_txid, otc_orders.prefund_refund_txid)
       RETURNING ${ORDER_SELECT_COLUMNS}`,
      [
        order.orderId,
        order.makerUserId,
        order.side,
        order.fundingAsset,
        order.makerPearlAddress,
        order.makerUsdcAddress,
        order.makerPearlPubkey,
        order.makerPearlPubkeyProof,
        order.pearlReleaseSigningMode,
        order.amountPrl,
        order.remainingPrl,
        order.priceUsdcPerPrl,
        order.minFillPrl ?? null,
        order.status,
        order.expiresAt ?? null,
        order.createdAt,
        order.updatedAt,
        order.prefundMode ?? null,
        order.prefundState ?? null,
        order.prefundEscrowAddress ?? null,
        order.prefundFundedOutpoint ?? null,
        order.prefundFundedGrains ?? null,
        order.prefundRemainingGrains ?? null,
        order.prefundFundedAt ?? null,
        order.prefundRefundEligibleAfterUnixTime ?? null,
        order.prefundRefundTxid ?? null,
      ],
    );
    return rowToOrder(result.rows[0]);
  }

  async findOrderById(orderId: string): Promise<OtcOrder | undefined> {
    const result = await this.client.query<OrderRow>(
      `SELECT ${ORDER_SELECT_COLUMNS}
         FROM otc_orders
        WHERE order_id = $1`,
      [orderId],
    );
    return result.rows[0] ? rowToOrder(result.rows[0]) : undefined;
  }

  async listOrders(query: OrderBookQuery = {}): Promise<OrderBookPage> {
    const limit = normalizeLimit(query.limit);
    const offset = parseCursor(query.cursor);
    const where: string[] = [];
    const params: unknown[] = [];
    addOrderFilter(where, params, 'side', query.side);
    addOrderFilter(where, params, 'status', query.status);
    addOrderFilter(where, params, 'maker_user_id', query.makerUserId);
    addOrderRangeFilter(where, params, 'remaining_prl', '>=', query.minPrl);
    addOrderRangeFilter(where, params, 'remaining_prl', '<=', query.maxPrl);
    addOrderRangeFilter(where, params, 'price_usdc_per_prl', '>=', query.minPrice);
    addOrderRangeFilter(where, params, 'price_usdc_per_prl', '<=', query.maxPrice);
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const orderSql = getOrderBookSortSql(query.sort, query.side);
    const result = await this.client.query<OrderRow>(
      `SELECT ${ORDER_SELECT_COLUMNS},
              count(*) OVER() AS total_count
         FROM otc_orders
         ${whereSql}
        ORDER BY ${orderSql}
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    return {
      items: result.rows.map(rowToOrder),
      total: Number(result.rows[0]?.total_count ?? 0),
      limit,
      ...(offset + limit < Number(result.rows[0]?.total_count ?? 0) ? { nextCursor: String(offset + limit) } : {}),
    };
  }

  async listOpenOrdersForStats(): Promise<OtcOrder[]> {
    const result = await this.client.query<OrderRow>(
      `SELECT ${ORDER_SELECT_COLUMNS}
         FROM otc_orders
        WHERE status IN ($1, $2)`,
      ['open', 'partially_filled'],
    );
    return result.rows.map(rowToOrder);
  }

  async listOrdersByUser(userId: string): Promise<OtcOrder[]> {
    const result = await this.client.query<OrderRow>(
      `SELECT ${ORDER_SELECT_COLUMNS}
         FROM otc_orders
        WHERE maker_user_id = $1
        ORDER BY updated_at DESC, order_id ASC`,
      [userId],
    );
    return result.rows.map(rowToOrder);
  }

  async reserveOrderFill(orderId: string, amountPrl: string, updatedAt: string): Promise<OtcOrder> {
    const result = await this.client.query<OrderRow>(
      `UPDATE otc_orders
          SET remaining_prl = remaining_prl - $2::numeric,
              status = CASE WHEN remaining_prl - $2::numeric = 0 THEN 'filled' ELSE 'partially_filled' END,
              updated_at = $3
        WHERE order_id = $1
          AND status IN ('open', 'partially_filled')
          AND remaining_prl >= $2::numeric
          AND (expires_at IS NULL OR expires_at > $3)
        RETURNING ${ORDER_SELECT_COLUMNS}`,
      [orderId, amountPrl, updatedAt],
    );
    if (!result.rows[0]) {
      throw new Error('order is no longer fillable for requested amount');
    }
    return rowToOrder(result.rows[0]);
  }

  async saveOrderQuoteLink(link: OtcOrderQuoteLink): Promise<void> {
    await this.client.query(
      `INSERT INTO otc_order_quote_links (quote_id, order_id, amount_prl, taker_user_id, taker_pearl_address, taker_usdc_address, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (quote_id) DO NOTHING`,
      [
        link.quoteId,
        link.orderId,
        link.amountPrl,
        link.takerUserId ?? null,
        link.takerPearlAddress ?? null,
        link.takerUsdcAddress ?? null,
        link.createdAt,
      ],
    );
  }

  async findOrderQuoteLinkByQuoteId(quoteId: string): Promise<OtcOrderQuoteLink | undefined> {
    const result = await this.client.query<OrderQuoteLinkRow>(
      `SELECT quote_id, order_id, amount_prl, taker_user_id, taker_pearl_address, taker_usdc_address, created_at
         FROM otc_order_quote_links
        WHERE quote_id = $1`,
      [quoteId],
    );
    return result.rows[0] ? rowToOrderQuoteLink(result.rows[0]) : undefined;
  }

  async savePointEvent(event: OtcPointEvent): Promise<{ event: OtcPointEvent; created: boolean }> {
    const result = await this.client.query<PointEventRow>(
      `INSERT INTO otc_points_ledger (
         point_event_id, user_id, source, points, related_user_id,
         trade_id, order_id, referral_code, metadata, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
       ON CONFLICT (point_event_id) DO NOTHING
       RETURNING point_event_id, user_id, source, points, related_user_id,
                 trade_id, order_id, referral_code, metadata, created_at`,
      [
        event.pointEventId,
        event.userId,
        event.source,
        event.points,
        event.relatedUserId ?? null,
        event.tradeId ?? null,
        event.orderId ?? null,
        event.referralCode ?? null,
        JSON.stringify(event.metadata),
        event.createdAt,
      ],
    );
    if ((result.rowCount ?? 0) > 0) {
      return { event: rowToPointEvent(result.rows[0]), created: true };
    }
    const existing = await this.client.query<PointEventRow>(
      `SELECT point_event_id, user_id, source, points, related_user_id,
              trade_id, order_id, referral_code, metadata, created_at
         FROM otc_points_ledger
        WHERE point_event_id = $1`,
      [event.pointEventId],
    );
    return { event: rowToPointEvent(existing.rows[0]), created: false };
  }

  async listPointEvents(userId: string): Promise<OtcPointEvent[]> {
    const result = await this.client.query<PointEventRow>(
      `SELECT point_event_id, user_id, source, points, related_user_id,
              trade_id, order_id, referral_code, metadata, created_at
         FROM otc_points_ledger
        WHERE user_id = $1
        ORDER BY created_at DESC, point_event_id ASC`,
      [userId],
    );
    return result.rows.map(rowToPointEvent);
  }

  async listTradesForUser(user: OtcUser): Promise<OtcTrade[]> {
    const addresses = user.wallets.map((wallet) => wallet.address);
    const result = await this.client.query<TradeRow>(
      `SELECT trade
         FROM otc_trades
        WHERE lower(trade->>'buyerUsdcAddress') = ANY($1::text[])
           OR lower(trade->>'sellerUsdcReceiveAddress') = ANY($1::text[])
           OR lower(trade->>'buyerPearlAddress') = ANY($1::text[])
           OR lower(trade->>'sellerPearlRefundAddress') = ANY($1::text[])
        ORDER BY updated_at DESC, trade_id ASC`,
      [addresses.map((address) => address.toLowerCase())],
    );
    return result.rows.map((row) => row.trade);
  }
}

const ORDER_SELECT_COLUMNS = `order_id, maker_user_id, side, funding_asset, maker_pearl_address,
       maker_usdc_address, maker_pearl_pubkey, maker_pearl_pubkey_proof,
       pearl_release_signing_mode, amount_prl,
       remaining_prl, price_usdc_per_prl, min_fill_prl, status,
       expires_at, created_at, updated_at,
       prefund_mode, prefund_state, prefund_escrow_address,
       prefund_funded_outpoint, prefund_funded_grains, prefund_remaining_grains,
       prefund_funded_at, prefund_refund_eligible_after_unixtime, prefund_refund_txid`;

const USER_SELECT_FIELDS = `
  SELECT u.user_id,
         rc.referral_code,
         u.created_at AS user_created_at,
         u.updated_at AS user_updated_at,
         w.wallet_type,
         w.network,
         w.address,
         w.public_key_hex,
         w.verified_at,
         w.created_at AS wallet_created_at,
         p.email,
         p.email_verified_at,
         p.notification_email_enabled,
         p.created_at AS profile_created_at,
         p.updated_at AS profile_updated_at,
         attr.referrer_user_id,
         attr.referral_code AS referred_by_code,
         attr.source_url,
         attr.attributed_at
    FROM otc_users u
    JOIN otc_user_wallets w ON w.user_id = u.user_id
    JOIN otc_user_profiles p ON p.user_id = u.user_id
    JOIN otc_referral_codes rc ON rc.owner_user_id = u.user_id
    LEFT JOIN otc_referral_attributions attr ON attr.referred_user_id = u.user_id`;

const USER_SELECT_BY_WALLET_SQL = `${USER_SELECT_FIELDS}
   WHERE w.wallet_type = $1 AND w.network = $2 AND w.address = $3
   ORDER BY w.created_at ASC
   LIMIT 1`;

const USER_SELECT_BY_ID_SQL = `${USER_SELECT_FIELDS}
   WHERE u.user_id = $1
   ORDER BY w.created_at ASC
   LIMIT 1`;

async function findUserByWalletWithClient(
  client: PgQueryClient,
  walletType: OtcUserWallet['walletType'],
  network: string,
  address: string,
): Promise<OtcUser | undefined> {
  const result = await client.query<UserRow>(USER_SELECT_BY_WALLET_SQL, [walletType, network, address]);
  return result.rows[0] ? hydrateUserWallets(client, rowToUser(result.rows[0])) : undefined;
}

async function findUserByIdWithClient(client: PgQueryClient, userId: string): Promise<OtcUser | undefined> {
  const result = await client.query<UserRow>(USER_SELECT_BY_ID_SQL, [userId]);
  return result.rows[0] ? hydrateUserWallets(client, rowToUser(result.rows[0])) : undefined;
}

async function hydrateUserWallets(client: PgQueryClient, user: OtcUser): Promise<OtcUser> {
  const result = await client.query<UserWalletRow>(
    `SELECT user_id, wallet_type, network, address, public_key_hex, verified_at, created_at
       FROM otc_user_wallets
      WHERE user_id = $1
      ORDER BY created_at ASC, wallet_type ASC, network ASC, address ASC`,
    [user.userId],
  );
  const wallets = result.rows.map(rowToUserWallet);
  const selectedWallet = wallets.find((wallet) =>
    walletMatches(wallet, user.wallet.walletType, user.wallet.network, user.wallet.address),
  ) ?? wallets[0] ?? user.wallet;
  return { ...user, wallet: selectedWallet, wallets: wallets.length > 0 ? wallets : [user.wallet] };
}

async function findTradeIdempotencyByClientRequestIdWithClient(
  client: PgQueryClient,
  clientRequestId: string,
): Promise<TradeIdempotencyRecord | undefined> {
  const result = await client.query<TradeRow>('SELECT trade, request_hash FROM otc_trades WHERE client_request_id = $1', [
    clientRequestId,
  ]);
  const row = result.rows[0];
  if (!row) return undefined;
  return { trade: row.trade, ...(row.request_hash ? { requestHash: row.request_hash } : {}) };
}

async function findTradeByQuoteIdWithClient(client: PgQueryClient, quoteId: string): Promise<OtcTrade | undefined> {
  const result = await client.query<TradeRow>('SELECT trade FROM otc_trades WHERE quote_id = $1', [quoteId]);
  return result.rows[0]?.trade;
}

function rowToSideEffect(row: SideEffectRow): OtcSideEffect {
  return {
    idempotencyKey: row.idempotency_key,
    ...(row.request_hash ? { requestHash: row.request_hash } : {}),
    tradeId: row.trade_id,
    effectType: row.effect_type as OtcSideEffect['effectType'],
    status: row.status as OtcSideEffect['status'],
    actor: row.actor,
    ...(row.source_event_id ? { sourceEventId: row.source_event_id } : {}),
    ...(row.tx_hash ? { txHash: row.tx_hash } : {}),
    ...(row.outpoint ? { outpoint: row.outpoint } : {}),
    ...(row.block_number == null ? {} : { blockNumber: Number(row.block_number) }),
    ...(row.block_hash ? { blockHash: row.block_hash } : {}),
    ...(row.chain_id == null ? {} : { chainId: Number(row.chain_id) }),
    metadata: row.metadata ?? {},
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function rowToWalletChallenge(row: WalletChallengeRow): OtcUserWalletChallenge {
  return {
    challengeId: row.challenge_id,
    walletType: row.wallet_type as OtcUserWalletChallenge['walletType'],
    network: row.network,
    address: row.address,
    message: row.message,
    nonce: row.nonce,
    expiresAt: formatPgDate(row.expires_at),
    ...(row.consumed_at ? { consumedAt: formatPgDate(row.consumed_at) } : {}),
    createdAt: formatPgDate(row.created_at),
  };
}

function rowToUser(row: UserRow): OtcUser {
  const wallet = rowToUserWallet(row);
  return {
    userId: row.user_id,
    referralCode: row.referral_code,
    wallet,
    wallets: [wallet],
    profile: {
      userId: row.user_id,
      ...(row.email ? { email: row.email } : {}),
      ...(row.email_verified_at ? { emailVerifiedAt: formatPgDate(row.email_verified_at) } : {}),
      notificationEmailEnabled: row.notification_email_enabled,
      createdAt: formatPgDate(row.profile_created_at),
      updatedAt: formatPgDate(row.profile_updated_at),
    },
    ...(row.referrer_user_id && row.referred_by_code && row.attributed_at
      ? {
          referredBy: {
            referredUserId: row.user_id,
            referrerUserId: row.referrer_user_id,
            referralCode: row.referred_by_code,
            ...(row.source_url ? { sourceUrl: row.source_url } : {}),
            attributedAt: formatPgDate(row.attributed_at),
          },
        }
      : {}),
    createdAt: formatPgDate(row.user_created_at),
    updatedAt: formatPgDate(row.user_updated_at),
  };
}

function rowToUserWallet(row: UserWalletRow): OtcUserWallet {
  const createdAt = row.wallet_created_at ?? row.created_at ?? row.verified_at;
  return {
    userId: row.user_id,
    walletType: row.wallet_type as OtcUserWallet['walletType'],
    network: row.network,
    address: row.address,
    ...(row.public_key_hex ? { publicKeyHex: row.public_key_hex } : {}),
    verifiedAt: formatPgDate(row.verified_at),
    createdAt: formatPgDate(createdAt),
  };
}

function rowToReferralCode(row: ReferralCodeRow): ReferralCodeLookup {
  return {
    referralCode: row.referral_code,
    ownerUserId: row.owner_user_id,
    status: row.status,
    createdAt: formatPgDate(row.created_at),
  };
}

function rowToUserProfile(row: Pick<UserRow, 'user_id' | 'email' | 'email_verified_at' | 'notification_email_enabled' | 'profile_created_at' | 'profile_updated_at'>): OtcUserProfile {
  return {
    userId: row.user_id,
    ...(row.email ? { email: row.email } : {}),
    ...(row.email_verified_at ? { emailVerifiedAt: formatPgDate(row.email_verified_at) } : {}),
    notificationEmailEnabled: row.notification_email_enabled,
    createdAt: formatPgDate(row.profile_created_at),
    updatedAt: formatPgDate(row.profile_updated_at),
  };
}

function rowToEmailVerificationToken(row: EmailVerificationTokenRow): OtcEmailVerificationToken {
  return {
    tokenId: row.token_id,
    userId: row.user_id,
    email: row.email,
    tokenHash: row.token_hash,
    expiresAt: formatPgDate(row.expires_at),
    ...(row.consumed_at ? { consumedAt: formatPgDate(row.consumed_at) } : {}),
    createdAt: formatPgDate(row.created_at),
  };
}

function rowToNotificationPreference(row: NotificationPreferenceRow): OtcNotificationPreference {
  return {
    userId: row.user_id,
    notificationType: row.notification_type,
    channel: row.channel,
    enabled: row.enabled,
    createdAt: formatPgDate(row.created_at),
    updatedAt: formatPgDate(row.updated_at),
  };
}

function rowToNotificationDelivery(row: NotificationDeliveryRow): OtcNotificationDelivery {
  return {
    deliveryId: row.delivery_id,
    ...(row.user_id ? { userId: row.user_id } : {}),
    notificationType: row.notification_type,
    channel: row.channel,
    recipient: row.recipient,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    payload: parseJsonRecord(row.payload),
    ...(row.unsubscribe_token_hash ? { unsubscribeTokenHash: row.unsubscribe_token_hash } : {}),
    attempts: Number(row.attempts),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    nextAttemptAt: formatPgDate(row.next_attempt_at),
    ...(row.sent_at ? { sentAt: formatPgDate(row.sent_at) } : {}),
    createdAt: formatPgDate(row.created_at),
    updatedAt: formatPgDate(row.updated_at),
  };
}

function rowToOrder(row: OrderRow): OtcOrder {
  return {
    orderId: row.order_id,
    makerUserId: row.maker_user_id,
    side: row.side,
    fundingAsset: row.funding_asset,
    makerPearlAddress: row.maker_pearl_address ?? '',
    makerUsdcAddress: row.maker_usdc_address ?? '',
    makerPearlPubkey: row.maker_pearl_pubkey ?? '',
    makerPearlPubkeyProof: row.maker_pearl_pubkey_proof ?? '',
    pearlReleaseSigningMode: row.pearl_release_signing_mode ?? 'manual_after_base_deposit',
    amountPrl: String(row.amount_prl),
    remainingPrl: String(row.remaining_prl),
    priceUsdcPerPrl: String(row.price_usdc_per_prl),
    ...(row.min_fill_prl == null ? {} : { minFillPrl: String(row.min_fill_prl) }),
    status: row.status,
    ...(row.expires_at ? { expiresAt: formatPgDate(row.expires_at) } : {}),
    createdAt: formatPgDate(row.created_at),
    updatedAt: formatPgDate(row.updated_at),
    ...(row.prefund_mode ? { prefundMode: row.prefund_mode } : {}),
    ...(row.prefund_state ? { prefundState: row.prefund_state } : {}),
    ...(row.prefund_escrow_address ? { prefundEscrowAddress: row.prefund_escrow_address } : {}),
    ...(row.prefund_funded_outpoint ? { prefundFundedOutpoint: row.prefund_funded_outpoint } : {}),
    ...(row.prefund_funded_grains == null ? {} : { prefundFundedGrains: String(row.prefund_funded_grains) }),
    ...(row.prefund_remaining_grains == null ? {} : { prefundRemainingGrains: String(row.prefund_remaining_grains) }),
    ...(row.prefund_funded_at ? { prefundFundedAt: formatPgDate(row.prefund_funded_at) } : {}),
    ...(row.prefund_refund_eligible_after_unixtime == null
      ? {}
      : { prefundRefundEligibleAfterUnixTime: Number(row.prefund_refund_eligible_after_unixtime) }),
    ...(row.prefund_refund_txid ? { prefundRefundTxid: row.prefund_refund_txid } : {}),
  };
}

function parseJsonRecord(value: Record<string, unknown> | string): Record<string, unknown> {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function rowToOrderQuoteLink(row: OrderQuoteLinkRow): OtcOrderQuoteLink {
  return {
    quoteId: row.quote_id,
    orderId: row.order_id,
    amountPrl: String(row.amount_prl),
    ...(row.taker_user_id ? { takerUserId: row.taker_user_id } : {}),
    ...(row.taker_pearl_address ? { takerPearlAddress: row.taker_pearl_address } : {}),
    ...(row.taker_usdc_address ? { takerUsdcAddress: row.taker_usdc_address } : {}),
    createdAt: formatPgDate(row.created_at),
  };
}

function rowToPointEvent(row: PointEventRow): OtcPointEvent {
  return {
    pointEventId: row.point_event_id,
    userId: row.user_id,
    source: row.source,
    points: Number(row.points),
    ...(row.related_user_id ? { relatedUserId: row.related_user_id } : {}),
    ...(row.trade_id ? { tradeId: row.trade_id } : {}),
    ...(row.order_id ? { orderId: row.order_id } : {}),
    ...(row.referral_code ? { referralCode: row.referral_code } : {}),
    metadata: row.metadata ?? {},
    createdAt: formatPgDate(row.created_at),
  };
}

function rowToPearlEscrowAllocation(row: PearlEscrowAllocationRow): PearlEscrowAllocation {
  return {
    tradeId: row.trade_id,
    allocatorKey: row.allocator_key,
    derivationPrefix: row.derivation_prefix,
    derivationIndex: Number(row.derivation_index),
    derivationPath: row.derivation_path,
    escrowAddress: row.escrow_address,
    internalPubkeyHex: row.internal_pubkey_hex,
    taprootOutputScriptHex: row.taproot_output_script_hex,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

function rowToOrderSweep(row: OrderSweepRow): OtcOrderSweep {
  return {
    sweepId: row.sweep_id,
    orderId: row.order_id,
    tradeId: row.trade_id,
    inputOutpoint: row.input_outpoint,
    sweptGrains: String(row.swept_grains),
    ...(row.change_outpoint ? { changeOutpoint: row.change_outpoint } : {}),
    ...(row.change_grains == null ? {} : { changeGrains: String(row.change_grains) }),
    ...(row.sweep_psbt_base64 ? { sweepPsbtBase64: row.sweep_psbt_base64 } : {}),
    ...(row.sweep_txid ? { sweepTxid: row.sweep_txid } : {}),
    status: row.status,
    ...(row.failure_reason ? { failureReason: row.failure_reason } : {}),
    createdAt: formatPgDate(row.created_at),
    updatedAt: formatPgDate(row.updated_at),
  };
}

function rowToOrderPrefundAllocation(row: OrderPrefundAllocationRow): OrderPrefundAllocation {
  return {
    orderId: row.order_id,
    allocatorKey: row.allocator_key,
    derivationPrefix: row.derivation_prefix,
    derivationIndex: Number(row.derivation_index),
    derivationPath: row.derivation_path,
    escrowAddress: row.escrow_address,
    internalPubkeyHex: row.internal_pubkey_hex,
    taprootOutputScriptHex: row.taproot_output_script_hex,
    scriptLeaves: typeof row.script_leaves === 'string'
      ? JSON.parse(row.script_leaves)
      : row.script_leaves,
    signerPubkeys: typeof row.signer_pubkeys === 'string'
      ? JSON.parse(row.signer_pubkeys)
      : row.signer_pubkeys,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

function formatOrderPrefundDerivationKey(allocation: Pick<OrderPrefundAllocationInput, 'allocatorKey' | 'derivationPrefix' | 'derivationIndex'>): string {
  return `${allocation.allocatorKey}|${allocation.derivationPrefix}|${allocation.derivationIndex}`;
}

function formatPearlEscrowDerivationKey(allocation: Pick<PearlEscrowAllocationInput, 'allocatorKey' | 'derivationPrefix' | 'derivationIndex'>): string {
  return `${allocation.allocatorKey}:${allocation.derivationPrefix}:${allocation.derivationIndex}`;
}

function formatWalletKey(walletType: OtcUserWallet['walletType'], network: string, address: string): string {
  return `${walletType}:${network.toLowerCase()}:${address.toLowerCase()}`;
}

function walletMatches(
  wallet: Pick<OtcUserWallet, 'walletType' | 'network' | 'address'>,
  walletType: OtcUserWallet['walletType'],
  network: string,
  address: string,
): boolean {
  return formatWalletKey(wallet.walletType, wallet.network, wallet.address) === formatWalletKey(walletType, network, address);
}

function formatNotificationPreferenceKey(userId: string, notificationType: string, channel: string): string {
  return `${userId}:${notificationType}:${channel}`;
}

function formatPgDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(100, Math.floor(limit ?? 25)));
}

function parseCursor(cursor: string | undefined): number {
  const parsed = Number(cursor ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function orderMatchesQuery(order: OtcOrder, query: OrderBookQuery): boolean {
  if (query.side && order.side !== query.side) return false;
  if (query.status && order.status !== query.status) return false;
  if (query.makerUserId && order.makerUserId !== query.makerUserId) return false;
  if (query.minPrl && Number(order.remainingPrl) < Number(query.minPrl)) return false;
  if (query.maxPrl && Number(order.remainingPrl) > Number(query.maxPrl)) return false;
  if (query.minPrice && Number(order.priceUsdcPerPrl) < Number(query.minPrice)) return false;
  if (query.maxPrice && Number(order.priceUsdcPerPrl) > Number(query.maxPrice)) return false;
  return true;
}

function compareOrders(left: OtcOrder, right: OtcOrder, sort: OrderBookQuery['sort'] = 'best_price'): number {
  if (sort === 'newest') return right.createdAt.localeCompare(left.createdAt);
  if (sort === 'largest') return Number(right.remainingPrl) - Number(left.remainingPrl);
  if (left.side === 'buy_prl') {
    return Number(right.priceUsdcPerPrl) - Number(left.priceUsdcPerPrl) || right.createdAt.localeCompare(left.createdAt);
  }
  return Number(left.priceUsdcPerPrl) - Number(right.priceUsdcPerPrl) || right.createdAt.localeCompare(left.createdAt);
}

function addOrderFilter(where: string[], params: unknown[], column: string, value: unknown): void {
  if (value == null || value === '') return;
  params.push(value);
  where.push(`${column} = $${params.length}`);
}

function addOrderRangeFilter(where: string[], params: unknown[], column: string, operator: string, value: unknown): void {
  if (value == null || value === '') return;
  params.push(value);
  where.push(`${column} ${operator} $${params.length}`);
}

function getOrderBookSortSql(sort: OrderBookQuery['sort'], side?: OtcOrder['side']): string {
  if (sort === 'newest') return 'created_at DESC, order_id ASC';
  if (sort === 'largest') return 'remaining_prl DESC, created_at DESC, order_id ASC';
  return side === 'buy_prl'
    ? 'price_usdc_per_prl DESC, remaining_prl DESC, created_at DESC, order_id ASC'
    : 'price_usdc_per_prl ASC, remaining_prl DESC, created_at DESC, order_id ASC';
}

function parseDecimalUnits(value: string, decimals: number): bigint {
  const [whole, fraction = ''] = value.split('.');
  if (!whole || !/^\d+$/.test(whole) || !/^\d*$/.test(fraction) || fraction.length > decimals) {
    throw new Error(`invalid decimal amount: ${value}`);
  }
  return BigInt(whole) * (10n ** BigInt(decimals)) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals));
}

function formatDecimalUnits(value: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, '0');
  return `${whole}.${fraction}`;
}

function isPgUniqueViolation(error: unknown, constraint: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; constraint?: unknown; message?: unknown };
  return (
    candidate.code === '23505' &&
    (candidate.constraint === constraint || (typeof candidate.message === 'string' && candidate.message.includes(constraint)))
  );
}

function assertIdempotencyHashMatch(kind: string, key: string, existingHash?: string, requestHash?: string): void {
  if (existingHash && requestHash && existingHash !== requestHash) {
    throw new Error(`${kind} idempotency key reuse with different payload: ${key}`);
  }
}
