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
} from '@kaspacom/pearl-sdk';
import { getUsdcEscrowNetworkConfig } from '@kaspacom/usdc-escrow-client';

import type { OtcRepository } from './repository.js';
import type { AcceptQuoteRequest, CreateQuoteRequest, OtcApiConfig, PublicTradeProof } from './types.js';

export interface PearlEscrowAllocator {
  allocateEscrow(input: {
    tradeId: string;
    quote: OtcQuote;
    request: AcceptQuoteRequest;
    config: OtcApiConfig;
  }): OtcTrade['pearlEscrow'];
}

export class MockPearlEscrowAllocator implements PearlEscrowAllocator {
  allocateEscrow(input: {
    tradeId: string;
    quote: OtcQuote;
    request: AcceptQuoteRequest;
    config: OtcApiConfig;
  }): OtcTrade['pearlEscrow'] {
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
  private readonly now: () => Date;

  constructor(
    repository: OtcRepository,
    config: OtcApiConfig,
    pearlEscrowAllocator: PearlEscrowAllocator = new MockPearlEscrowAllocator(),
    now: () => Date = () => new Date(),
  ) {
    this.repository = repository;
    this.config = config;
    this.pearlEscrowAllocator = pearlEscrowAllocator;
    this.now = now;
  }

  async createQuote(request: CreateQuoteRequest): Promise<OtcQuote> {
    const existing = await this.repository.findQuoteByClientRequestId(request.clientRequestId);
    if (existing) {
      return existing;
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

    await this.repository.saveQuote(quote, request.clientRequestId);
    return quote;
  }

  async acceptQuote(quoteId: string, request: AcceptQuoteRequest): Promise<OtcTrade> {
    const existing = await this.repository.findTradeByClientRequestId(request.clientRequestId);
    if (existing) {
      return existing;
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
    const pearlEscrow = this.pearlEscrowAllocator.allocateEscrow({
      tradeId,
      quote,
      request,
      config: this.config,
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

    await this.repository.saveTrade(trade, request.clientRequestId);
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

function createTradeKey(tradeId: string): string {
  return `0x${createHash('sha256').update(tradeId).digest('hex')}`;
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
