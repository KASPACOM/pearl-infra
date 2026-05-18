import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  createPearlEscrowSignerRequest,
  createPearlEscrowTxTemplateHash,
} from './broadcast.js';
import type {
  PearlEscrowPackage,
  PearlEscrowSideEffectAction,
  PearlEscrowSignerRequest,
  PearlEscrowSignerResponse,
  PearlEscrowUnsignedTx,
} from './types.js';

export type PearlSignerBoundaryDecisionAction = 'prepare_prl_release' | 'prepare_prl_refund';
export type PearlSignerRequestStatus = 'requested' | 'signed' | 'failed';
export type PearlSignerAuditStatus = 'requested' | 'signed' | 'failed';

export interface PearlSignerBoundaryPolicy {
  policyVersion: string;
  releaseFeeCapGrains: string;
  refundFeeCapGrains: string;
  signerKeyId: string;
  allowedSignerKeyIds: readonly string[];
  derivationPath?: string;
  paused?: boolean;
}

export interface PearlSignerBoundaryInput {
  escrow: PearlEscrowPackage;
  decisionAction: PearlSignerBoundaryDecisionAction;
  decisionEventId: string;
  unsignedTx: PearlEscrowUnsignedTx;
  destinationAddress: string;
  observedStateHash: string;
  expectedTxTemplateHash?: string;
  now?: Date;
}

export interface PearlSignerBoundaryResult {
  record: PearlSignerRequestRecord;
  created: boolean;
  signed: boolean;
}

export interface PearlSignerRequestRecord {
  requestId: string;
  idempotencyKey: string;
  request: PearlEscrowSignerRequest;
  status: PearlSignerRequestStatus;
  attempts: number;
  response?: PearlEscrowSignerResponse;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PearlSignerAuditRecord {
  auditId: string;
  requestId: string;
  idempotencyKey: string;
  tradeId: string;
  action: PearlEscrowSideEffectAction;
  fundingOutpoint: string;
  txTemplateHash: string;
  policyVersion: string;
  decisionEventId: string;
  derivationPath?: string;
  signerKeyId: string;
  status: PearlSignerAuditStatus;
  signedTxid?: string;
  error?: string;
  createdAt: string;
}

export interface PearlSignerRequestRepository {
  saveRequest(record: PearlSignerRequestRecord): Promise<{
    record: PearlSignerRequestRecord;
    created: boolean;
  }>;
  updateRequest(record: PearlSignerRequestRecord): Promise<PearlSignerRequestRecord>;
  findRequestByIdempotencyKey(idempotencyKey: string): Promise<PearlSignerRequestRecord | undefined>;
}

export interface PearlSignerAuditRepository {
  appendAudit(record: PearlSignerAuditRecord): Promise<void>;
}

export interface PearlSignerClient {
  sign(request: PearlEscrowSignerRequest): Promise<PearlEscrowSignerResponse>;
}

export class PearlSignerBoundary {
  constructor(
    private readonly input: {
      policy: PearlSignerBoundaryPolicy;
      requestRepository: PearlSignerRequestRepository;
      auditRepository: PearlSignerAuditRepository;
      signerClient: PearlSignerClient;
    },
  ) {}

  async requestSignature(input: PearlSignerBoundaryInput): Promise<PearlSignerBoundaryResult> {
    const now = input.now ?? new Date();
    const action = signerActionForDecision(input.decisionAction);
    assertPolicyCanSign(this.input.policy);
    assertTemplateHash(input);
    assertOutputPolicy(input.escrow, action, input.destinationAddress);

    const feeCapGrains = action === 'release'
      ? this.input.policy.releaseFeeCapGrains
      : this.input.policy.refundFeeCapGrains;
    const request = createPearlEscrowSignerRequest(
      {
        escrow: input.escrow,
        action,
        unsignedTx: input.unsignedTx,
        destinationAddress: input.destinationAddress,
        feeGrains: input.unsignedTx.feeGrains,
        feeCapGrains,
        policyVersion: this.input.policy.policyVersion,
        decisionEventId: input.decisionEventId,
        ...(this.input.policy.derivationPath ? { derivationPath: this.input.policy.derivationPath } : {}),
        signerKeyId: this.input.policy.signerKeyId,
        observedStateHash: input.observedStateHash,
      },
      now,
    );
    const requestRecord = createRequestRecord(request, now);
    const saved = await this.input.requestRepository.saveRequest(requestRecord);
    if (saved.created) {
      await this.input.auditRepository.appendAudit(createAuditRecord(saved.record, 'requested', now));
    }

    if (saved.record.status === 'signed') {
      return { record: saved.record, created: false, signed: true };
    }

    try {
      const response = await this.input.signerClient.sign(saved.record.request);
      assertSignerResponseMatchesRequest(response, saved.record.request);
      const signed = {
        ...saved.record,
        status: 'signed' as const,
        attempts: saved.record.attempts + 1,
        response,
        error: undefined,
        updatedAt: (input.now ?? new Date()).toISOString(),
      };
      const updated = await this.input.requestRepository.updateRequest(signed);
      await this.input.auditRepository.appendAudit(createAuditRecord(updated, 'signed', new Date(updated.updatedAt)));
      return { record: updated, created: saved.created, signed: true };
    } catch (error) {
      const failed = {
        ...saved.record,
        status: 'failed' as const,
        attempts: saved.record.attempts + 1,
        error: error instanceof Error ? error.message : String(error),
        updatedAt: (input.now ?? new Date()).toISOString(),
      };
      const updated = await this.input.requestRepository.updateRequest(failed);
      await this.input.auditRepository.appendAudit(createAuditRecord(updated, 'failed', new Date(updated.updatedAt)));
      throw error;
    }
  }
}

export class InMemoryPearlSignerRequestRepository implements PearlSignerRequestRepository {
  private readonly records = new Map<string, PearlSignerRequestRecord>();

  async saveRequest(record: PearlSignerRequestRecord): Promise<{
    record: PearlSignerRequestRecord;
    created: boolean;
  }> {
    const existing = this.records.get(record.idempotencyKey);
    if (existing) {
      return { record: existing, created: false };
    }
    this.records.set(record.idempotencyKey, record);
    return { record, created: true };
  }

  async updateRequest(record: PearlSignerRequestRecord): Promise<PearlSignerRequestRecord> {
    this.records.set(record.idempotencyKey, record);
    return record;
  }

  async findRequestByIdempotencyKey(idempotencyKey: string): Promise<PearlSignerRequestRecord | undefined> {
    return this.records.get(idempotencyKey);
  }
}

export class InMemoryPearlSignerAuditRepository implements PearlSignerAuditRepository {
  readonly records: PearlSignerAuditRecord[] = [];

  async appendAudit(record: PearlSignerAuditRecord): Promise<void> {
    this.records.push(record);
  }
}

export class JsonFilePearlSignerRequestRepository implements PearlSignerRequestRepository {
  constructor(private readonly filePath: string) {}

  async saveRequest(record: PearlSignerRequestRecord): Promise<{
    record: PearlSignerRequestRecord;
    created: boolean;
  }> {
    const records = await this.readRecords();
    const existing = records.find((candidate) => candidate.idempotencyKey === record.idempotencyKey);
    if (existing) {
      return { record: existing, created: false };
    }
    records.push(record);
    await this.writeRecords(records);
    return { record, created: true };
  }

  async updateRequest(record: PearlSignerRequestRecord): Promise<PearlSignerRequestRecord> {
    const records = await this.readRecords();
    const index = records.findIndex((candidate) => candidate.idempotencyKey === record.idempotencyKey);
    if (index === -1) {
      records.push(record);
    } else {
      records[index] = record;
    }
    await this.writeRecords(records);
    return record;
  }

  async findRequestByIdempotencyKey(idempotencyKey: string): Promise<PearlSignerRequestRecord | undefined> {
    return (await this.readRecords()).find((candidate) => candidate.idempotencyKey === idempotencyKey);
  }

  private async readRecords(): Promise<PearlSignerRequestRecord[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error('signer request store must contain a JSON array');
      }
      return parsed as PearlSignerRequestRecord[];
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }
  }

  private async writeRecords(records: PearlSignerRequestRecord[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
    await rename(tmpPath, this.filePath);
  }
}

export class JsonlPearlSignerAuditRepository implements PearlSignerAuditRepository {
  constructor(private readonly filePath: string) {}

  async appendAudit(record: PearlSignerAuditRecord): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(record)}\n`, 'utf8');
  }
}

function createRequestRecord(request: PearlEscrowSignerRequest, now: Date): PearlSignerRequestRecord {
  return {
    requestId: `pearl_signer_${sha256(request.idempotencyKey).slice(0, 24)}`,
    idempotencyKey: request.idempotencyKey,
    request,
    status: 'requested',
    attempts: 0,
    createdAt: request.createdAt,
    updatedAt: now.toISOString(),
  };
}

function createAuditRecord(
  record: PearlSignerRequestRecord,
  status: PearlSignerAuditStatus,
  now: Date,
): PearlSignerAuditRecord {
  return {
    auditId: `pearl_signer_audit_${sha256(`${record.requestId}:${status}:${record.attempts}:${now.toISOString()}`).slice(0, 24)}`,
    requestId: record.requestId,
    idempotencyKey: record.idempotencyKey,
    tradeId: record.request.tradeId,
    action: record.request.action,
    fundingOutpoint: record.request.fundingOutpoint,
    txTemplateHash: record.request.txTemplateHash,
    policyVersion: record.request.policyVersion,
    decisionEventId: record.request.decisionEventId,
    ...(record.request.derivationPath ? { derivationPath: record.request.derivationPath } : {}),
    signerKeyId: record.request.signerKeyId ?? '',
    status,
    ...(record.response?.signedTxid ? { signedTxid: record.response.signedTxid } : {}),
    ...(record.error ? { error: record.error } : {}),
    createdAt: now.toISOString(),
  };
}

function signerActionForDecision(action: PearlSignerBoundaryDecisionAction): PearlEscrowSideEffectAction {
  if (action === 'prepare_prl_release') {
    return 'release';
  }
  if (action === 'prepare_prl_refund') {
    return 'refund';
  }
  throw new Error(`unsupported signer decision action: ${action satisfies never}`);
}

function assertPolicyCanSign(policy: PearlSignerBoundaryPolicy): void {
  if (policy.paused) {
    throw new Error('Pearl signer boundary is paused');
  }
  assertNonEmpty(policy.policyVersion, 'policyVersion');
  assertNonEmpty(policy.signerKeyId, 'signerKeyId');
  assertNonNegativeIntegerString(policy.releaseFeeCapGrains, 'releaseFeeCapGrains');
  assertNonNegativeIntegerString(policy.refundFeeCapGrains, 'refundFeeCapGrains');
  if (!policy.allowedSignerKeyIds.includes(policy.signerKeyId)) {
    throw new Error(`signerKeyId is not allowed by custody policy: ${policy.signerKeyId}`);
  }
}

function assertTemplateHash(input: PearlSignerBoundaryInput): void {
  const actual = createPearlEscrowTxTemplateHash(input.unsignedTx);
  if (input.expectedTxTemplateHash && input.expectedTxTemplateHash !== actual) {
    throw new Error(`unsigned transaction template hash mismatch: ${actual} != ${input.expectedTxTemplateHash}`);
  }
}

function assertOutputPolicy(
  escrow: PearlEscrowPackage,
  action: PearlEscrowSideEffectAction,
  destinationAddress: string,
): void {
  const template = action === 'release' ? escrow.releaseTemplate : escrow.refundTemplate;
  if (template.outputs.length !== 1) {
    throw new Error(`${action} template must contain exactly one output`);
  }
  const output = template.outputs[0];
  const expectedRole = action === 'release' ? 'buyer' : 'refund';
  if (output?.role !== expectedRole) {
    throw new Error(`${action} output role must be ${expectedRole}`);
  }
  if (output.address !== destinationAddress) {
    throw new Error(`${action} destination does not match signer output policy`);
  }
}

function assertSignerResponseMatchesRequest(
  response: PearlEscrowSignerResponse,
  request: PearlEscrowSignerRequest,
): void {
  if (response.tradeId !== request.tradeId) {
    throw new Error('signer response tradeId does not match request');
  }
  if (response.action !== request.action) {
    throw new Error('signer response action does not match request');
  }
  if (response.idempotencyKey !== request.idempotencyKey) {
    throw new Error('signer response idempotencyKey does not match request');
  }
  if (request.signerKeyId && response.signerKeyId !== request.signerKeyId) {
    throw new Error('signer response signerKeyId does not match custody policy');
  }
  normalizeHex(response.signedTxHex, 'signedTxHex');
  normalizeTxid(response.signedTxid, 'signedTxid');
  if (Number.isNaN(new Date(response.signedAt).getTime())) {
    throw new Error('signer response signedAt must be an ISO timestamp');
  }
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim() === '') {
    throw new Error(`${field} is required`);
  }
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
  if (!/^[0-9a-fA-F]*$/.test(normalized) || normalized.length % 2 !== 0 || normalized.length === 0) {
    throw new Error(`${field} must be non-empty even-length hex`);
  }
  return normalized.toLowerCase();
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
