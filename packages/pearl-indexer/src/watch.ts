export type EscrowWatchStatus =
  | 'watching'
  | 'seen'
  | 'confirmed'
  | 'spent_release'
  | 'spent_refund'
  | 'reorged'
  | 'expired';

export interface EscrowWatch {
  tradeId: string;
  network: 'mainnet' | 'testnet' | 'testnet2' | 'simnet' | 'regtest';
  address: string;
  expectedAmountGrains: string;
  requiredConfirmations: number;
  status: EscrowWatchStatus;
  fundingOutpoint?: string;
  releaseTxid?: string;
  refundTxid?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterEscrowWatchRequest {
  tradeId: string;
  network: EscrowWatch['network'];
  address: string;
  expectedAmountGrains: string;
  requiredConfirmations: number;
}

export function createEscrowWatch(request: RegisterEscrowWatchRequest, now = new Date()): EscrowWatch {
  const timestamp = now.toISOString();
  return {
    ...request,
    status: 'watching',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
