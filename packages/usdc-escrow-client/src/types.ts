export type UsdcEscrowStatus = 'created' | 'deposited' | 'released' | 'refunded' | 'cancelled';
export type UsdcEscrowNetwork = 'base' | 'base_sepolia';
export type UsdcEscrowChainId = 8453 | 84532;

export interface UsdcEscrowNetworkConfig {
  network: UsdcEscrowNetwork;
  chainId: UsdcEscrowChainId;
  usdcToken: string;
  escrowContract?: string;
  requiredConfirmations: number;
  blockExplorerUrl: string;
}

export interface UsdcEscrowTrade {
  tradeId: string;
  tradeKey: string;
  network: UsdcEscrowNetwork;
  chainId: UsdcEscrowChainId;
  buyer: string;
  seller: string;
  usdcToken: string;
  amountMicros: string;
  feeMicros: string;
  expiryUnixSeconds: number;
  status: UsdcEscrowStatus;
}

export interface UsdcEscrowObservation {
  network: UsdcEscrowNetwork;
  chainId: UsdcEscrowChainId;
  tradeKey: string;
  txHash: string;
  blockNumber: number;
  confirmations: number;
  eventName: UsdcEscrowEventName;
  observedAt: string;
}

export type UsdcEscrowEventName =
  | 'TradeCreated'
  | 'Deposited'
  | 'Released'
  | 'Refunded'
  | 'Cancelled'
  | 'Paused'
  | 'Unpaused';

export type UsdcEscrowTradeEventName = Exclude<UsdcEscrowEventName, 'Paused' | 'Unpaused'>;

export interface UsdcEscrowEventBase {
  network: UsdcEscrowNetwork;
  chainId: UsdcEscrowChainId;
  contractAddress: string;
  tradeKey: string;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  blockHash?: string;
  confirmations: number;
  observedAt: string;
}

export interface UsdcEscrowTradeCreatedEvent extends UsdcEscrowEventBase {
  eventName: 'TradeCreated';
  buyer: string;
  seller: string;
  amountMicros: string;
  feeMicros: string;
  expiryUnixSeconds: number;
}

export interface UsdcEscrowDepositedEvent extends UsdcEscrowEventBase {
  eventName: 'Deposited';
  payer: string;
  amountMicros: string;
}

export interface UsdcEscrowReleasedEvent extends UsdcEscrowEventBase {
  eventName: 'Released';
  seller: string;
  sellerAmountMicros: string;
  feeAmountMicros: string;
}

export interface UsdcEscrowRefundedEvent extends UsdcEscrowEventBase {
  eventName: 'Refunded';
  buyer: string;
  amountMicros: string;
}

export interface UsdcEscrowCancelledEvent extends UsdcEscrowEventBase {
  eventName: 'Cancelled';
}

export type UsdcEscrowTradeEvent =
  | UsdcEscrowTradeCreatedEvent
  | UsdcEscrowDepositedEvent
  | UsdcEscrowReleasedEvent
  | UsdcEscrowRefundedEvent
  | UsdcEscrowCancelledEvent;

export interface UsdcEscrowTradeEventState {
  network: UsdcEscrowNetwork;
  chainId: UsdcEscrowChainId;
  contractAddress: string;
  tradeKey: string;
  status: UsdcEscrowStatus;
  sourceEventId: string;
  lastEventName: UsdcEscrowTradeEventName;
  txHash: string;
  blockNumber: number;
  blockHash?: string;
  confirmations: number;
  observedAt: string;
  buyer?: string;
  seller?: string;
  payer?: string;
  amountMicros?: string;
  feeMicros?: string;
  expiryUnixSeconds?: number;
  sellerAmountMicros?: string;
  feeAmountMicros?: string;
  depositTxHash?: string;
  releaseTxHash?: string;
  refundTxHash?: string;
  cancelledTxHash?: string;
}
