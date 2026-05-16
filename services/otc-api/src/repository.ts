import type { OtcQuote, OtcTrade, TradeEvent } from '@kaspacom/pearl-sdk';

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
}

export class InMemoryOtcRepository implements OtcRepository {
  private readonly quotes = new Map<string, OtcQuote>();
  private readonly quoteClientRequests = new Map<string, string>();
  private readonly trades = new Map<string, OtcTrade>();
  private readonly tradeClientRequests = new Map<string, string>();
  private readonly tradeByQuote = new Map<string, string>();
  private readonly events = new Map<string, TradeEvent[]>();

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
}
