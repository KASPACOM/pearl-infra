import { createHash } from 'node:crypto';

export type BridgeEventKind = 'deposit' | 'exit';
export type BridgeAttestationQuorumStatus = 'approved' | 'wait' | 'manual_review';

export interface BridgeCanonicalEvent {
  eventId: string;
  eventHash: string;
  kind: BridgeEventKind;
  domain: string;
  payload: Record<string, string | number | boolean>;
  requiredConfirmations: number;
  observedConfirmations: number;
}

export interface BridgeDepositEventInput {
  pearlTxid: string;
  vout: number;
  amountGrains: string;
  igraRecipient: string;
  pearlNetwork: string;
  depositWatchId: string;
  requiredConfirmations: number;
  observedConfirmations: number;
}

export interface BridgeExitEventInput {
  exitId: string;
  igraBurnTxid: string;
  igraBurnLogIndex: number;
  igraBurnBlock: number;
  igraChainId: number;
  bridgeAddress: string;
  amountGrains: string;
  pearlRecipient: string;
  requiredConfirmations: number;
  observedConfirmations: number;
}

export interface BridgeRelayerAttestation {
  relayerId: string;
  eventId: string;
  eventHash: string;
  observedAt: string;
  signature?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface BridgeQuorumPolicy {
  relayerIds: readonly string[];
  requiredAttestations: number;
}

export interface BridgeAttestationQuorum {
  status: BridgeAttestationQuorumStatus;
  eventId: string;
  eventHash: string;
  requiredAttestations: number;
  validAttestationCount: number;
  relayerIds: string[];
  blockers: string[];
}

export function createDepositBridgeEvent(input: BridgeDepositEventInput): BridgeCanonicalEvent {
  assertNonEmpty(input.pearlTxid, 'pearlTxid');
  assertNonEmpty(input.amountGrains, 'amountGrains');
  assertNonEmpty(input.igraRecipient, 'igraRecipient');
  assertNonEmpty(input.pearlNetwork, 'pearlNetwork');
  assertNonEmpty(input.depositWatchId, 'depositWatchId');
  assertNonNegativeInteger(input.vout, 'vout');
  assertPositiveInteger(input.requiredConfirmations, 'requiredConfirmations');
  assertNonNegativeInteger(input.observedConfirmations, 'observedConfirmations');

  const payload = {
    amountGrains: input.amountGrains,
    depositWatchId: input.depositWatchId,
    igraRecipient: input.igraRecipient.toLowerCase(),
    pearlNetwork: input.pearlNetwork,
    pearlTxid: input.pearlTxid,
    vout: input.vout,
  };
  return createCanonicalEvent('deposit', payload, input.requiredConfirmations, input.observedConfirmations);
}

export function createExitBridgeEvent(input: BridgeExitEventInput): BridgeCanonicalEvent {
  assertNonEmpty(input.exitId, 'exitId');
  assertNonEmpty(input.igraBurnTxid, 'igraBurnTxid');
  assertNonEmpty(input.bridgeAddress, 'bridgeAddress');
  assertNonEmpty(input.amountGrains, 'amountGrains');
  assertNonEmpty(input.pearlRecipient, 'pearlRecipient');
  assertNonNegativeInteger(input.igraBurnLogIndex, 'igraBurnLogIndex');
  assertPositiveInteger(input.igraBurnBlock, 'igraBurnBlock');
  assertPositiveInteger(input.igraChainId, 'igraChainId');
  assertPositiveInteger(input.requiredConfirmations, 'requiredConfirmations');
  assertNonNegativeInteger(input.observedConfirmations, 'observedConfirmations');

  const payload = {
    amountGrains: input.amountGrains,
    bridgeAddress: input.bridgeAddress.toLowerCase(),
    exitId: input.exitId,
    igraBurnBlock: input.igraBurnBlock,
    igraBurnLogIndex: input.igraBurnLogIndex,
    igraBurnTxid: input.igraBurnTxid.toLowerCase(),
    igraChainId: input.igraChainId,
    pearlRecipient: input.pearlRecipient,
  };
  return createCanonicalEvent('exit', payload, input.requiredConfirmations, input.observedConfirmations);
}

export function evaluateBridgeAttestationQuorum(input: {
  event: BridgeCanonicalEvent;
  attestations: readonly BridgeRelayerAttestation[];
  policy: BridgeQuorumPolicy;
}): BridgeAttestationQuorum {
  const policyBlockers = validateQuorumPolicy(input.policy);
  const authorizedRelayers = new Set(input.policy.relayerIds);
  const validByRelayer = new Map<string, BridgeRelayerAttestation>();
  const blockers = [...policyBlockers];

  if (input.event.observedConfirmations < input.event.requiredConfirmations) {
    blockers.push('event_finality_not_reached');
  }

  for (const attestation of input.attestations) {
    if (!authorizedRelayers.has(attestation.relayerId)) {
      blockers.push(`unknown_relayer:${attestation.relayerId}`);
      continue;
    }
    if (attestation.eventId !== input.event.eventId) {
      blockers.push(`attestation_event_id_mismatch:${attestation.relayerId}`);
      continue;
    }
    if (attestation.eventHash !== input.event.eventHash) {
      blockers.push(`attestation_event_hash_mismatch:${attestation.relayerId}`);
      continue;
    }
    if (validByRelayer.has(attestation.relayerId)) {
      blockers.push(`duplicate_attestation:${attestation.relayerId}`);
      continue;
    }
    validByRelayer.set(attestation.relayerId, attestation);
  }

  const relayerIds = [...validByRelayer.keys()].sort();
  const uniqueBlockers = [...new Set(blockers)].sort();
  const status = uniqueBlockers.some(isManualReviewBlocker)
    ? 'manual_review'
    : uniqueBlockers.length > 0 || relayerIds.length < input.policy.requiredAttestations
      ? 'wait'
      : 'approved';

  return {
    status,
    eventId: input.event.eventId,
    eventHash: input.event.eventHash,
    requiredAttestations: input.policy.requiredAttestations,
    validAttestationCount: relayerIds.length,
    relayerIds,
    blockers: uniqueBlockers,
  };
}

function createCanonicalEvent(
  kind: BridgeEventKind,
  payload: Record<string, string | number | boolean>,
  requiredConfirmations: number,
  observedConfirmations: number,
): BridgeCanonicalEvent {
  const domain = `pearl-igra-bridge:v1:${kind}`;
  const eventHash = sha256(stableJson({ domain, payload }));
  const eventId = sha256(stableJson({ domain, key: eventIdKey(kind, payload) }));
  return {
    eventId,
    eventHash,
    kind,
    domain,
    payload,
    requiredConfirmations,
    observedConfirmations,
  };
}

function eventIdKey(kind: BridgeEventKind, payload: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
  if (kind === 'deposit') {
    return {
      pearlNetwork: payload.pearlNetwork,
      pearlTxid: payload.pearlTxid,
      vout: payload.vout,
    };
  }
  return {
    exitId: payload.exitId,
    igraBurnLogIndex: payload.igraBurnLogIndex,
    igraBurnTxid: payload.igraBurnTxid,
    igraChainId: payload.igraChainId,
  };
}

function validateQuorumPolicy(policy: BridgeQuorumPolicy): string[] {
  const blockers: string[] = [];
  const uniqueRelayers = new Set(policy.relayerIds);
  if (policy.relayerIds.length === 0) blockers.push('relayer_set_required');
  if (uniqueRelayers.size !== policy.relayerIds.length) blockers.push('relayer_set_has_duplicates');
  if (!Number.isInteger(policy.requiredAttestations) || policy.requiredAttestations <= 0) {
    blockers.push('quorum_required_attestations_invalid');
  }
  if (policy.requiredAttestations > uniqueRelayers.size) {
    blockers.push('quorum_exceeds_relayer_set');
  }
  return blockers;
}

function isManualReviewBlocker(blocker: string): boolean {
  return blocker !== 'event_finality_not_reached';
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return `0x${createHash('sha256').update(value).digest('hex')}`;
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim() === '') throw new Error(`${field} is required`);
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${field} must be a positive integer`);
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer`);
}
