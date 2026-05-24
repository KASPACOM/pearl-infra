import type {
  OtcQuote,
  OtcTrade,
  PearlEscrowMode,
  PearlReleaseSigningMode,
  PublicTradeProof,
  TradeEvent,
  TradeState,
} from '@kaspacom/pearl-sdk';

export interface CreateQuoteRequest {
  side: 'buy_prl' | 'sell_prl';
  amountPrl: string;
  settlementAsset: 'USDC';
  settlementNetwork: 'base';
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

export type { PublicTradeProof };

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
export type SupportAlertSeverity = 'info' | 'warning' | 'critical';
export type AdminDebugRedaction = 'support' | 'operator' | 'admin';

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

export interface UsdcEscrowVerification {
  tradeId: string;
  verified: boolean;
  depositAllowed: boolean;
  mismatches: string[];
  expected?: {
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
  onChain?: {
    buyer: string;
    seller: string;
    amountMicros: string;
    feeMicros: string;
    expiryUnixSeconds: number;
    status: 'none' | 'created' | 'deposited' | 'released' | 'refunded' | 'cancelled';
  };
}

export interface PearlReleaseSigningIntent {
  tradeId: string;
  action: 'release' | 'refund';
  status: 'ready' | 'not_ready';
  signingMode?: 'preauthorize_release' | 'manual_after_base_deposit';
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

export interface SubmitPearlSignedTransactionResponse {
  tradeId: string;
  action: 'release' | 'refund';
  broadcastTxid: string;
  txTemplateHash: string;
}

export interface AdminTradeQuery {
  state?: TradeState;
  manualReviewOnly?: boolean;
  search?: string;
  severity?: SupportAlertSeverity;
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
  state: TradeState;
  side: OtcTrade['side'];
  amountPrl: string;
  amountUsdc: string;
  ageMs: number;
  updatedAgeMs: number;
  currentBlockers: string[];
  deadlineBreaches: string[];
  manualReview: boolean;
  alertCount: number;
  latestAlertSeverity?: SupportAlertSeverity;
  alertDeliveryStatus?: OtcSideEffectStatus;
  failedSideEffectCount: number;
  safeActions: string[];
  updatedAt: string;
}

export interface AdminTradeListPage {
  items: AdminTradeSummary[];
  nextCursor?: string;
  total: number;
  limit: number;
}

export interface AdminUserQuery {
  search?: string;
  walletType?: OtcUserWalletType;
  referrerUserId?: string;
  cursor?: string;
  limit?: number;
}

export interface AdminUserSummary {
  userId: string;
  referralCode: string;
  email?: string;
  emailVerified: boolean;
  notificationEmailEnabled: boolean;
  referredBy?: {
    referredUserId: string;
    referrerUserId: string;
    referralCode: string;
    sourceUrl?: string;
    attributedAt: string;
  };
  wallets: OtcUserWallet[];
  walletCount: number;
  orderCount: number;
  tradeCount: number;
  pointTotal: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserListPage {
  items: AdminUserSummary[];
  nextCursor?: string;
  total: number;
  limit: number;
}

export interface AdminTradeDebugDetail {
  trade: OtcTrade;
  events: TradeEvent[];
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

export interface AdminSupportAlertRequest {
  idempotencyKey: string;
  severity: SupportAlertSeverity;
  message: string;
  contact?: string;
  metadata?: Record<string, unknown>;
}

export interface MarkManualReviewRequest {
  idempotencyKey: string;
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface ReplaySupportAlertDeliveryRequest {
  idempotencyKey: string;
}

export interface PublicSupportAlertRequest {
  idempotencyKey: string;
  actor: 'user';
  severity: SupportAlertSeverity;
  message: string;
  source: 'user';
  contact?: string;
  metadata?: Record<string, unknown>;
}

export type OtcUserWalletType = 'evm' | 'pearl';

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

export interface RegisterUserRequest {
  challengeId: string;
  signature: string;
  publicKeyHex?: string;
  referralCode?: string;
  sourceUrl?: string;
  email?: string;
  notificationEmailEnabled?: boolean;
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

export interface OtcNotificationPreference {
  userId: string;
  notificationType: OtcNotificationType;
  channel: OtcNotificationChannel;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
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

export interface NotificationPreferencesResponse {
  userId: string;
  preferences: OtcNotificationPreference[];
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

export interface OtcUserWallet {
  userId: string;
  walletType: OtcUserWalletType;
  network: string;
  address: string;
  publicKeyHex?: string;
  verifiedAt: string;
  createdAt: string;
}

export interface OtcUser {
  userId: string;
  referralCode: string;
  wallet: OtcUserWallet;
  wallets: OtcUserWallet[];
  profile: {
    userId: string;
    email?: string;
    emailVerifiedAt?: string;
    notificationEmailEnabled: boolean;
    createdAt: string;
    updatedAt: string;
  };
  referredBy?: {
    referredUserId: string;
    referrerUserId: string;
    referralCode: string;
    sourceUrl?: string;
    attributedAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface LinkUserWalletRequest {
  challengeId: string;
  signature: string;
  publicKeyHex?: string;
  walletChallengeId: string;
  walletSignature: string;
  walletPublicKeyHex?: string;
}

export interface ReferralCodeLookup {
  referralCode: string;
  ownerUserId: string;
  status: 'active' | 'disabled';
  createdAt: string;
}

export type OtcOrderStatus = 'open' | 'partially_filled' | 'filled' | 'cancelled' | 'expired';
export type OtcFundingAsset = 'PRL' | 'USDC';
export type OtcPointSource = 'signup' | 'referral_signup' | 'trade_completed' | 'order_created' | 'referral_activity_bonus';

export interface OtcOrder {
  orderId: string;
  makerUserId: string;
  side: 'buy_prl' | 'sell_prl';
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
  side: 'buy_prl' | 'sell_prl';
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

export interface OrderQuoteResponse {
  quote: OtcQuote;
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
  side?: 'buy_prl' | 'sell_prl';
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
  state: TradeState;
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

export interface OtcApiClientOptions {
  baseUrl: string;
  fetcher?: typeof fetch;
}

export class OtcApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = 'OtcApiError';
    this.status = status;
    this.payload = payload;
  }
}

export class OtcApiClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(options: OtcApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.fetcher = options.fetcher ?? fetch;
  }

  createQuote(request: CreateQuoteRequest): Promise<OtcQuote> {
    return this.post('/otc/quotes', request);
  }

  getQuote(quoteId: string): Promise<OtcQuote> {
    return this.get(`/otc/quotes/${encodeURIComponent(quoteId)}`);
  }

  acceptQuote(quoteId: string, request: AcceptQuoteRequest): Promise<OtcTrade> {
    return this.post(`/otc/quotes/${encodeURIComponent(quoteId)}/accept`, request);
  }

  getTrade(tradeId: string): Promise<OtcTrade> {
    return this.get(`/otc/trades/${encodeURIComponent(tradeId)}`);
  }

  getProof(tradeId: string): Promise<PublicTradeProof> {
    return this.get(`/otc/trades/${encodeURIComponent(tradeId)}/proof`);
  }

  getPearlReleaseSigningIntent(tradeId: string): Promise<PearlReleaseSigningIntent> {
    return this.get(`/otc/trades/${encodeURIComponent(tradeId)}/pearl-release/intent`);
  }

  getPearlRefundSigningIntent(tradeId: string): Promise<PearlReleaseSigningIntent> {
    return this.get(`/otc/trades/${encodeURIComponent(tradeId)}/pearl-refund/intent`);
  }

  submitPearlSignedTransaction(
    tradeId: string,
    action: 'release' | 'refund',
    request: { idempotencyKey: string; signedTxHex: string },
  ): Promise<SubmitPearlSignedTransactionResponse> {
    return this.post(`/otc/trades/${encodeURIComponent(tradeId)}/pearl-${action}/broadcast`, request);
  }

  createWalletChallenge(request: CreateWalletChallengeRequest): Promise<CreateWalletChallengeResponse> {
    return this.post('/otc/users/wallet-challenges', request);
  }

  registerUser(request: RegisterUserRequest): Promise<OtcUser> {
    return this.post('/otc/users', request);
  }

  linkUserWallet(userId: string, request: LinkUserWalletRequest): Promise<OtcUser> {
    return this.post(`/otc/users/${encodeURIComponent(userId)}/wallets`, request);
  }

  resolveReferralCode(referralCode: string): Promise<ReferralCodeLookup> {
    return this.get(`/otc/users/referrals/${encodeURIComponent(referralCode)}`);
  }

  updateUserProfile(userId: string, request: UpdateUserProfileRequest): Promise<OtcUser['profile']> {
    return this.post(`/otc/users/${encodeURIComponent(userId)}/profile`, request);
  }

  requestEmailVerification(userId: string, request: RequestEmailVerificationRequest): Promise<RequestEmailVerificationResponse> {
    return this.post(`/otc/users/${encodeURIComponent(userId)}/email/verification`, request);
  }

  verifyEmail(userId: string, request: VerifyEmailRequest): Promise<OtcUser['profile']> {
    return this.post(`/otc/users/${encodeURIComponent(userId)}/email/verify`, request);
  }

  getNotificationPreferences(userId: string, request: UserDashboardRequest): Promise<NotificationPreferencesResponse> {
    return this.post(`/otc/users/${encodeURIComponent(userId)}/notification-preferences/read`, request);
  }

  updateNotificationPreferences(userId: string, request: UpdateNotificationPreferencesRequest): Promise<NotificationPreferencesResponse> {
    return this.post(`/otc/users/${encodeURIComponent(userId)}/notification-preferences`, request);
  }

  getMarketStats(): Promise<MarketStats> {
    return this.get('/otc/market/stats');
  }

  listRecentTrades(limit = 25): Promise<RecentTradeSummary[]> {
    return this.get(`/otc/market/recent-trades?limit=${encodeURIComponent(String(limit))}`);
  }

  listOrders(query: OrderBookQuery = {}): Promise<OrderBookPage> {
    const params = new URLSearchParams();
    if (query.side) params.set('side', query.side);
    if (query.status) params.set('status', query.status);
    if (query.minPrl) params.set('min_prl', query.minPrl);
    if (query.maxPrl) params.set('max_prl', query.maxPrl);
    if (query.minPrice) params.set('min_price', query.minPrice);
    if (query.maxPrice) params.set('max_price', query.maxPrice);
    if (query.makerUserId) params.set('maker_user_id', query.makerUserId);
    if (query.sort) params.set('sort', query.sort);
    if (query.cursor) params.set('cursor', query.cursor);
    if (typeof query.limit === 'number') params.set('limit', String(query.limit));
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return this.get(`/otc/orders${suffix}`);
  }

  createOrder(request: CreateOrderRequest): Promise<OtcOrder> {
    return this.post('/otc/orders', request);
  }

  createOrderQuote(orderId: string, request: CreateOrderQuoteRequest): Promise<OrderQuoteResponse> {
    return this.post(`/otc/orders/${encodeURIComponent(orderId)}/quotes`, request);
  }

  getOrderQuoteAcceptContext(quoteId: string): Promise<OrderQuoteAcceptContext> {
    return this.get(`/otc/quotes/${encodeURIComponent(quoteId)}/order-context`);
  }

  getUserDashboard(userId: string, request: UserDashboardRequest): Promise<OtcUserDashboard> {
    return this.post(`/otc/users/${encodeURIComponent(userId)}/dashboard`, request);
  }

  prepareUsdcCreateTrade(tradeId: string, request: PrepareUsdcCreateTradeRequest, adminToken?: string): Promise<UsdcCreateTradeIntent> {
    return this.post(`/otc/trades/${encodeURIComponent(tradeId)}/usdc-escrow/create-intent`, request, adminToken);
  }

  verifyUsdcEscrowTerms(tradeId: string): Promise<UsdcEscrowVerification> {
    return this.get(`/otc/trades/${encodeURIComponent(tradeId)}/usdc-escrow/verification`);
  }

  listSideEffects(tradeId: string): Promise<OtcSideEffect[]> {
    return this.get(`/otc/trades/${encodeURIComponent(tradeId)}/side-effects`);
  }

  recordSideEffect(tradeId: string, request: RecordSideEffectRequest, adminToken?: string): Promise<OtcSideEffect> {
    return this.post(`/otc/trades/${encodeURIComponent(tradeId)}/side-effects`, request, adminToken);
  }

  recordPublicSupportAlert(tradeId: string, request: PublicSupportAlertRequest): Promise<OtcSideEffect> {
    return this.post(`/otc/trades/${encodeURIComponent(tradeId)}/support-alerts`, request);
  }

  listAdminTrades(query: AdminTradeQuery, adminToken: string): Promise<AdminTradeListPage> {
    const params = new URLSearchParams();
    if (query.state) {
      params.set('state', query.state);
    }
    if (query.manualReviewOnly) {
      params.set('manual_review_only', 'true');
    }
    if (query.search?.trim()) {
      params.set('search', query.search.trim());
    }
    if (query.severity) {
      params.set('severity', query.severity);
    }
    if (query.failedSideEffectOnly) {
      params.set('failed_side_effect_only', 'true');
    }
    if (query.deadlineBreachedOnly) {
      params.set('deadline_breached_only', 'true');
    }
    if (query.blocker?.trim()) {
      params.set('blocker', query.blocker.trim());
    }
    if (typeof query.minUpdatedAgeMs === 'number' && Number.isFinite(query.minUpdatedAgeMs)) {
      params.set('min_updated_age_ms', String(Math.max(0, Math.floor(query.minUpdatedAgeMs))));
    }
    if (query.alertDeliveryStatus) {
      params.set('alert_delivery_status', query.alertDeliveryStatus);
    }
    if (query.cursor?.trim()) {
      params.set('cursor', query.cursor.trim());
    }
    if (typeof query.limit === 'number' && Number.isFinite(query.limit)) {
      params.set('limit', String(Math.max(1, Math.floor(query.limit))));
    }
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return this.get(`/otc/admin/trades${suffix}`, adminToken);
  }

  listAdminUsers(query: AdminUserQuery, adminToken: string): Promise<AdminUserListPage> {
    const params = new URLSearchParams();
    if (query.search?.trim()) {
      params.set('search', query.search.trim());
    }
    if (query.walletType) {
      params.set('wallet_type', query.walletType);
    }
    if (query.referrerUserId?.trim()) {
      params.set('referrer_user_id', query.referrerUserId.trim());
    }
    if (query.cursor?.trim()) {
      params.set('cursor', query.cursor.trim());
    }
    if (typeof query.limit === 'number' && Number.isFinite(query.limit)) {
      params.set('limit', String(Math.max(1, Math.floor(query.limit))));
    }
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return this.get(`/otc/admin/users${suffix}`, adminToken);
  }

  getAdminTradeDebug(tradeId: string, adminToken: string): Promise<AdminTradeDebugDetail> {
    return this.get(`/otc/admin/trades/${encodeURIComponent(tradeId)}`, adminToken);
  }

  recordAdminSupportAlert(tradeId: string, request: AdminSupportAlertRequest, adminToken: string): Promise<OtcSideEffect> {
    return this.post(`/otc/admin/trades/${encodeURIComponent(tradeId)}/alerts`, request, adminToken);
  }

  markAdminManualReview(tradeId: string, request: MarkManualReviewRequest, adminToken: string): Promise<OtcSideEffect> {
    return this.post(`/otc/admin/trades/${encodeURIComponent(tradeId)}/manual-review`, request, adminToken);
  }

  replayAdminSupportAlertDelivery(
    tradeId: string,
    alertId: string,
    request: ReplaySupportAlertDeliveryRequest,
    adminToken: string,
  ): Promise<OtcSideEffect> {
    return this.post(`/otc/admin/trades/${encodeURIComponent(tradeId)}/alerts/${encodeURIComponent(alertId)}/replay`, request, adminToken);
  }

  private async get<T>(path: string, adminToken?: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' }, adminToken);
  }

  private async post<T>(path: string, body: unknown, adminToken?: string): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, adminToken);
  }

  private async request<T>(path: string, init: RequestInit, adminToken?: string): Promise<T> {
    const headers = new Headers(init.headers);
    if (adminToken) {
      headers.set('authorization', `Bearer ${adminToken}`);
    }
    const response = await this.fetcher(`${this.baseUrl}${path}`, { ...init, headers });
    const payload = await readJson(response);
    if (!response.ok) {
      const message = getErrorMessage(payload) ?? `OTC API request failed with ${response.status}`;
      throw new OtcApiError(message, response.status, payload);
    }
    return payload as T;
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }
  return JSON.parse(text) as unknown;
}

function getErrorMessage(payload: unknown): string | undefined {
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }
  return undefined;
}
