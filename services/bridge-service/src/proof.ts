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
  eventId?: string;
  eventHash?: string;
  relayerAttestationCount?: number;
  relayerQuorumRequired?: number;
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
  eventId?: string;
  eventHash?: string;
  relayerAttestationCount?: number;
  relayerQuorumRequired?: number;
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
        ...(readString(watch?.metadata, 'canonical_event_id') ? { eventId: readString(watch?.metadata, 'canonical_event_id') } : {}),
        ...(readString(watch?.metadata, 'canonical_event_hash') ? { eventHash: readString(watch?.metadata, 'canonical_event_hash') } : {}),
        ...(readNumber(watch?.metadata, 'relayer_attestation_count') !== undefined
          ? { relayerAttestationCount: readNumber(watch?.metadata, 'relayer_attestation_count') }
          : {}),
        ...(readNumber(watch?.metadata, 'relayer_quorum_required') !== undefined
          ? { relayerQuorumRequired: readNumber(watch?.metadata, 'relayer_quorum_required') }
          : {}),
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
      ...(readString(exit.metadata, 'canonical_event_id') ? { eventId: readString(exit.metadata, 'canonical_event_id') } : {}),
      ...(readString(exit.metadata, 'canonical_event_hash') ? { eventHash: readString(exit.metadata, 'canonical_event_hash') } : {}),
      ...(readNumber(exit.metadata, 'relayer_attestation_count') !== undefined
        ? { relayerAttestationCount: readNumber(exit.metadata, 'relayer_attestation_count') }
        : {}),
      ...(readNumber(exit.metadata, 'relayer_quorum_required') !== undefined
        ? { relayerQuorumRequired: readNumber(exit.metadata, 'relayer_quorum_required') }
        : {}),
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

function readNumber(metadata: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = metadata?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return undefined;
}
