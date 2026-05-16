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
