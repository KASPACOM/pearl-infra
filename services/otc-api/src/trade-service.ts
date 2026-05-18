import { createHash } from 'node:crypto';

import {
  assertTradeTransition,
  formatGrainsToPrl,
  formatMicrosToUsdc,
  type OtcQuote,
  type OtcTrade,
  type OtcTradeDeadlines,
  parsePrlToGrains,
  parseUsdcToMicros,
  type TradeEvent,
  type TradeState,
  tradeStateIsTerminal,
} from '@kaspacom/pearl-sdk';
import { getUsdcEscrowNetworkConfig } from '@kaspacom/usdc-escrow-client';

import type { OtcRepository } from './repository.js';
import type {
  AcceptQuoteRequest,
  CreateQuoteRequest,
  OtcApiConfig,
  OtcSideEffect,
  PrepareUsdcCreateTradeRequest,
  PublicTradeProof,
  RecordSideEffectRequest,
  UsdcCreateTradeIntent,
  UsdcEscrowVerification,
} from './types.js';
import type { UsdcEscrowReader } from './usdc-escrow-reader.js';

export interface PearlEscrowAllocator {
  allocateEscrow(input: {
    tradeId: string;
    quote: OtcQuote;
    request: AcceptQuoteRequest;
    config: OtcApiConfig;
    deadlines: OtcTradeDeadlines;
  }): Promise<OtcTrade['pearlEscrow']>;
}

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
  private readonly now: () => Date;

  constructor(
    repository: OtcRepository,
    config: OtcApiConfig,
    pearlEscrowAllocator: PearlEscrowAllocator = new MockPearlEscrowAllocator(),
    usdcEscrowReaderOrNow?: UsdcEscrowReader | (() => Date),
    now: () => Date = () => new Date(),
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
  }

  async createQuote(request: CreateQuoteRequest): Promise<OtcQuote> {
    const requestHash = createPayloadHash('create_quote', request);
    const existing = await this.repository.findQuoteIdempotencyByClientRequestId(request.clientRequestId);
    if (existing) {
      assertRequestHashMatches('quote', request.clientRequestId, existing.requestHash, requestHash);
      return existing.quote;
    }

    if (request.settlementAsset !== 'USDC' || request.settlementNetwork !== 'base') {
      throw new Error('unsupported settlement route');
    }

    const amounts = calculateQuoteAmounts(request.amountPrl, this.config.priceUsdcPerPrl, this.config.feeBps);
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

  async acceptQuote(quoteId: string, request: AcceptQuoteRequest): Promise<OtcTrade> {
    const requestHash = createPayloadHash('accept_quote', { quoteId, ...request });
    const existing = await this.repository.findTradeIdempotencyByClientRequestId(request.clientRequestId);
    if (existing) {
      assertRequestHashMatches('trade', request.clientRequestId, existing.requestHash, requestHash);
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

    await this.repository.saveTrade(trade, request.clientRequestId, requestHash);
    await this.repository.appendEvent({
      tradeId,
      fromState: 'quoted',
      toState: 'pearl_escrow_pending',
      source: 'system',
      sourceEventId: createStableId('event', [tradeId, 'accept']),
      observedAt: timestamp,
    });

    return trade;
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
    return createPublicProof(trade, events, this.now());
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

  private async saveSideEffect(tradeId: string, request: RecordSideEffectRequest): Promise<OtcSideEffect> {
    const timestamp = this.now().toISOString();
    const { sideEffect } = await this.repository.saveSideEffect({
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
    return sideEffect;
  }
}

export function createPublicProof(trade: OtcTrade, events: TradeEvent[], observedAt: Date): PublicTradeProof {
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
      escrowOutpoint: trade.pearlEscrow.fundingOutpoint,
      escrowConfirmations: 0,
      releaseTxid: trade.pearlEscrow.releaseTxid,
      refundTxid: trade.pearlEscrow.refundTxid,
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
    events,
    observedAt: observedAt.toISOString(),
  };
}

function calculateImpliedPrice(trade: OtcTrade): string {
  const prl = Number(trade.amountPrl);
  const usdc = Number(trade.amountUsdc);
  if (!Number.isFinite(prl) || prl === 0 || !Number.isFinite(usdc)) {
    return '0.000000';
  }
  return (usdc / prl).toFixed(6);
}

function createStableId(prefix: string, parts: readonly string[]): string {
  const hash = createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24);
  return `${prefix}_${hash}`;
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
