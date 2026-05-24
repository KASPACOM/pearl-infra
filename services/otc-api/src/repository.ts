import type { OtcQuote, OtcTrade, TradeEvent } from '@kaspacom/pearl-sdk';

import type { PgQueryClient, PgTransactionalClient } from './postgres.js';
import type {
  OtcReferralAttribution,
  OtcOrder,
  OtcPointEvent,
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
  findSideEffectByIdempotencyKey(idempotencyKey: string): Promise<OtcSideEffect | undefined>;
  listSideEffects(tradeId: string): Promise<OtcSideEffect[]>;
  saveWalletChallenge(challenge: OtcUserWalletChallenge): Promise<void>;
  findWalletChallenge(challengeId: string): Promise<OtcUserWalletChallenge | undefined>;
  consumeWalletChallenge(challengeId: string, consumedAt: string): Promise<boolean>;
  findUserByWallet(walletType: OtcUserWallet['walletType'], network: string, address: string): Promise<OtcUser | undefined>;
  findUserById(userId: string): Promise<OtcUser | undefined>;
  saveUser(input: SaveUserInput): Promise<OtcUser>;
  updateUserProfile(userId: string, profile: UpdateUserProfileInput): Promise<OtcUserProfile>;
  findReferralCode(referralCode: string): Promise<ReferralCodeLookup | undefined>;
  countUsers(): Promise<number>;
  saveOrder(order: OtcOrder): Promise<OtcOrder>;
  listOrders(query?: OrderBookQuery): Promise<OrderBookPage>;
  listOpenOrdersForStats(): Promise<OtcOrder[]>;
  listOrdersByUser(userId: string): Promise<OtcOrder[]>;
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
  private readonly events = new Map<string, TradeEvent[]>();
  private readonly sideEffects = new Map<string, OtcSideEffect>();
  private readonly walletChallenges = new Map<string, OtcUserWalletChallenge>();
  private readonly users = new Map<string, OtcUser>();
  private readonly userByWallet = new Map<string, string>();
  private readonly referralByCode = new Map<string, ReferralCodeLookup>();
  private readonly orders = new Map<string, OtcOrder>();
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
    return userId ? this.users.get(userId) : undefined;
  }

  async findUserById(userId: string): Promise<OtcUser | undefined> {
    return this.users.get(userId);
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

  async updateUserProfile(userId: string, profile: UpdateUserProfileInput): Promise<OtcUserProfile> {
    const user = this.users.get(userId);
    if (!user) throw new Error(`user not found: ${userId}`);
    const updatedProfile: OtcUserProfile = {
      ...user.profile,
      ...(profile.email === undefined ? {} : { email: profile.email }),
      ...(profile.notificationEmailEnabled === undefined
        ? {}
        : { notificationEmailEnabled: profile.notificationEmailEnabled }),
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

  async saveOrder(order: OtcOrder): Promise<OtcOrder> {
    this.orders.set(order.orderId, order);
    return order;
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
    return Array.from(this.orders.values()).filter((order) => order.status === 'open');
  }

  async listOrdersByUser(userId: string): Promise<OtcOrder[]> {
    return Array.from(this.orders.values())
      .filter((order) => order.makerUserId === userId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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
    const address = user.wallet.address.toLowerCase();
    return Array.from(this.trades.values())
      .filter(
        (trade) =>
          trade.buyerUsdcAddress.toLowerCase() === address ||
          trade.sellerUsdcReceiveAddress.toLowerCase() === address ||
          trade.buyerPearlAddress.toLowerCase() === address ||
          trade.sellerPearlRefundAddress.toLowerCase() === address,
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

type ReferralCodeRow = Record<string, unknown> & {
  referral_code: string;
  owner_user_id: string;
  status: 'active' | 'disabled';
  created_at: Date | string;
}

type OrderRow = Record<string, unknown> & {
  order_id: string;
  maker_user_id: string;
  side: OtcOrder['side'];
  funding_asset: OtcOrder['fundingAsset'];
  amount_prl: string | number;
  remaining_prl: string | number;
  price_usdc_per_prl: string | number;
  min_fill_prl: string | number | null;
  status: OtcOrder['status'];
  expires_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  total_count?: string | number;
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
       ON CONFLICT (client_request_id) DO NOTHING`,
      [trade.tradeId, trade.quoteId, clientRequestId, requestHash ?? null, trade.state, JSON.stringify(trade)],
    );
    if ((result.rowCount ?? 0) === 0) {
      const existing = await this.findTradeIdempotencyByClientRequestId(clientRequestId);
      if (!existing) throw new Error(`trade insert failed: ${clientRequestId}`);
      assertIdempotencyHashMatch('trade', clientRequestId, existing.requestHash, requestHash);
    }
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
    const result = await this.client.query<UserRow>(USER_SELECT_BY_WALLET_SQL, [walletType, network, address]);
    return result.rows[0] ? rowToUser(result.rows[0]) : undefined;
  }

  async findUserById(userId: string): Promise<OtcUser | undefined> {
    const result = await this.client.query<UserRow>(USER_SELECT_BY_ID_SQL, [userId]);
    return result.rows[0] ? rowToUser(result.rows[0]) : undefined;
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

  async updateUserProfile(userId: string, profile: UpdateUserProfileInput): Promise<OtcUserProfile> {
    const result = await this.client.query<UserRow>(
      `UPDATE otc_user_profiles
          SET email = COALESCE($2, email),
              notification_email_enabled = COALESCE($3, notification_email_enabled),
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

  async saveOrder(order: OtcOrder): Promise<OtcOrder> {
    const result = await this.client.query<OrderRow>(
      `INSERT INTO otc_orders (
         order_id, maker_user_id, side, funding_asset, amount_prl, remaining_prl,
         price_usdc_per_prl, min_fill_prl, status, expires_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (order_id) DO UPDATE
          SET remaining_prl = EXCLUDED.remaining_prl,
              status = EXCLUDED.status,
              updated_at = EXCLUDED.updated_at
       RETURNING order_id, maker_user_id, side, funding_asset, amount_prl,
                 remaining_prl, price_usdc_per_prl, min_fill_prl, status,
                 expires_at, created_at, updated_at`,
      [
        order.orderId,
        order.makerUserId,
        order.side,
        order.fundingAsset,
        order.amountPrl,
        order.remainingPrl,
        order.priceUsdcPerPrl,
        order.minFillPrl ?? null,
        order.status,
        order.expiresAt ?? null,
        order.createdAt,
        order.updatedAt,
      ],
    );
    return rowToOrder(result.rows[0]);
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
      `SELECT order_id, maker_user_id, side, funding_asset, amount_prl,
              remaining_prl, price_usdc_per_prl, min_fill_prl, status,
              expires_at, created_at, updated_at,
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
      `SELECT order_id, maker_user_id, side, funding_asset, amount_prl,
              remaining_prl, price_usdc_per_prl, min_fill_prl, status,
              expires_at, created_at, updated_at
         FROM otc_orders
        WHERE status = $1`,
      ['open'],
    );
    return result.rows.map(rowToOrder);
  }

  async listOrdersByUser(userId: string): Promise<OtcOrder[]> {
    const result = await this.client.query<OrderRow>(
      `SELECT order_id, maker_user_id, side, funding_asset, amount_prl,
              remaining_prl, price_usdc_per_prl, min_fill_prl, status,
              expires_at, created_at, updated_at
         FROM otc_orders
        WHERE maker_user_id = $1
        ORDER BY updated_at DESC, order_id ASC`,
      [userId],
    );
    return result.rows.map(rowToOrder);
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
    const result = await this.client.query<TradeRow>(
      `SELECT trade
         FROM otc_trades
        WHERE lower(trade->>'buyerUsdcAddress') = lower($1)
           OR lower(trade->>'sellerUsdcReceiveAddress') = lower($1)
           OR lower(trade->>'buyerPearlAddress') = lower($1)
           OR lower(trade->>'sellerPearlRefundAddress') = lower($1)
        ORDER BY updated_at DESC, trade_id ASC`,
      [user.wallet.address],
    );
    return result.rows.map((row) => row.trade);
  }
}

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
  return result.rows[0] ? rowToUser(result.rows[0]) : undefined;
}

async function findUserByIdWithClient(client: PgQueryClient, userId: string): Promise<OtcUser | undefined> {
  const result = await client.query<UserRow>(USER_SELECT_BY_ID_SQL, [userId]);
  return result.rows[0] ? rowToUser(result.rows[0]) : undefined;
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
  return {
    userId: row.user_id,
    referralCode: row.referral_code,
    wallet: {
      userId: row.user_id,
      walletType: row.wallet_type as OtcUserWallet['walletType'],
      network: row.network,
      address: row.address,
      ...(row.public_key_hex ? { publicKeyHex: row.public_key_hex } : {}),
      verifiedAt: formatPgDate(row.verified_at),
      createdAt: formatPgDate(row.wallet_created_at),
    },
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

function rowToReferralCode(row: ReferralCodeRow): ReferralCodeLookup {
  return {
    referralCode: row.referral_code,
    ownerUserId: row.owner_user_id,
    status: row.status,
    createdAt: formatPgDate(row.created_at),
  };
}

function rowToOrder(row: OrderRow): OtcOrder {
  return {
    orderId: row.order_id,
    makerUserId: row.maker_user_id,
    side: row.side,
    fundingAsset: row.funding_asset,
    amountPrl: String(row.amount_prl),
    remainingPrl: String(row.remaining_prl),
    priceUsdcPerPrl: String(row.price_usdc_per_prl),
    ...(row.min_fill_prl == null ? {} : { minFillPrl: String(row.min_fill_prl) }),
    status: row.status,
    ...(row.expires_at ? { expiresAt: formatPgDate(row.expires_at) } : {}),
    createdAt: formatPgDate(row.created_at),
    updatedAt: formatPgDate(row.updated_at),
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

function formatPearlEscrowDerivationKey(allocation: Pick<PearlEscrowAllocationInput, 'allocatorKey' | 'derivationPrefix' | 'derivationIndex'>): string {
  return `${allocation.allocatorKey}:${allocation.derivationPrefix}:${allocation.derivationIndex}`;
}

function formatWalletKey(walletType: OtcUserWallet['walletType'], network: string, address: string): string {
  return `${walletType}:${network.toLowerCase()}:${address.toLowerCase()}`;
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
