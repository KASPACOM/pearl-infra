import type { EscrowWatchStatus } from './watch.js';

export interface EscrowProofLeg {
  txid?: string;
  outpoint?: string;
  confirmations: number;
  observedAt?: string;
}

export interface EscrowProof {
  tradeId: string;
  status: EscrowWatchStatus;
  address: string;
  expectedAmountGrains: string;
  requiredConfirmations: number;
  funding: EscrowProofLeg;
  spend?: EscrowProofLeg & {
    kind: 'release' | 'refund' | 'unknown';
  };
  reorgSafe: boolean;
  latestIndexedHeight: number;
  observedAt: string;
}

export function escrowFundingIsConfirmed(proof: Pick<EscrowProof, 'funding' | 'requiredConfirmations'>): boolean {
  return proof.funding.confirmations >= proof.requiredConfirmations;
}
