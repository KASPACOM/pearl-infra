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
  buyerPearlPubkeyProof?: string;
  sellerPearlPubkeyProof?: string;
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
  pearlRpcUrl?: string;
  pearlRpcUser?: string;
  pearlRpcPass?: string;
  adminApiToken?: string;
  adminApiTokens?: string;
  supportAlertWebhookUrl?: string;
  supportAlertTelegramBotToken?: string;
  supportAlertTelegramChatId?: string;
  supportAlertTelegramMessageThreadId?: string;
  supportAlertRateLimitWindowMs: number;
  supportAlertRateLimitMax: number;
  notificationEmailWebhookUrl?: string;
  notificationEmailWebhookToken?: string;
  notificationWorkerEnabled?: boolean;
  notificationWorkerIntervalMs?: number;
  notificationWorkerBatchSize?: number;
  notificationWorkerMaxAttempts?: number;
  notificationRetryBaseMs?: number;
  notificationDeadlineWarningWindowMs?: number;
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
  action: 'release' | 'refund';
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

export interface SubmitPearlSignedTransactionRequest {
  idempotencyKey: string;
  signedTxHex: string;
}

export interface SubmitPearlSignedTransactionResponse {
  tradeId: string;
  action: 'release' | 'refund';
  broadcastTxid: string;
  txTemplateHash: string;
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

export type OtcUserWalletType = 'evm' | 'pearl';

export interface OtcUserWalletChallenge {
  challengeId: string;
  walletType: OtcUserWalletType;
  network: string;
  address: string;
  message: string;
  nonce: string;
  expiresAt: string;
  consumedAt?: string;
  createdAt: string;
}

export interface CreateWalletChallengeRequest {
  walletType: OtcUserWalletType;
  network: string;
  address: string;
}

export interface CreateWalletChallengeResponse {
  challengeId: string;
  message: string;
  expiresAt: string;
}

export interface OtcUserWallet {
  userId: string;
  walletType: OtcUserWalletType;
  network: string;
  address: string;
  publicKeyHex?: string;
  verifiedAt: string;
  createdAt: string;
}

export interface OtcUserProfile {
  userId: string;
  email?: string;
  emailVerifiedAt?: string;
  notificationEmailEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OtcReferralAttribution {
  referredUserId: string;
  referrerUserId: string;
  referralCode: string;
  sourceUrl?: string;
  attributedAt: string;
}

export interface OtcUser {
  userId: string;
  referralCode: string;
  wallet: OtcUserWallet;
  wallets: OtcUserWallet[];
  profile: OtcUserProfile;
  referredBy?: OtcReferralAttribution;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterUserRequest {
  challengeId: string;
  signature: string;
  publicKeyHex?: string;
  referralCode?: string;
  sourceUrl?: string;
  email?: string;
  notificationEmailEnabled?: boolean;
}

export interface LinkUserWalletRequest {
  challengeId: string;
  signature: string;
  publicKeyHex?: string;
  walletChallengeId: string;
  walletSignature: string;
  walletPublicKeyHex?: string;
}

export interface UpdateUserProfileRequest {
  challengeId: string;
  signature: string;
  publicKeyHex?: string;
  email?: string;
  notificationEmailEnabled?: boolean;
}

export type OtcNotificationType =
  | 'trade_status'
  | 'deadline_warning'
  | 'order_matched'
  | 'price_alert'
  | 'new_good_order'
  | 'referral_event'
  | 'email_verification';

export type OtcNotificationChannel = 'email' | 'telegram';
export type OtcNotificationDeliveryStatus = 'pending' | 'sent' | 'failed' | 'cancelled' | 'unsubscribed';

export interface OtcEmailVerificationToken {
  tokenId: string;
  userId: string;
  email: string;
  tokenHash: string;
  expiresAt: string;
  consumedAt?: string;
  createdAt: string;
}

export interface OtcNotificationPreference {
  userId: string;
  notificationType: OtcNotificationType;
  channel: OtcNotificationChannel;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OtcNotificationDelivery {
  deliveryId: string;
  userId?: string;
  notificationType: OtcNotificationType;
  channel: OtcNotificationChannel;
  recipient: string;
  status: OtcNotificationDeliveryStatus;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  unsubscribeTokenHash?: string;
  attempts: number;
  lastError?: string;
  nextAttemptAt: string;
  sentAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OtcNotificationTarget {
  user: OtcUser;
  channel: OtcNotificationChannel;
  recipient: string;
}

export interface NotificationDispatchResult {
  scannedDeadlines: number;
  processedDeliveries: number;
  sentDeliveries: number;
  failedDeliveries: number;
  skippedDeliveries: number;
}

export interface RequestEmailVerificationRequest {
  challengeId: string;
  signature: string;
  publicKeyHex?: string;
  email: string;
}

export interface RequestEmailVerificationResponse {
  userId: string;
  email: string;
  status: 'pending';
  expiresAt: string;
  deliveryId: string;
}

export interface VerifyEmailRequest {
  token: string;
}

export interface UpdateNotificationPreferencesRequest {
  challengeId: string;
  signature: string;
  publicKeyHex?: string;
  preferences: Array<{
    notificationType: OtcNotificationType;
    channel: OtcNotificationChannel;
    enabled: boolean;
  }>;
}

export interface NotificationPreferencesResponse {
  userId: string;
  preferences: OtcNotificationPreference[];
}

export interface UnsubscribeNotificationRequest {
  token: string;
}

export interface UnsubscribeNotificationResponse {
  userId?: string;
  notificationType: OtcNotificationType;
  channel: OtcNotificationChannel;
  status: 'unsubscribed';
}

export interface ListNotificationDeliveriesQuery {
  status?: OtcNotificationDeliveryStatus;
  limit?: number;
}

export interface UpdateNotificationDeliveryRequest {
  status: Extract<OtcNotificationDeliveryStatus, 'sent' | 'failed' | 'cancelled'>;
  error?: string;
  nextAttemptAt?: string;
}

export interface ReferralCodeLookup {
  referralCode: string;
  ownerUserId: string;
  status: 'active' | 'disabled';
  createdAt: string;
}

export type OtcOrderStatus = 'open' | 'partially_filled' | 'filled' | 'cancelled' | 'expired';
export type OtcFundingAsset = 'PRL' | 'USDC';
export type OtcPointSource =
  | 'signup'
  | 'referral_signup'
  | 'trade_completed'
  | 'order_created'
  | 'referral_activity_bonus';

export interface OtcOrder {
  orderId: string;
  makerUserId: string;
  side: OtcQuoteSide;
  fundingAsset: OtcFundingAsset;
  makerPearlAddress: string;
  makerUsdcAddress: string;
  makerPearlPubkey: string;
  makerPearlPubkeyProof: string;
  pearlReleaseSigningMode: PearlReleaseSigningMode;
  amountPrl: string;
  remainingPrl: string;
  priceUsdcPerPrl: string;
  minFillPrl?: string;
  status: OtcOrderStatus;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOrderRequest {
  userId: string;
  challengeId: string;
  signature: string;
  publicKeyHex?: string;
  side: OtcQuoteSide;
  makerPearlAddress: string;
  makerUsdcAddress: string;
  makerPearlPubkey: string;
  makerPearlPubkeyProof: string;
  pearlReleaseSigningMode?: PearlReleaseSigningMode;
  amountPrl: string;
  priceUsdcPerPrl: string;
  minFillPrl?: string;
  expiresAt?: string;
}

export interface CreateOrderQuoteRequest {
  userId: string;
  challengeId: string;
  signature: string;
  publicKeyHex?: string;
  amountPrl: string;
  pearlAddress: string;
  usdcAddress: string;
  clientRequestId: string;
}

export interface OtcOrderQuoteLink {
  quoteId: string;
  orderId: string;
  amountPrl: string;
  takerUserId?: string;
  takerPearlAddress?: string;
  takerUsdcAddress?: string;
  createdAt: string;
}

export interface OrderQuoteResponse {
  quote: import('@kaspacom/pearl-sdk').OtcQuote;
  order: OtcOrder;
  makerRole: 'buyer' | 'seller';
  acceptPrefill: Partial<AcceptQuoteRequest>;
}

export interface OrderQuoteAcceptContext {
  quoteId: string;
  order: OtcOrder;
  makerRole: 'buyer' | 'seller';
  acceptPrefill: Partial<AcceptQuoteRequest>;
}

export interface OrderBookQuery {
  side?: OtcQuoteSide;
  status?: OtcOrderStatus;
  minPrl?: string;
  maxPrl?: string;
  minPrice?: string;
  maxPrice?: string;
  makerUserId?: string;
  sort?: 'best_price' | 'newest' | 'largest';
  cursor?: string;
  limit?: number;
}

export interface OrderBookPage {
  items: OtcOrder[];
  total: number;
  limit: number;
  nextCursor?: string;
}

export interface OtcPointEvent {
  pointEventId: string;
  userId: string;
  source: OtcPointSource;
  points: number;
  relatedUserId?: string;
  tradeId?: string;
  orderId?: string;
  referralCode?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface OtcPointsSummary {
  userId: string;
  totalPoints: number;
  bySource: Partial<Record<OtcPointSource, number>>;
  recent: OtcPointEvent[];
}

export interface MarketStats {
  successfulTrades: number;
  totalVolumePrl: string;
  totalVolumeUsdc: string;
  activeOrderVolumePrl: string;
  activeEscrowVolumePrl: string;
  verifiedUsers: number;
  openOrders: number;
}

export interface RecentTradeSummary {
  tradeId: string;
  side: OtcTrade['side'];
  amountPrl: string;
  amountUsdc: string;
  priceUsdcPerPrl: string;
  state: OtcTrade['state'];
  updatedAt: string;
}

export interface OtcUserDashboard {
  user: OtcUser;
  points: OtcPointsSummary;
  orders: OtcOrder[];
  trades: OtcTrade[];
}

export interface UserDashboardRequest {
  challengeId: string;
  signature: string;
  publicKeyHex?: string;
}
