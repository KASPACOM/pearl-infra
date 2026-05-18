import { createHash } from 'node:crypto';

import type {
  BridgeAddressObservation,
  BridgeExitRequest,
  BridgePilotLimits,
  BridgeRelayerDecision,
  WatchedBridgeAddressWithHistory,
} from './types.js';
import type { BridgeReconciliationSnapshot } from './reconciliation.js';

export interface DepositMintDecisionInput {
  watch: WatchedBridgeAddressWithHistory;
  observation?: BridgeAddressObservation;
  limits: BridgePilotLimits;
  mintedSupplyGrains: string;
  manualApprovalId?: string;
}

export interface ExitReleaseDecisionInput {
  exit: BridgeExitRequest;
  reconciliation: BridgeReconciliationSnapshot;
  limits: BridgePilotLimits;
  manualApprovalId?: string;
}

export function decideDepositMint(input: DepositMintDecisionInput): BridgeRelayerDecision {
  const sourceIds = [input.watch.watchId, input.observation?.outpoint].filter((value): value is string => Boolean(value)).sort();
  const reason = getDepositBlocker(input);
  if (reason) {
    return decision('manual_review', reason, sourceIds, {
      watchId: input.watch.watchId,
      outpoint: input.observation?.outpoint ?? null,
    });
  }
  if (!input.observation || input.observation.matchStatus !== 'confirmed') {
    return decision('wait', 'deposit does not have enough confirmations', sourceIds);
  }
  if (!input.manualApprovalId) {
    return decision('wait', 'manual federation approval is required before mint', sourceIds);
  }
  return decision('prepare_mint', 'confirmed Pearl deposit is approved for wPRL mint', sourceIds, {
    amountGrains: input.observation.amountGrains,
    approvalId: input.manualApprovalId,
  });
}

export function decideExitRelease(input: ExitReleaseDecisionInput): BridgeRelayerDecision {
  const sourceIds = [input.exit.exitId, input.exit.igraBurnTxid, input.exit.pearlReleaseTxid].filter((value): value is string => Boolean(value)).sort();
  if (input.exit.status === 'released' && input.exit.pearlReleaseTxid) {
    return decision('mark_exit_released', 'Pearl release already recorded for exit', sourceIds);
  }
  if (input.exit.status !== 'pending') {
    return decision('wait', `exit is not pending: ${input.exit.status}`, sourceIds);
  }
  if (input.reconciliation.blockers.length > 0) {
    return decision('manual_review', `bridge reconciliation is blocked: ${input.reconciliation.blockers.join(', ')}`, sourceIds);
  }
  if (BigInt(input.exit.requestedAmountGrains) > BigInt(input.limits.maxExitGrains)) {
    return decision('manual_review', 'exit exceeds max exit cap', sourceIds);
  }
  if (BigInt(input.exit.requestedAmountGrains) > BigInt(input.reconciliation.reserveAvailableGrains)) {
    return decision('manual_review', 'exit exceeds available Pearl reserves', sourceIds);
  }
  if (!input.manualApprovalId) {
    return decision('wait', 'manual federation approval is required before Pearl release', sourceIds);
  }
  return decision('prepare_exit_release', 'pending Igra exit is approved for Pearl reserve release', sourceIds, {
    amountGrains: input.exit.requestedAmountGrains,
    approvalId: input.manualApprovalId,
  });
}

function getDepositBlocker(input: DepositMintDecisionInput): string | undefined {
  const observation = input.observation;
  if (!observation) return undefined;
  if (observation.matchStatus === 'detached' || observation.classification === 'reorged') return 'deposit observation reorged';
  if (observation.classification === 'late') return 'deposit arrived after expiry';
  if (observation.classification === 'underpaid') return 'deposit is below expected minimum';
  if (observation.classification === 'duplicate') return 'duplicate deposit requires operator review';
  if (observation.matchStatus === 'spent') return 'deposit outpoint already spent/consumed';
  const amount = BigInt(observation.amountGrains);
  if (amount < BigInt(input.limits.minDepositGrains)) return 'deposit below pilot minimum';
  if (amount > BigInt(input.limits.maxDepositGrains)) return 'deposit above pilot maximum';
  if (BigInt(input.mintedSupplyGrains) + amount > BigInt(input.limits.pilotSupplyCapGrains)) return 'pilot supply cap would be exceeded';
  if (
    input.limits.rollingWindowCapGrains &&
    BigInt(input.limits.rollingWindowUsedGrains ?? '0') + amount > BigInt(input.limits.rollingWindowCapGrains)
  ) {
    return 'rolling mint cap would be exceeded';
  }
  return undefined;
}

function decision(
  action: BridgeRelayerDecision['action'],
  reason: string,
  sourceIds: string[],
  metadata?: BridgeRelayerDecision['metadata'],
): BridgeRelayerDecision {
  const idempotencyKey = ['bridge', action, sourceIds.join('+'), sha256(reason)].join(':');
  return {
    action,
    reason,
    idempotencyKey,
    sourceIds,
    ...(metadata ? { metadata } : {}),
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}
