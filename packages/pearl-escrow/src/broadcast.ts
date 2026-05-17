import { createHash } from 'node:crypto';

import type {
  PearlEscrowBroadcastAttempt,
  PearlEscrowSignerPolicyInput,
  PearlEscrowSignerRequest,
  PearlEscrowSignerResponse,
  PearlEscrowUnsignedTx,
} from './types.js';

export function createPearlEscrowSignerRequest(
  input: PearlEscrowSignerPolicyInput,
  now: Date = new Date(),
): PearlEscrowSignerRequest {
  assertUnsignedTxMatchesPolicy(input);
  assertFeeWithinCap(input.feeGrains, input.feeCapGrains);
  assertDestination(input);

  const txTemplateHash = createPearlEscrowTxTemplateHash(input.unsignedTx);
  return {
    tradeId: input.escrow.tradeId,
    action: input.action,
    network: input.escrow.network,
    fundingOutpoint: input.unsignedTx.inputOutpoint,
    unsignedTxHex: input.unsignedTx.unsignedTxHex,
    txTemplateHash,
    policyVersion: input.policyVersion,
    decisionEventId: input.decisionEventId,
    idempotencyKey: createPearlEscrowIdempotencyKey({
      tradeId: input.escrow.tradeId,
      action: input.action,
      fundingOutpoint: input.unsignedTx.inputOutpoint,
      txTemplateHash,
    }),
    ...(input.derivationPath ? { derivationPath: input.derivationPath } : {}),
    ...(input.signerKeyId ? { signerKeyId: input.signerKeyId } : {}),
    expected: {
      destinationAddress: input.destinationAddress,
      feeGrains: input.feeGrains,
      feeCapGrains: input.feeCapGrains,
      outputAmountGrains: input.unsignedTx.outputAmountGrains,
      observedStateHash: input.observedStateHash,
    },
    createdAt: now.toISOString(),
  };
}

function assertUnsignedTxMatchesPolicy(input: PearlEscrowSignerPolicyInput): void {
  if (input.unsignedTx.kind !== input.action) {
    throw new Error(`unsigned transaction kind does not match signer action: ${input.unsignedTx.kind} != ${input.action}`);
  }
  if (input.unsignedTx.feeGrains !== input.feeGrains) {
    throw new Error(`unsigned transaction fee does not match signer policy: ${input.unsignedTx.feeGrains} != ${input.feeGrains}`);
  }
}

export function createPearlEscrowBroadcastAttempt(
  response: PearlEscrowSignerResponse,
  attempt: number,
  now: Date = new Date(),
): PearlEscrowBroadcastAttempt {
  if (!Number.isInteger(attempt) || attempt <= 0) {
    throw new Error('attempt must be a positive integer');
  }
  return {
    tradeId: response.tradeId,
    action: response.action,
    idempotencyKey: response.idempotencyKey,
    status: 'signed',
    attempt,
    signedTxid: normalizeTxid(response.signedTxid, 'signedTxid'),
    signedTxHex: normalizeHex(response.signedTxHex, 'signedTxHex'),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function markPearlEscrowBroadcastSubmitted(
  attempt: PearlEscrowBroadcastAttempt,
  broadcastTxid: string,
  now: Date = new Date(),
): PearlEscrowBroadcastAttempt {
  return {
    ...attempt,
    status: 'submitted',
    broadcastTxid: normalizeTxid(broadcastTxid, 'broadcastTxid'),
    updatedAt: now.toISOString(),
  };
}

export function markPearlEscrowBroadcastFailed(
  attempt: PearlEscrowBroadcastAttempt,
  error: string,
  input: { nextRetryAt?: string; now?: Date } = {},
): PearlEscrowBroadcastAttempt {
  return {
    ...attempt,
    status: 'failed',
    error,
    ...(input.nextRetryAt ? { nextRetryAt: input.nextRetryAt } : {}),
    updatedAt: (input.now ?? new Date()).toISOString(),
  };
}

export function createPearlEscrowTxTemplateHash(unsignedTx: PearlEscrowUnsignedTx): string {
  return `sha256:${sha256Json({
    kind: unsignedTx.kind,
    unsignedTxHex: normalizeHex(unsignedTx.unsignedTxHex, 'unsignedTxHex'),
    inputOutpoint: unsignedTx.inputOutpoint,
    inputAmountGrains: unsignedTx.inputAmountGrains,
    outputAmountGrains: unsignedTx.outputAmountGrains,
    feeGrains: unsignedTx.feeGrains,
    lockTime: unsignedTx.lockTime,
  })}`;
}

export function createPearlEscrowObservedStateHash(value: Record<string, unknown>): string {
  return `sha256:${sha256Json(canonicalize(value))}`;
}

export function createPearlEscrowIdempotencyKey(input: {
  tradeId: string;
  action: PearlEscrowSignerRequest['action'];
  fundingOutpoint: string;
  txTemplateHash: string;
}): string {
  return [
    'pearl',
    input.tradeId,
    input.action,
    input.fundingOutpoint,
    input.txTemplateHash,
  ].join(':');
}

function assertFeeWithinCap(feeGrains: string, feeCapGrains: string): void {
  assertNonNegativeIntegerString(feeGrains, 'feeGrains');
  assertNonNegativeIntegerString(feeCapGrains, 'feeCapGrains');
  if (BigInt(feeGrains) > BigInt(feeCapGrains)) {
    throw new Error(`feeGrains exceeds feeCapGrains: ${feeGrains} > ${feeCapGrains}`);
  }
}

function assertDestination(input: PearlEscrowSignerPolicyInput): void {
  const template = input.action === 'release' ? input.escrow.releaseTemplate : input.escrow.refundTemplate;
  const output = template.outputs[0];
  if (!output || output.address !== input.destinationAddress) {
    throw new Error(`${input.action} destination does not match escrow template`);
  }
}

function sha256Json(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function assertNonNegativeIntegerString(value: string, field: string): void {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${field} must be a non-negative integer string`);
  }
}

function normalizeTxid(value: string, field: string): string {
  const normalized = normalizeHex(value, field);
  if (normalized.length !== 64) {
    throw new Error(`${field} must be 32-byte hex`);
  }
  return normalized;
}

function normalizeHex(value: string, field: string): string {
  const normalized = value.startsWith('0x') ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]*$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error(`${field} must be even-length hex`);
  }
  return normalized.toLowerCase();
}
