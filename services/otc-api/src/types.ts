import type {
  PearlEscrowMode,
  PearlReleaseSigningMode,
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
  pearlEscrowMode?: PearlEscrowMode;
  pearlReleaseSigningMode?: PearlReleaseSigningMode;
  buyerPearlPubkey?: string;
  sellerPearlPubkey?: string;
  clientRequestId: string;
}

export interface OtcApiConfig {
  pearlNetwork: OtcTrade['pearlEscrow']['network'];
  pearlEscrowAllocator: 'mock' | 'p2tr_xpub' | 'p2tr_multisig';
  pearlEscrowXpub?: string;
  pearlEscrowArbiterPubkey?: string;
  pearlEscrowDerivationPrefix: string;
  allowMainnetPearlEscrow: boolean;
  quoteTtlMs: number;
  pearlFundingTtlMs: number;
  usdcDepositTtlMs: number;
  settlementTtlMs: number;
  priceUsdcPerPrl: string;
  feeBps: number;
  pearlEscrowConfirmations: number;
  pearlReleaseFeeGrains?: string;
  baseEscrowContract: string;
  baseNetwork: 'base' | 'base_sepolia';
  databaseUrl?: string;
  baseRpcUrl?: string;
  pearlIndexerWatchUrl?: string;
  pearlIndexerWatchTimeoutMs?: number;
  adminApiToken?: string;
  adminApiTokens?: string;
  supportAlertWebhookUrl?: string;
  supportAlertTelegramBotToken?: string;
  supportAlertTelegramChatId?: string;
  supportAlertTelegramMessageThreadId?: string;
  supportAlertRateLimitWindowMs: number;
  supportAlertRateLimitMax: number;
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
  | 'support_alert_delivery'
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

export interface PearlReleaseSigningIntent {
  tradeId: string;
  action: 'release';
  status: 'ready' | 'not_ready';
  signingMode?: PearlReleaseSigningMode;
  reason?: string;
  unsignedTxHex?: string;
  txTemplateHash?: string;
  inputOutpoint?: string;
  inputAmountGrains?: string;
  outputAmountGrains?: string;
  feeGrains?: string;
  destinationAddress?: string;
  signerSets: string[][];
  workerCanFinishWithArbiter: boolean;
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
  severity?: 'info' | 'warning' | 'critical';
  failedSideEffectOnly?: boolean;
  deadlineBreachedOnly?: boolean;
  blocker?: string;
  minUpdatedAgeMs?: number;
  alertDeliveryStatus?: OtcSideEffectStatus;
  cursor?: string;
  limit?: number;
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
  latestAlertSeverity?: 'info' | 'warning' | 'critical';
  alertDeliveryStatus?: OtcSideEffectStatus;
  safeActions: string[];
  updatedAt: string;
}

export interface AdminTradeListPage {
  items: AdminTradeSummary[];
  nextCursor?: string;
  total: number;
  limit: number;
}

export type AdminDebugRedaction = 'support' | 'operator' | 'admin';

export interface AdminTradeDebugDetail {
  trade: OtcTrade;
  events: import('@kaspacom/pearl-sdk').TradeEvent[];
  sideEffects: OtcSideEffect[];
  proof: PublicTradeProof;
  currentBlockers: string[];
  deadlineBreaches: string[];
  safeActions: string[];
  redaction: AdminDebugRedaction;
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
  actor?: string;
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface ReplaySupportAlertRequest {
  idempotencyKey: string;
  actor?: string;
}

export interface AdminActorContext {
  actor: string;
  roles: string[];
}

export interface AdminTradeDebugOptions {
  redaction?: AdminDebugRedaction;
}

export interface MarkManualReviewOptions {
  actor?: string;
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
