import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  createPearlEscrowBroadcastAttempt,
  createPearlEscrowObservedStateHash,
  createPearlEscrowTxTemplateHash,
  createPearlEscrowUnsignedTx,
  markPearlEscrowBroadcastFailed,
  markPearlEscrowBroadcastSubmitted,
  PearlSignerBoundary,
  type PearlEscrowBroadcastAttempt,
  type PearlEscrowPackage,
  type PearlEscrowTemplateKind,
  type PearlEscrowTxTemplate,
} from '@kaspacom/pearl-escrow';
import type { PearlTransactionBroadcaster } from '@kaspacom/pearl-rpc';
import type { OtcTrade } from '@kaspacom/pearl-sdk';

import type {
  SettlementDecisionRecord,
  SettlementPreparedAction,
  SettlementSignerAdapter,
} from './types.js';

export interface PearlEscrowBroadcastAttemptRepository {
  saveBroadcastAttempt(attempt: PearlEscrowBroadcastAttempt): Promise<{
    attempt: PearlEscrowBroadcastAttempt;
    created: boolean;
  }>;
  updateBroadcastAttempt(attempt: PearlEscrowBroadcastAttempt): Promise<PearlEscrowBroadcastAttempt>;
  findLatestByIdempotencyKey(idempotencyKey: string): Promise<PearlEscrowBroadcastAttempt | undefined>;
  listBroadcastAttempts(): Promise<readonly PearlEscrowBroadcastAttempt[]>;
}

export interface PearlEscrowSettlementSignerAdapterOptions {
  signerBoundary: PearlSignerBoundary;
  broadcastAttempts: PearlEscrowBroadcastAttemptRepository;
  releaseFeeGrains: string;
  refundFeeGrains: string;
  now?: () => Date;
}

export class PearlEscrowSettlementSignerAdapter implements SettlementSignerAdapter {
  private readonly signerBoundary: PearlSignerBoundary;
  private readonly broadcastAttempts: PearlEscrowBroadcastAttemptRepository;
  private readonly releaseFeeGrains: string;
  private readonly refundFeeGrains: string;
  private readonly now: () => Date;

  constructor(options: PearlEscrowSettlementSignerAdapterOptions) {
    this.signerBoundary = options.signerBoundary;
    this.broadcastAttempts = options.broadcastAttempts;
    this.releaseFeeGrains = options.releaseFeeGrains;
    this.refundFeeGrains = options.refundFeeGrains;
    this.now = options.now ?? (() => new Date());
  }

  async preparePrlRelease(trade: OtcTrade, decision: SettlementDecisionRecord): Promise<SettlementPreparedAction> {
    return this.prepare(trade, decision, 'release');
  }

  async preparePrlRefund(trade: OtcTrade, decision: SettlementDecisionRecord): Promise<SettlementPreparedAction> {
    return this.prepare(trade, decision, 'refund');
  }

  private async prepare(
    trade: OtcTrade,
    decision: SettlementDecisionRecord,
    kind: PearlEscrowTemplateKind,
  ): Promise<SettlementPreparedAction> {
    const escrow = pearlEscrowPackageFromTrade(trade);
    const feeGrains = kind === 'release' ? this.releaseFeeGrains : this.refundFeeGrains;
    const unsignedTx = createPearlEscrowUnsignedTx({ escrow, kind, feeGrains });
    const response = await this.signerBoundary.requestSignature({
      escrow,
      decisionAction: kind === 'release' ? 'prepare_prl_release' : 'prepare_prl_refund',
      decisionEventId: decision.decisionId,
      unsignedTx,
      destinationAddress: kind === 'release' ? trade.buyerPearlAddress : trade.sellerPearlRefundAddress,
      observedStateHash: createObservedStateHash(trade, decision),
      expectedTxTemplateHash: createPearlEscrowTxTemplateHash(unsignedTx),
      now: this.now(),
    });
    if (!response.record.response) {
      throw new Error(`Pearl signer boundary did not return signed material for ${decision.decisionId}`);
    }

    const savedAttempt = await this.broadcastAttempts.saveBroadcastAttempt(
      createPearlEscrowBroadcastAttempt(
        response.record.response,
        1,
        this.now(),
      ),
    );

    return {
      actionId: `pearl_${savedAttempt.attempt.idempotencyKey}`,
      decisionId: decision.decisionId,
      tradeId: trade.tradeId,
      action: decision.action,
      status: 'prepared',
      idempotencyKey: savedAttempt.attempt.idempotencyKey,
      createdAt: savedAttempt.attempt.createdAt,
      metadata: {
        adapter: 'pearl_signer_boundary',
        broadcastAttemptStatus: savedAttempt.attempt.status,
        signerRequestId: response.record.requestId,
        signerRequestCreated: response.created,
        broadcastAttemptCreated: savedAttempt.created,
        signedTxid: response.record.response.signedTxid,
        txTemplateHash: response.record.request.txTemplateHash,
      },
    };
  }
}

export class InMemoryPearlEscrowBroadcastAttemptRepository implements PearlEscrowBroadcastAttemptRepository {
  private readonly attempts: PearlEscrowBroadcastAttempt[] = [];

  async saveBroadcastAttempt(attempt: PearlEscrowBroadcastAttempt): Promise<{
    attempt: PearlEscrowBroadcastAttempt;
    created: boolean;
  }> {
    const existing = await this.findLatestByIdempotencyKey(attempt.idempotencyKey);
    if (existing) {
      return { attempt: existing, created: false };
    }
    this.attempts.push(attempt);
    return { attempt, created: true };
  }

  async updateBroadcastAttempt(attempt: PearlEscrowBroadcastAttempt): Promise<PearlEscrowBroadcastAttempt> {
    const index = this.attempts.findIndex(
      (candidate) => candidate.idempotencyKey === attempt.idempotencyKey && candidate.attempt === attempt.attempt,
    );
    if (index === -1) {
      this.attempts.push(attempt);
    } else {
      this.attempts[index] = attempt;
    }
    return attempt;
  }

  async findLatestByIdempotencyKey(idempotencyKey: string): Promise<PearlEscrowBroadcastAttempt | undefined> {
    return this.attempts
      .filter((candidate) => candidate.idempotencyKey === idempotencyKey)
      .sort((left, right) => right.attempt - left.attempt)[0];
  }

  async listBroadcastAttempts(): Promise<readonly PearlEscrowBroadcastAttempt[]> {
    return [...this.attempts];
  }
}

export class JsonFilePearlEscrowBroadcastAttemptRepository implements PearlEscrowBroadcastAttemptRepository {
  constructor(private readonly filePath: string) {}

  async saveBroadcastAttempt(attempt: PearlEscrowBroadcastAttempt): Promise<{
    attempt: PearlEscrowBroadcastAttempt;
    created: boolean;
  }> {
    const attempts = await this.readAttempts();
    const existing = latestByIdempotencyKey(attempts, attempt.idempotencyKey);
    if (existing) {
      return { attempt: existing, created: false };
    }
    attempts.push(attempt);
    await this.writeAttempts(attempts);
    return { attempt, created: true };
  }

  async updateBroadcastAttempt(attempt: PearlEscrowBroadcastAttempt): Promise<PearlEscrowBroadcastAttempt> {
    const attempts = await this.readAttempts();
    const index = attempts.findIndex(
      (candidate) => candidate.idempotencyKey === attempt.idempotencyKey && candidate.attempt === attempt.attempt,
    );
    if (index === -1) {
      attempts.push(attempt);
    } else {
      attempts[index] = attempt;
    }
    await this.writeAttempts(attempts);
    return attempt;
  }

  async findLatestByIdempotencyKey(idempotencyKey: string): Promise<PearlEscrowBroadcastAttempt | undefined> {
    return latestByIdempotencyKey(await this.readAttempts(), idempotencyKey);
  }

  async listBroadcastAttempts(): Promise<readonly PearlEscrowBroadcastAttempt[]> {
    return this.readAttempts();
  }

  private async readAttempts(): Promise<PearlEscrowBroadcastAttempt[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error('Pearl broadcast attempt store must contain a JSON array');
      }
      return parsed as PearlEscrowBroadcastAttempt[];
    } catch (error) {
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }
  }

  private async writeAttempts(attempts: PearlEscrowBroadcastAttempt[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(attempts, null, 2)}\n`, 'utf8');
    await rename(tmpPath, this.filePath);
  }
}

export async function submitPearlEscrowBroadcastAttempt(input: {
  repository: PearlEscrowBroadcastAttemptRepository;
  broadcaster: PearlTransactionBroadcaster;
  attempt: PearlEscrowBroadcastAttempt;
  now?: Date;
  nextRetryAt?: string;
}): Promise<PearlEscrowBroadcastAttempt> {
  if (!input.attempt.signedTxHex) {
    throw new Error('signedTxHex is required before Pearl broadcast');
  }

  try {
    const broadcastTxid = await input.broadcaster.sendRawTransaction(input.attempt.signedTxHex);
    return input.repository.updateBroadcastAttempt(
      markPearlEscrowBroadcastSubmitted(input.attempt, broadcastTxid, input.now),
    );
  } catch (error) {
    const failed = markPearlEscrowBroadcastFailed(
      input.attempt,
      error instanceof Error ? error.message : String(error),
      { now: input.now, nextRetryAt: input.nextRetryAt },
    );
    await input.repository.updateBroadcastAttempt(failed);
    throw error;
  }
}

function pearlEscrowPackageFromTrade(trade: OtcTrade): PearlEscrowPackage {
  const releaseTemplate = assertTxTemplate(trade.pearlEscrow.releaseTemplate, 'releaseTemplate');
  const refundTemplate = assertTxTemplate(trade.pearlEscrow.refundTemplate, 'refundTemplate');
  const internalPubkeyHex = assertString(trade.pearlEscrow.internalPubkeyHex, 'internalPubkeyHex');
  const taprootOutputScriptHex = assertString(trade.pearlEscrow.taprootOutputScriptHex, 'taprootOutputScriptHex');
  const fundingOutpoint = assertString(trade.pearlEscrow.fundingOutpoint, 'fundingOutpoint');

  return {
    tradeId: trade.tradeId,
    network: trade.pearlEscrow.network,
    escrowAddress: trade.pearlEscrow.address,
    escrowScriptType: trade.pearlEscrow.escrowScriptType ?? 'p2tr',
    expectedAmountGrains: trade.pearlEscrow.expectedAmountGrains,
    requiredConfirmations: trade.pearlEscrow.requiredConfirmations,
    fundingOutpoint,
    ...(trade.pearlEscrow.refundEligibleAfterHeight == null
      ? {}
      : { refundEligibleAfterHeight: trade.pearlEscrow.refundEligibleAfterHeight }),
    ...(trade.pearlEscrow.refundEligibleAfterUnixTime == null
      ? {}
      : { refundEligibleAfterUnixTime: trade.pearlEscrow.refundEligibleAfterUnixTime }),
    releaseTemplate,
    refundTemplate,
    keys: {
      internalPubkeyHex,
      taprootOutputScriptHex,
      signerPubkeys: {},
    },
    createdAt: trade.createdAt,
    verification: {
      simnetVerified: trade.pearlEscrow.simnetVerified ?? false,
    },
  };
}

function createObservedStateHash(trade: OtcTrade, decision: SettlementDecisionRecord): string {
  return createPearlEscrowObservedStateHash({
    tradeId: trade.tradeId,
    tradeState: trade.state,
    decisionId: decision.decisionId,
    snapshotHash: decision.snapshotHash,
    sourceEventIds: decision.sourceEventIds,
    pearl: {
      status: decision.metadata.pearlStatus,
      confirmations: decision.metadata.pearlConfirmations,
      fundingOutpoint: trade.pearlEscrow.fundingOutpoint,
    },
    base: {
      status: decision.metadata.baseStatus,
      confirmations: decision.metadata.baseConfirmations,
    },
  });
}

function latestByIdempotencyKey(
  attempts: readonly PearlEscrowBroadcastAttempt[],
  idempotencyKey: string,
): PearlEscrowBroadcastAttempt | undefined {
  return attempts
    .filter((candidate) => candidate.idempotencyKey === idempotencyKey)
    .sort((left, right) => right.attempt - left.attempt)[0];
}

function assertTxTemplate(value: unknown, field: string): PearlEscrowTxTemplate {
  if (!value || typeof value !== 'object') {
    throw new Error(`trade Pearl escrow ${field} is required`);
  }
  const candidate = value as Partial<PearlEscrowTxTemplate>;
  if (!Array.isArray(candidate.inputs) || !Array.isArray(candidate.outputs) || !candidate.signingPolicy) {
    throw new Error(`trade Pearl escrow ${field} is malformed`);
  }
  return candidate as PearlEscrowTxTemplate;
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`trade Pearl escrow ${field} is required`);
  }
  return value;
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
