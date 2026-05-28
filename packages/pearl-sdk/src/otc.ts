export type OtcQuoteSide = 'buy_prl' | 'sell_prl';
export type SettlementAsset = 'USDC';
export type SettlementNetwork = 'base';
export type SettlementChainId = 8453 | 84532;
export type PearlEscrowMode = 'coordinator' | 'multisig';
export type PearlReleaseSigningMode = 'preauthorize_release' | 'manual_after_base_deposit';

export type TradeState =
  | 'quoted'
  | 'quote_expired'
  | 'pearl_escrow_pending'
  | 'pearl_escrow_seen'
  | 'pearl_escrow_confirmed'
  | 'usdc_escrow_pending'
  | 'usdc_escrow_confirmed'
  | 'release_pending'
  | 'released'
  | 'refund_available'
  | 'refund_pending'
  | 'refunded'
  | 'disputed'
  | 'cancelled'
  | 'failed_manual_review'
  | 'late_prl_funding'
  | 'usdc_refunded'
  | 'prl_release_failed'
  | 'amount_mismatch'
  | 'reorged'
  | 'stale_indexer'
  | 'unknown_spend';

export interface OtcTradeDeadlines {
  quoteExpiresAt: string;
  pearlFundingDeadline: string;
  usdcDepositDeadline: string;
  settlementDeadline: string;
  refundAvailableAt: string;
}

export interface OtcQuote {
  quoteId: string;
  side: OtcQuoteSide;
  amountPrl: string;
  amountUsdc: string;
  feePrl: string;
  feeUsdc: string;
  priceUsdcPerPrl: string;
  settlementAsset: SettlementAsset;
  settlementNetwork: SettlementNetwork;
  expiresAt: string;
  status: 'active' | 'accepted' | 'expired' | 'cancelled';
}

export interface PearlEscrowLeg {
  network: 'mainnet' | 'testnet' | 'testnet2' | 'simnet' | 'regtest';
  address: string;
  expectedAmountGrains: string;
  requiredConfirmations: number;
  escrowScriptType?: 'p2tr';
  internalPubkeyHex?: string;
  internalKeyPolicy?: 'bip341_nums_script_path_only';
  scriptNonceHex?: string;
  taprootOutputScriptHex?: string;
  derivationPath?: string;
  refundEligibleAfterHeight?: number;
  refundEligibleAfterUnixTime?: number;
  fundingOutpoint?: string;
  releaseTxid?: string;
  refundTxid?: string;
  releaseTemplate?: unknown;
  refundTemplate?: unknown;
  signerPubkeys?: Partial<Record<'buyer' | 'seller' | 'arbiter' | 'desk', string>>;
  taprootScriptLeaves?: Array<{
    kind: string;
    requiredSigners: Array<'buyer' | 'seller' | 'arbiter' | 'desk'>;
    scriptHex: string;
    leafVersion?: number;
    controlBlockHex?: string;
    lockTime?: number;
  }>;
  simnetVerified?: boolean;
  buyerReleasePresignature?: PearlBuyerReleasePresignature;
}

export interface PearlBuyerReleasePresignature {
  psbtBase64: string;
  buyerPubkey: string;
  leafKind: 'buyer_arbiter_release';
  destinationAddress: string;
  outputAmountGrains: string;
  feeGrains: string;
  fundingOutpoint: string;
  signedAt: string;
  revokedAt?: string;
}

export interface UsdcEscrowLeg {
  network: SettlementNetwork;
  chainId: SettlementChainId;
  contract: string;
  usdcToken: string;
  tradeKey: string;
  expectedAmountMicros: string;
  requiredConfirmations: number;
  depositTxHash?: string;
  releaseTxHash?: string;
  refundTxHash?: string;
  expiresAt: string;
}

export interface OtcTrade {
  tradeId: string;
  quoteId: string;
  state: TradeState;
  side: OtcQuoteSide;
  amountPrl: string;
  amountUsdc: string;
  feePrl: string;
  feeUsdc: string;
  buyerPearlAddress: string;
  buyerUsdcAddress: string;
  sellerPearlRefundAddress: string;
  sellerUsdcReceiveAddress: string;
  pearlEscrowMode?: PearlEscrowMode;
  pearlReleaseSigningMode?: PearlReleaseSigningMode;
  buyerPearlPubkey?: string;
  sellerPearlPubkey?: string;
  pearlEscrow: PearlEscrowLeg;
  usdcEscrow: UsdcEscrowLeg;
  deadlines: OtcTradeDeadlines;
  createdAt: string;
  updatedAt: string;
}

export interface TradeEvent {
  tradeId: string;
  fromState: TradeState;
  toState: TradeState;
  source: 'system' | 'admin' | 'pearl_indexer' | 'evm_indexer' | 'settlement_worker';
  sourceEventId: string;
  txHash?: string;
  outpoint?: string;
  confirmations?: number;
  observedAt: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface PublicTradeProof {
  tradeId: string;
  status: OtcTrade['state'];
  deadlines: OtcTradeDeadlines;
  quote: Pick<OtcQuote, 'side' | 'amountPrl' | 'amountUsdc' | 'feePrl' | 'feeUsdc' | 'priceUsdcPerPrl'>;
  pearl: {
    escrowAddress: string;
    escrowOutpoint?: string;
    escrowConfirmations: number;
    releaseTxid?: string;
    refundTxid?: string;
  };
  base: {
    chainId: number;
    contract: string;
    usdcToken: string;
    tradeKey: string;
    depositTxHash?: string;
    releaseTxHash?: string;
    refundTxHash?: string;
    requiredConfirmations: number;
  };
  events: TradeEvent[];
  observedAt: string;
}

const EDGE_REVIEW_STATES = [
  'amount_mismatch',
  'reorged',
  'stale_indexer',
  'unknown_spend',
] as const satisfies readonly TradeState[];

const MANUAL_REVIEW_TRANSITIONS = ['failed_manual_review'] as const satisfies readonly TradeState[];

const ALLOWED_TRANSITIONS: Readonly<Record<TradeState, readonly TradeState[]>> = {
  quoted: ['quote_expired', 'pearl_escrow_pending', 'cancelled', 'disputed', 'failed_manual_review'],
  quote_expired: [],
  pearl_escrow_pending: ['pearl_escrow_seen', 'late_prl_funding', 'cancelled', 'disputed', 'failed_manual_review', ...EDGE_REVIEW_STATES],
  pearl_escrow_seen: ['pearl_escrow_confirmed', 'pearl_escrow_pending', 'late_prl_funding', 'disputed', 'failed_manual_review', ...EDGE_REVIEW_STATES],
  pearl_escrow_confirmed: ['usdc_escrow_pending', 'refund_available', 'disputed', 'failed_manual_review', ...EDGE_REVIEW_STATES],
  usdc_escrow_pending: ['usdc_escrow_confirmed', 'refund_available', 'usdc_refunded', 'disputed', 'failed_manual_review', ...EDGE_REVIEW_STATES],
  usdc_escrow_confirmed: ['release_pending', 'usdc_refunded', 'disputed', 'failed_manual_review', ...EDGE_REVIEW_STATES],
  release_pending: ['released', 'prl_release_failed', 'disputed', 'failed_manual_review', ...EDGE_REVIEW_STATES],
  released: [],
  refund_available: ['refund_pending', 'usdc_refunded', 'disputed', 'failed_manual_review'],
  refund_pending: ['refunded', 'usdc_refunded', 'disputed', 'failed_manual_review'],
  refunded: [],
  disputed: ['release_pending', 'refund_available', 'failed_manual_review'],
  cancelled: [],
  failed_manual_review: [],
  late_prl_funding: MANUAL_REVIEW_TRANSITIONS,
  usdc_refunded: MANUAL_REVIEW_TRANSITIONS,
  prl_release_failed: MANUAL_REVIEW_TRANSITIONS,
  amount_mismatch: MANUAL_REVIEW_TRANSITIONS,
  reorged: MANUAL_REVIEW_TRANSITIONS,
  stale_indexer: MANUAL_REVIEW_TRANSITIONS,
  unknown_spend: MANUAL_REVIEW_TRANSITIONS,
};

export function canTransitionTrade(fromState: TradeState, toState: TradeState): boolean {
  return ALLOWED_TRANSITIONS[fromState].includes(toState);
}

export function assertTradeTransition(fromState: TradeState, toState: TradeState): void {
  if (!canTransitionTrade(fromState, toState)) {
    throw new Error(`invalid trade transition: ${fromState} -> ${toState}`);
  }
}

export function tradeStateIsTerminal(state: TradeState): boolean {
  return ALLOWED_TRANSITIONS[state].length === 0;
}
