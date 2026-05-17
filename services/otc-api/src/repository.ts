import type { OtcQuote, OtcTrade, TradeEvent } from '@kaspacom/pearl-sdk';

import type { PgTransactionalClient } from './postgres.js';
import type { OtcSideEffect } from './types.js';

export interface OtcRepository {
  saveQuote(quote: OtcQuote, clientRequestId: string): Promise<void>;
  findQuoteById(quoteId: string): Promise<OtcQuote | undefined>;
  findQuoteByClientRequestId(clientRequestId: string): Promise<OtcQuote | undefined>;
  saveTrade(trade: OtcTrade, clientRequestId: string): Promise<void>;
  findTradeById(tradeId: string): Promise<OtcTrade | undefined>;
  findTradeByQuoteId(quoteId: string): Promise<OtcTrade | undefined>;
  findTradeByClientRequestId(clientRequestId: string): Promise<OtcTrade | undefined>;
  updateTrade(trade: OtcTrade): Promise<void>;
  appendEvent(event: TradeEvent): Promise<void>;
  listEvents(tradeId: string): Promise<TradeEvent[]>;
  saveSideEffect(sideEffect: OtcSideEffect): Promise<{ sideEffect: OtcSideEffect; created: boolean }>;
  findSideEffectByIdempotencyKey(idempotencyKey: string): Promise<OtcSideEffect | undefined>;
  listSideEffects(tradeId: string): Promise<OtcSideEffect[]>;
}

export class InMemoryOtcRepository implements OtcRepository {
  private readonly quotes = new Map<string, OtcQuote>();
  private readonly quoteClientRequests = new Map<string, string>();
  private readonly trades = new Map<string, OtcTrade>();
  private readonly tradeClientRequests = new Map<string, string>();
  private readonly tradeByQuote = new Map<string, string>();
  private readonly events = new Map<string, TradeEvent[]>();
  private readonly sideEffects = new Map<string, OtcSideEffect>();

  async saveQuote(quote: OtcQuote, clientRequestId: string): Promise<void> {
    this.quotes.set(quote.quoteId, quote);
    this.quoteClientRequests.set(clientRequestId, quote.quoteId);
  }

  async findQuoteById(quoteId: string): Promise<OtcQuote | undefined> {
    return this.quotes.get(quoteId);
  }

  async findQuoteByClientRequestId(clientRequestId: string): Promise<OtcQuote | undefined> {
    const quoteId = this.quoteClientRequests.get(clientRequestId);
    return quoteId ? this.quotes.get(quoteId) : undefined;
  }

  async saveTrade(trade: OtcTrade, clientRequestId: string): Promise<void> {
    this.trades.set(trade.tradeId, trade);
    this.tradeClientRequests.set(clientRequestId, trade.tradeId);
    this.tradeByQuote.set(trade.quoteId, trade.tradeId);
  }

  async findTradeById(tradeId: string): Promise<OtcTrade | undefined> {
    return this.trades.get(tradeId);
  }

  async findTradeByQuoteId(quoteId: string): Promise<OtcTrade | undefined> {
    const tradeId = this.tradeByQuote.get(quoteId);
    return tradeId ? this.trades.get(tradeId) : undefined;
  }

  async findTradeByClientRequestId(clientRequestId: string): Promise<OtcTrade | undefined> {
    const tradeId = this.tradeClientRequests.get(clientRequestId);
    return tradeId ? this.trades.get(tradeId) : undefined;
  }

  async updateTrade(trade: OtcTrade): Promise<void> {
    this.trades.set(trade.tradeId, trade);
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
}

type TradeRow = Record<string, unknown> & {
  trade: OtcTrade;
}

type EventRow = Record<string, unknown> & {
  event: TradeEvent;
}

type SideEffectRow = Record<string, unknown> & {
  idempotency_key: string;
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

export class PgOtcRepository implements OtcRepository {
  private readonly client: PgTransactionalClient;

  constructor(client: PgTransactionalClient) {
    this.client = client;
  }

  async saveQuote(quote: OtcQuote, clientRequestId: string): Promise<void> {
    await this.client.query(
      `INSERT INTO otc_quotes (quote_id, client_request_id, quote)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (client_request_id) DO NOTHING`,
      [quote.quoteId, clientRequestId, JSON.stringify(quote)],
    );
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

  async saveTrade(trade: OtcTrade, clientRequestId: string): Promise<void> {
    await this.client.query(
      `INSERT INTO otc_trades (trade_id, quote_id, client_request_id, state, trade)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (client_request_id) DO NOTHING`,
      [trade.tradeId, trade.quoteId, clientRequestId, trade.state, JSON.stringify(trade)],
    );
  }

  async findTradeById(tradeId: string): Promise<OtcTrade | undefined> {
    const result = await this.client.query<TradeRow>('SELECT trade FROM otc_trades WHERE trade_id = $1', [tradeId]);
    return result.rows[0]?.trade;
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

  async updateTrade(trade: OtcTrade): Promise<void> {
    await this.client.query(
      `UPDATE otc_trades
          SET state = $2, trade = $3::jsonb, updated_at = now()
        WHERE trade_id = $1`,
      [trade.tradeId, trade.state, JSON.stringify(trade)],
    );
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
         idempotency_key, trade_id, effect_type, status, actor, source_event_id,
         tx_hash, outpoint, block_number, block_hash, chain_id, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING idempotency_key, trade_id, effect_type, status, actor, source_event_id,
                 tx_hash, outpoint, block_number, block_hash, chain_id, metadata,
                 created_at, updated_at`,
      [
        sideEffect.idempotencyKey,
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
    return { sideEffect: existing, created: false };
  }

  async findSideEffectByIdempotencyKey(idempotencyKey: string): Promise<OtcSideEffect | undefined> {
    const result = await this.client.query<SideEffectRow>(
      `SELECT idempotency_key, trade_id, effect_type, status, actor, source_event_id,
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
      `SELECT idempotency_key, trade_id, effect_type, status, actor, source_event_id,
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
