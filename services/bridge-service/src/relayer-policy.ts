import { createHash } from 'node:crypto';

import type { BridgeAttestationQuorum } from './attestations.js';
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
  attestationQuorum?: BridgeAttestationQuorum;
  manualApprovalId?: string;
}

export interface ExitReleaseDecisionInput {
  exit: BridgeExitRequest;
  reconciliation: BridgeReconciliationSnapshot;
  limits: BridgePilotLimits;
  attestationQuorum?: BridgeAttestationQuorum;
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
  const quorumDecision = getAttestationQuorumDecision(input.attestationQuorum, 'mint');
  if (quorumDecision) {
    return decision(quorumDecision.action, quorumDecision.reason, sourceIds, quorumDecision.metadata);
  }
  if (!input.attestationQuorum) throw new Error('approved mint quorum missing');
  const approvedQuorum = input.attestationQuorum;
  if (!input.manualApprovalId) {
    return decision('wait', 'manual operator approval is required before mint', sourceIds);
  }
  return decision('prepare_mint', 'confirmed Pearl deposit is approved for wPRL mint', sourceIds, {
    amountGrains: input.observation.amountGrains,
    approvalId: input.manualApprovalId,
    eventHash: approvedQuorum.eventHash,
    eventId: approvedQuorum.eventId,
    relayerAttestations: approvedQuorum.validAttestationCount,
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
  const quorumDecision = getAttestationQuorumDecision(input.attestationQuorum, 'release');
  if (quorumDecision) {
    return decision(quorumDecision.action, quorumDecision.reason, sourceIds, quorumDecision.metadata);
  }
  if (!input.attestationQuorum) throw new Error('approved release quorum missing');
  const approvedQuorum = input.attestationQuorum;
  if (!input.manualApprovalId) {
    return decision('wait', 'manual operator approval is required before Pearl release', sourceIds);
  }
  return decision('prepare_exit_release', 'pending Igra exit is approved for Pearl reserve release', sourceIds, {
    amountGrains: input.exit.requestedAmountGrains,
    approvalId: input.manualApprovalId,
    eventHash: approvedQuorum.eventHash,
    eventId: approvedQuorum.eventId,
    relayerAttestations: approvedQuorum.validAttestationCount,
  });
}

function getAttestationQuorumDecision(
  quorum: BridgeAttestationQuorum | undefined,
  action: 'mint' | 'release',
): { action: BridgeRelayerDecision['action']; reason: string; metadata?: BridgeRelayerDecision['metadata'] } | undefined {
  if (!quorum) {
    return {
      action: 'wait',
      reason: `relayer quorum attestations are required before ${action}`,
    };
  }
  if (quorum.status === 'manual_review') {
    return {
      action: 'manual_review',
      reason: `relayer quorum is blocked: ${quorum.blockers.join(', ')}`,
      metadata: {
        eventHash: quorum.eventHash,
        eventId: quorum.eventId,
        relayerAttestations: quorum.validAttestationCount,
      },
    };
  }
  if (quorum.status === 'wait') {
    return {
      action: 'wait',
      reason: `waiting for relayer quorum attestations: ${quorum.validAttestationCount}/${quorum.requiredAttestations}`,
      metadata: {
        eventHash: quorum.eventHash,
        eventId: quorum.eventId,
        relayerAttestations: quorum.validAttestationCount,
      },
    };
  }
  return undefined;
}

function getDepositBlocker(input: DepositMintDecisionInput): string | undefined {
  const observation = input.observation;
  if (!observation) return undefined;
  if (input.watch.purpose !== 'bridge_deposit') return 'watch is not a bridge deposit watch';
  if (observation.watchId !== input.watch.watchId) return 'deposit observation does not belong to watch';
  if (!input.watch.observations.some((candidate) => candidate.outpoint === observation.outpoint)) {
    return 'deposit observation is not in watch history';
  }
  const liveObservations = input.watch.observations.filter((candidate) => candidate.matchStatus !== 'detached');
  if (liveObservations.length > 1) return 'multiple live deposit observations require operator review';
  if (observation.matchStatus === 'detached' || observation.classification === 'reorged') return 'deposit observation reorged';
  if (observation.classification === 'late') return 'deposit arrived after expiry';
  if (observation.classification === 'underpaid') return 'deposit is below expected minimum';
  if (observation.classification === 'duplicate') return 'duplicate deposit requires operator review';
  if (observation.classification !== 'on_time') return `deposit classification requires operator review: ${observation.classification}`;
  if (observation.matchStatus === 'spent') return 'deposit outpoint already spent/consumed';
  if (observation.confirmations < input.watch.requiredConfirmations) return 'deposit does not have enough confirmations';
  const amount = BigInt(observation.amountGrains);
  const expectedMin = readString(input.watch.metadata, 'expected_amount_min_grains');
  const expectedMax = readString(input.watch.metadata, 'expected_amount_max_grains');
  if (!expectedMin || !expectedMax) return 'deposit watch is missing expected amount bounds';
  if (amount < BigInt(expectedMin)) return 'deposit below expected minimum';
  if (amount > BigInt(expectedMax)) return 'deposit above expected maximum';
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

function readString(metadata: Record<string, unknown> | null | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function decision(
  action: BridgeRelayerDecision['action'],
  reason: string,
  sourceIds: string[],
  metadata?: BridgeRelayerDecision['metadata'],
): BridgeRelayerDecision {
  const idempotencyKey = ['bridge', action, sourceIds.join('+'), sha256(`${reason}:${stableMetadata(metadata)}`)].join(':');
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

function stableMetadata(metadata: BridgeRelayerDecision['metadata'] | undefined): string {
  if (!metadata) return '';
  return JSON.stringify(Object.fromEntries(Object.entries(metadata).sort(([left], [right]) => left.localeCompare(right))));
}
