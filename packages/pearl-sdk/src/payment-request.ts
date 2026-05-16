export interface PearlPaymentRequest {
  network: 'mainnet' | 'testnet' | 'testnet2' | 'simnet' | 'regtest';
  recipientAddress: string;
  amountGrains: string;
  memo?: string;
  reference?: string;
  expiresAt?: string;
  callbackUrl?: string;
}

export interface PearlTransactionLifecycle {
  construct: 'pending' | 'complete' | 'failed';
  fund: 'pending' | 'complete' | 'failed';
  sign: 'pending' | 'complete' | 'failed';
  publish: 'pending' | 'complete' | 'failed';
  confirmations: number;
}
