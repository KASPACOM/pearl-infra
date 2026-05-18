import type {
  OtcQuoteSide,
  OtcTrade,
  PublicTradeProof,
  SettlementAsset,
  SettlementNetwork,
} from '@kaspacom/pearl-sdk';

export type { PublicTradeProof };

export type QuoteRequestStatus = 'pending' | 'created';

export interface CreateQuoteRequest {
  side: OtcQuoteSide;
  amountPrl: string;
  settlementAsset: SettlementAsset;
  settlementNetwork: SettlementNetwork;
  buyerPearlAddress: string;
  usdcRefundAddress: string;
  clientRequestId: string;
}

export interface AcceptQuoteRequest {
  buyerPearlAddress: string;
  buyerUsdcAddress: string;
  sellerPearlRefundAddress: string;
  sellerUsdcReceiveAddress: string;
  clientRequestId: string;
}

export interface OtcApiConfig {
  pearlNetwork: OtcTrade['pearlEscrow']['network'];
  pearlEscrowAllocator: 'mock' | 'p2tr_xpub';
  pearlEscrowXpub?: string;
  pearlEscrowDerivationPrefix: string;
  allowMainnetPearlEscrow: boolean;
  quoteTtlMs: number;
  pearlFundingTtlMs: number;
  usdcDepositTtlMs: number;
  settlementTtlMs: number;
  priceUsdcPerPrl: string;
  feeBps: number;
  pearlEscrowConfirmations: number;
  baseEscrowContract: string;
  baseNetwork: 'base' | 'base_sepolia';
  databaseUrl?: string;
  baseRpcUrl?: string;
  pearlIndexerWatchUrl?: string;
  pearlIndexerWatchTimeoutMs?: number;
  adminApiToken?: string;
}

export interface OtcApiRuntimeConfig {
  production: boolean;
}

export type OtcSideEffectType =
  | 'usdc_create_trade'
  | 'usdc_deposit_observed'
  | 'usdc_release'
  | 'usdc_refund'
  | 'pearl_watch_register'
  | 'pearl_release'
  | 'pearl_refund'
  | 'support_alert'
  | 'manual_review_note';

export type OtcSideEffectStatus = 'prepared' | 'submitted' | 'confirmed' | 'failed';

export interface OtcSideEffect {
  idempotencyKey: string;
  requestHash?: string;
  tradeId: string;
  effectType: OtcSideEffectType;
  status: OtcSideEffectStatus;
  actor: string;
  sourceEventId?: string;
  txHash?: string;
  outpoint?: string;
  blockNumber?: number;
  blockHash?: string;
  chainId?: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PrepareUsdcCreateTradeRequest {
  idempotencyKey: string;
  actor: string;
}

export interface UsdcCreateTradeIntent {
  tradeId: string;
  contract: string;
  chainId: number;
  tradeKey: string;
  buyer: string;
  seller: string;
  amountMicros: string;
  feeMicros: string;
  expiryUnixSeconds: number;
  sideEffect: OtcSideEffect;
}

export interface RecordSideEffectRequest {
  idempotencyKey: string;
  effectType: OtcSideEffectType;
  status: OtcSideEffectStatus;
  actor: string;
  sourceEventId?: string;
  txHash?: string;
  outpoint?: string;
  blockNumber?: number;
  blockHash?: string;
  chainId?: number;
  metadata?: Record<string, unknown>;
}

export interface AdminTradeQuery {
  state?: OtcTrade['state'];
  manualReviewOnly?: boolean;
  search?: string;
}

export interface AdminTradeSummary {
  tradeId: string;
  quoteId: string;
  state: OtcTrade['state'];
  side: OtcTrade['side'];
  amountPrl: string;
  amountUsdc: string;
  ageMs: number;
  updatedAgeMs: number;
  currentBlockers: string[];
  deadlineBreaches: string[];
  manualReview: boolean;
  alertCount: number;
  failedSideEffectCount: number;
  safeActions: string[];
  updatedAt: string;
}

export interface AdminTradeDebugDetail {
  trade: OtcTrade;
  events: import('@kaspacom/pearl-sdk').TradeEvent[];
  sideEffects: OtcSideEffect[];
  proof: PublicTradeProof;
  currentBlockers: string[];
  deadlineBreaches: string[];
  safeActions: string[];
  supportSummary: {
    headline: string;
    waitingOn: string[];
    nextDeadline?: {
      name: string;
      at: string;
      msRemaining: number;
    };
    publicProofPath: string;
  };
}

export interface RecordSupportAlertRequest {
  idempotencyKey: string;
  actor: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  contact?: string;
  source?: 'user' | 'operator' | 'system';
  metadata?: Record<string, unknown>;
}

export interface MarkManualReviewRequest {
  idempotencyKey: string;
  actor: string;
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface UsdcEscrowOnChainTrade {
  buyer: string;
  seller: string;
  amountMicros: string;
  feeMicros: string;
  expiryUnixSeconds: number;
  status: 'none' | 'created' | 'deposited' | 'released' | 'refunded' | 'cancelled';
}

export interface UsdcEscrowVerification {
  tradeId: string;
  verified: boolean;
  depositAllowed: boolean;
  mismatches: string[];
  expected: {
    contract: string;
    chainId: number;
    tradeKey: string;
    buyer: string;
    seller: string;
    amountMicros: string;
    feeMicros: string;
    expiryUnixSeconds: number;
    usdcToken: string;
  };
  onChain?: UsdcEscrowOnChainTrade;
}
