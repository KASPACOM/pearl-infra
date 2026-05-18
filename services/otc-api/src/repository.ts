import type { OtcQuote, OtcTrade, TradeEvent } from '@kaspacom/pearl-sdk';

import type { PgTransactionalClient } from './postgres.js';
import type { OtcSideEffect } from './types.js';

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
