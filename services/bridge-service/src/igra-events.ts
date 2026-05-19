import { createHash } from 'node:crypto';

import type { BridgeExitRequestRepository } from './repository.js';
import type { BridgeExitRequest, IgraBridgeEvent, IgraBridgeEventType } from './types.js';

export interface MirrorIgraBridgeEventInput {
  eventType: IgraBridgeEventType;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  chainId: number;
  payload: Record<string, string | number | boolean | null>;
  observedAt?: string;
}

export function mirrorIgraBridgeEvent(input: MirrorIgraBridgeEventInput): IgraBridgeEvent {
  assertNonEmpty(input.txHash, 'txHash');
  assertNonNegativeInteger(input.logIndex, 'logIndex');
  assertPositiveInteger(input.blockNumber, 'blockNumber');
  assertPositiveInteger(input.chainId, 'chainId');
  return {
    eventId: formatIgraEventId(input.chainId, input.txHash, input.logIndex),
    eventType: input.eventType,
    txHash: input.txHash.toLowerCase(),
    logIndex: input.logIndex,
    blockNumber: input.blockNumber,
    chainId: input.chainId,
    payload: input.payload,
    observedAt: input.observedAt ?? new Date().toISOString(),
  };
}

export function bridgeExitFromIgraEvent(event: IgraBridgeEvent, now = new Date()): BridgeExitRequest | undefined {
  if (event.eventType !== 'exit_requested') return undefined;
  const exitId = readString(event.payload, 'exitId');
  const requestedAmountGrains = readString(event.payload, 'amountGrains');
  const pearlRecipient = readString(event.payload, 'pearlRecipient');
  if (!exitId || !requestedAmountGrains || !pearlRecipient) {
    throw new Error('exit_requested event requires exitId, amountGrains, and pearlRecipient');
  }
  return {
    exitId,
    igraBurnTxid: event.txHash,
    igraBurnLogIndex: event.logIndex,
    igraBurnBlock: event.blockNumber,
    igraChainId: event.chainId,
    requestedAmountGrains,
    pearlRecipient,
    status: 'pending',
    metadata: {
      mirrored_event_id: event.eventId,
      requester: readString(event.payload, 'requester') ?? null,
    },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function applyExitLifecycleEvent(existing: BridgeExitRequest, event: IgraBridgeEvent, now = new Date()): BridgeExitRequest {
  if (event.eventType === 'exit_processed') {
    const pearlReleaseTxid = readString(event.payload, 'pearlReleaseTxid');
    if (!pearlReleaseTxid) throw new Error('exit_processed event requires pearlReleaseTxid');
    return {
      ...existing,
      status: 'released',
      pearlReleaseTxid,
      pearlReleaseBlock: readNumber(event.payload, 'pearlReleaseBlock'),
      releasedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      metadata: {
        ...(existing.metadata ?? {}),
        processed_event_id: event.eventId,
      },
    };
  }
  if (event.eventType === 'exit_refunded') {
    return {
      ...existing,
      status: 'refunded',
      updatedAt: now.toISOString(),
      metadata: {
        ...(existing.metadata ?? {}),
        refunded_event_id: event.eventId,
      },
    };
  }
  return existing;
}

export interface ApplyIgraBridgeEventResult {
  eventId: string;
  action: 'ignored' | 'exit_created' | 'exit_updated' | 'exit_missing';
  exit?: BridgeExitRequest;
}

export async function applyIgraBridgeEventToExitRepository(
  repository: BridgeExitRequestRepository,
  event: IgraBridgeEvent,
  now = new Date(),
): Promise<ApplyIgraBridgeEventResult> {
  const requested = bridgeExitFromIgraEvent(event, now);
  if (requested) {
    const saved = await repository.upsertExitRequest(requested);
    return {
      eventId: event.eventId,
      action: saved.created ? 'exit_created' : 'exit_updated',
      exit: saved.exit,
    };
  }

  if (event.eventType !== 'exit_processed' && event.eventType !== 'exit_refunded') {
    return { eventId: event.eventId, action: 'ignored' };
  }

  const exitId = readString(event.payload, 'exitId');
  if (!exitId) throw new Error(`${event.eventType} event requires exitId`);
  const existing = await repository.findExitRequest(exitId);
  if (!existing) return { eventId: event.eventId, action: 'exit_missing' };

  const updated = applyExitLifecycleEvent(existing, event, now);
  const saved = await repository.upsertExitRequest(updated);
  return { eventId: event.eventId, action: 'exit_updated', exit: saved.exit };
}

export function formatIgraEventId(chainId: number, txHash: string, logIndex: number): string {
  return ['igra', chainId, txHash.toLowerCase(), logIndex].join(':');
}

export function stableDecisionId(prefix: string, fields: Record<string, string | number | boolean | null>): string {
  return `${prefix}:${createHash('sha256').update(stableJson(fields)).digest('hex').slice(0, 24)}`;
}

function readString(payload: Record<string, string | number | boolean | null>, key: string): string | undefined {
  const value = payload[key];
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function readNumber(payload: Record<string, string | number | boolean | null>, key: string): number | undefined {
  const value = payload[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
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
