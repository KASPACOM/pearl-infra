import type { BridgeExitRequest, WatchedBridgeAddressWithHistory } from './types.js';
import type { BridgeDepositReconciliationRow, BridgeReconciliationSnapshot } from './reconciliation.js';

export interface BridgeDepositStatusProof {
  depositId: string;
  status: BridgeDepositReconciliationRow['status'];
  pearlAddress: string;
  pearlOutpoint?: string;
  amountGrains?: string;
  confirmations: number;
  blockers: string[];
  mintTxHash?: string;
  igraRecipient?: string;
}

export interface BridgeExitStatusProof {
  exitId: string;
  status: BridgeExitRequest['status'];
  igraBurnTxid: string;
  igraBurnLogIndex: number;
  amountGrains: string;
  pearlRecipient: string;
  pearlReleaseTxid?: string;
  blockers: string[];
}

export interface BridgeReserveBackingProof {
  mintedSupplyGrains: string;
  confirmedReserveGrains: string;
  knownReserveSpendGrains: string;
  pendingExitGrains: string;
  reserveAvailableGrains: string;
  reserveSurplusGrains: string;
  reserveDeficitGrains: string;
  unknownReserveSpendCount: number;
  staleWatchIds: string[];
  blockers: string[];
}

export interface BridgePublicProof {
  observedAt: string;
  deposits: BridgeDepositStatusProof[];
  exits: BridgeExitStatusProof[];
  reserveBacking: BridgeReserveBackingProof;
}

export function createBridgePublicProof(input: {
  reconciliation: BridgeReconciliationSnapshot;
  depositWatches: readonly WatchedBridgeAddressWithHistory[];
  exits: readonly BridgeExitRequest[];
}): BridgePublicProof {
  return {
    observedAt: input.reconciliation.observedAt,
    deposits: input.reconciliation.deposits.map((deposit) => {
      const watch = input.depositWatches.find((candidate) => candidate.watchId === deposit.depositId);
      return {
        depositId: deposit.depositId,
        status: deposit.status,
        pearlAddress: deposit.address,
        ...(deposit.outpoint ? { pearlOutpoint: deposit.outpoint } : {}),
        ...(deposit.amountGrains ? { amountGrains: deposit.amountGrains } : {}),
        confirmations: deposit.confirmations,
        blockers: deposit.blockers,
        ...(readString(watch?.metadata, 'igra_mint_tx_hash') ? { mintTxHash: readString(watch?.metadata, 'igra_mint_tx_hash') } : {}),
        ...(readString(watch?.metadata, 'igra_recipient') ? { igraRecipient: readString(watch?.metadata, 'igra_recipient') } : {}),
      };
    }),
    exits: input.exits.map((exit) => ({
      exitId: exit.exitId,
      status: exit.status,
      igraBurnTxid: exit.igraBurnTxid,
      igraBurnLogIndex: exit.igraBurnLogIndex,
      amountGrains: exit.requestedAmountGrains,
      pearlRecipient: exit.pearlRecipient,
      ...(exit.pearlReleaseTxid ? { pearlReleaseTxid: exit.pearlReleaseTxid } : {}),
      blockers: exit.status === 'pending' && input.reconciliation.blockers.length > 0
        ? input.reconciliation.blockers
        : [],
    })),
    reserveBacking: {
      mintedSupplyGrains: input.reconciliation.mintedSupplyGrains,
      confirmedReserveGrains: input.reconciliation.confirmedReserveGrains,
      knownReserveSpendGrains: input.reconciliation.knownReserveSpendGrains,
      pendingExitGrains: input.reconciliation.pendingExitGrains,
      reserveAvailableGrains: input.reconciliation.reserveAvailableGrains,
      reserveSurplusGrains: input.reconciliation.reserveSurplusGrains,
      reserveDeficitGrains: input.reconciliation.reserveDeficitGrains,
      unknownReserveSpendCount: input.reconciliation.unknownReserveSpendCount,
      staleWatchIds: input.reconciliation.staleWatchIds,
      blockers: input.reconciliation.blockers,
    },
  };
}

function readString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
