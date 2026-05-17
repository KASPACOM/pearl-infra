export type WatchPurpose = 'otc_escrow' | 'bridge_deposit' | 'bridge_reserve';

export type WatchStatus = 'active' | 'closed';

export type PearlNetwork = 'mainnet' | 'testnet' | 'testnet2' | 'simnet' | 'regtest';

export type ObservationMatchStatus = 'pending' | 'confirmed' | 'spent' | 'detached';

export interface RegisterWatchInput {
  watchId: string;
  purpose: WatchPurpose;
  network: PearlNetwork;
  address: string;
  requiredConfirmations: number;
  metadata?: Record<string, unknown>;
}

export interface WatchedAddress {
  watchId: string;
  purpose: WatchPurpose;
  network: PearlNetwork;
  address: string;
  requiredConfirmations: number;
  status: WatchStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AddressObservation {
  outpoint: string;
  watchId: string;
  blockHash: string;
  height: number;
  amountGrains: string;
  confirmations: number;
  matchStatus: ObservationMatchStatus;
  observedAt: string;
}

export interface AddressSpend {
  spendTxid: string;
  spentOutpoint: string;
  blockHash: string;
  height: number;
  classification: string;
  classificationData: Record<string, unknown> | null;
  observedAt: string;
}

export interface WatchedAddressWithHistory extends WatchedAddress {
  observations: AddressObservation[];
  spends: AddressSpend[];
}
