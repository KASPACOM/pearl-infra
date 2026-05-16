export type UsdcEscrowStatus = 'created' | 'deposited' | 'released' | 'refunded' | 'cancelled';

export interface UsdcEscrowTrade {
  tradeId: string;
  tradeKey: string;
  buyer: string;
  seller: string;
  usdcToken: string;
  amountMicros: string;
  feeMicros: string;
  expiryUnixSeconds: number;
  status: UsdcEscrowStatus;
}

export interface UsdcEscrowObservation {
  tradeKey: string;
  txHash: string;
  blockNumber: number;
  confirmations: number;
  eventName: UsdcEscrowEventName;
  observedAt: string;
}

export type UsdcEscrowEventName = 'TradeCreated' | 'Deposited' | 'Released' | 'Refunded' | 'Cancelled';
