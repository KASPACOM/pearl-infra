export type OtcQuoteSide = 'buy_prl' | 'sell_prl';
export type SettlementAsset = 'USDC';
export type SettlementNetwork = 'arbitrum';

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
  | 'failed_manual_review';

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
  refundEligibleAfterHeight?: number;
  fundingOutpoint?: string;
  releaseTxid?: string;
  refundTxid?: string;
}

export interface UsdcEscrowLeg {
  network: SettlementNetwork;
  contract: string;
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
  pearlEscrow: PearlEscrowLeg;
  usdcEscrow: UsdcEscrowLeg;
  createdAt: string;
  updatedAt: string;
}

export interface TradeEvent {
  tradeId: string;
  fromState: TradeState;
  toState: TradeState;
  source: 'system' | 'admin' | 'pearl_indexer' | 'arbitrum_indexer' | 'settlement_worker';
  sourceEventId: string;
  txHash?: string;
  outpoint?: string;
  confirmations?: number;
  observedAt: string;
  metadata?: Record<string, string | number | boolean | null>;
}

const ALLOWED_TRANSITIONS: Readonly<Record<TradeState, readonly TradeState[]>> = {
  quoted: ['quote_expired', 'pearl_escrow_pending', 'cancelled', 'disputed', 'failed_manual_review'],
  quote_expired: [],
  pearl_escrow_pending: ['pearl_escrow_seen', 'cancelled', 'disputed', 'failed_manual_review'],
  pearl_escrow_seen: ['pearl_escrow_confirmed', 'pearl_escrow_pending', 'disputed', 'failed_manual_review'],
  pearl_escrow_confirmed: ['usdc_escrow_pending', 'refund_available', 'disputed', 'failed_manual_review'],
  usdc_escrow_pending: ['usdc_escrow_confirmed', 'refund_available', 'disputed', 'failed_manual_review'],
  usdc_escrow_confirmed: ['release_pending', 'disputed', 'failed_manual_review'],
  release_pending: ['released', 'disputed', 'failed_manual_review'],
  released: [],
  refund_available: ['refund_pending', 'disputed', 'failed_manual_review'],
  refund_pending: ['refunded', 'disputed', 'failed_manual_review'],
  refunded: [],
  disputed: ['release_pending', 'refund_available', 'failed_manual_review'],
  cancelled: [],
  failed_manual_review: ['disputed'],
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
