import { createHash } from 'node:crypto';

import { tradeStateIsTerminal, type TradeState } from '@kaspacom/pearl-sdk';

import type {
  BaseEscrowEventState,
  PearlProofState,
  SettlementDecisionRecord,
  SettlementDecisionRepository,
  SettlementSnapshot,
} from './types.js';

const MANUAL_REVIEW_TRADE_STATES: readonly TradeState[] = [
  'late_prl_funding',
  'usdc_refunded',
  'prl_release_failed',
  'amount_mismatch',
  'reorged',
  'stale_indexer',
  'unknown_spend',
];

export function createSettlementSnapshot(input: {
  trade: SettlementSnapshot['trade'];
  pearl: PearlProofState;
  base: BaseEscrowEventState;
  now?: Date;
}): SettlementSnapshot {
  return {
    trade: input.trade,
    pearl: input.pearl,
    base: input.base,
    observedAt: (input.now ?? new Date()).toISOString(),
  };
}

export function createSettlementDecisionRecord(
  snapshot: SettlementSnapshot,
  now: Date = new Date(),
): SettlementDecisionRecord {
  const evaluated = evaluateSettlementSnapshot(snapshot, now);
  const sourceEventIds = [snapshot.pearl.sourceEventId, snapshot.base.sourceEventId].sort();
  const snapshotHash = createSettlementSnapshotHash(snapshot);
  const idempotencyKey = [
    'settlement',
    snapshot.trade.tradeId,
    evaluated.action,
    sourceEventIds.join('+'),
    snapshotHash,
  ].join(':');

  return {
    decisionId: `decision_${sha256(idempotencyKey).slice(0, 24)}`,
    idempotencyKey,
    tradeId: snapshot.trade.tradeId,
    action: evaluated.action,
    ...(evaluated.toState ? { toState: evaluated.toState } : {}),
    reason: evaluated.reason,
    sourceEventIds,
    snapshotHash,
    createdAt: now.toISOString(),
    metadata: {
      tradeState: snapshot.trade.state,
      pearlStatus: snapshot.pearl.status,
      baseStatus: snapshot.base.status,
      pearlConfirmations: snapshot.pearl.confirmations,
      baseConfirmations: snapshot.base.confirmations,
    },
  };
}

export async function recordSettlementDecision(
  repository: SettlementDecisionRepository,
  snapshot: SettlementSnapshot,
  now: Date = new Date(),
): Promise<{ decision: SettlementDecisionRecord; created: boolean }> {
  return repository.saveDecision(createSettlementDecisionRecord(snapshot, now));
}

export class InMemorySettlementDecisionRepository implements SettlementDecisionRepository {
  private readonly decisions = new Map<string, SettlementDecisionRecord>();

  async saveDecision(decision: SettlementDecisionRecord): Promise<{
    decision: SettlementDecisionRecord;
    created: boolean;
  }> {
    const existing = this.decisions.get(decision.idempotencyKey);
    if (existing) {
      return { decision: existing, created: false };
    }
    this.decisions.set(decision.idempotencyKey, decision);
    return { decision, created: true };
  }

  async findDecisionByIdempotencyKey(idempotencyKey: string): Promise<SettlementDecisionRecord | undefined> {
    return this.decisions.get(idempotencyKey);
  }
}

export function createSettlementSnapshotHash(snapshot: SettlementSnapshot): string {
  return `sha256:${sha256Json({
    tradeId: snapshot.trade.tradeId,
    tradeState: snapshot.trade.state,
    deadlines: snapshot.trade.deadlines,
    pearl: snapshot.pearl,
    base: snapshot.base,
  })}`;
}

function evaluateSettlementSnapshot(
  snapshot: SettlementSnapshot,
  now: Date,
): Pick<SettlementDecisionRecord, 'action' | 'reason' | 'toState'> {
  const manualReviewReason = getManualReviewReason(snapshot);
  if (manualReviewReason) {
    return {
      action: 'manual_review',
      toState: 'failed_manual_review',
      reason: manualReviewReason,
    };
  }

  if (tradeStateIsTerminal(snapshot.trade.state)) {
    return {
      action: 'wait',
      reason: `terminal trade state: ${snapshot.trade.state}`,
    };
  }

  if (snapshot.pearl.status === 'released' && snapshot.base.status === 'deposited') {
    return {
      action: 'prepare_usdc_release',
      reason: 'PRL release is confirmed and USDC remains deposited',
    };
  }

  if (snapshot.pearl.status === 'released' && snapshot.base.status === 'released') {
    return {
      action: 'mark_released',
      toState: 'released',
      reason: 'PRL release is confirmed',
    };
  }

  if (snapshot.pearl.status === 'refunded') {
    return {
      action: 'mark_refunded',
      toState: 'refunded',
      reason: 'PRL refund is confirmed',
    };
  }

  if (isPrlReleaseAllowed(snapshot)) {
    return {
      action: 'prepare_prl_release',
      toState: 'release_pending',
      reason: 'both Pearl and Base legs are funded',
    };
  }

  if (isBaseCreateTradeNeeded(snapshot, now)) {
    return {
      action: 'prepare_base_create_trade',
      reason: 'Pearl escrow is allocated but Base trade record does not exist yet',
    };
  }

  if (
    ['seen', 'confirmed'].includes(snapshot.pearl.status) &&
    ['none', 'created', 'cancelled'].includes(snapshot.base.status) &&
    now.getTime() >= new Date(snapshot.trade.deadlines.refundAvailableAt).getTime()
  ) {
    return {
      action: 'prepare_prl_refund',
      toState: 'refund_pending',
      reason: 'USDC leg was not deposited before refund availability',
    };
  }

  return {
    action: 'wait',
    reason: 'settlement prerequisites are not met',
  };
}

function getManualReviewReason(snapshot: SettlementSnapshot): string | undefined {
  if (MANUAL_REVIEW_TRADE_STATES.includes(snapshot.trade.state)) {
    return `trade is already in manual-review state: ${snapshot.trade.state}`;
  }
  if (['amount_mismatch', 'reorged', 'unknown_spend', 'late'].includes(snapshot.pearl.status)) {
    return `Pearl proof is unsafe: ${snapshot.pearl.status}`;
  }
  if (
    ['seen', 'confirmed'].includes(snapshot.pearl.status) &&
    new Date(snapshot.pearl.observedAt).getTime() > new Date(snapshot.trade.deadlines.pearlFundingDeadline).getTime()
  ) {
    return 'Pearl funding was observed after the funding deadline';
  }
  if (['reorged', 'stale'].includes(snapshot.base.status)) {
    return `Base escrow observation is unsafe: ${snapshot.base.status}`;
  }
  if (snapshot.base.status === 'released' && snapshot.pearl.status !== 'released') {
    return 'Base USDC was released before PRL release confirmation';
  }
  if (snapshot.base.status === 'refunded' && !['refunded', 'missing'].includes(snapshot.pearl.status)) {
    return 'Base USDC was refunded while PRL remains funded or spendable';
  }
  if (snapshot.pearl.status === 'released' && snapshot.base.status === 'refunded') {
    return 'PRL release and USDC refund both observed';
  }
  return undefined;
}

function isBaseCreateTradeNeeded(snapshot: SettlementSnapshot, now: Date): boolean {
  // Worker auto-creates the Base trade record after the Pearl escrow is allocated and
  // before USDC deposit becomes possible. Skip if the trade was already created on Base
  // (status indexed != 'none') or if the trade is past the USDC deposit deadline (no
  // point opening a window that closes immediately).
  if (snapshot.base.status !== 'none') return false;
  if (now.getTime() >= new Date(snapshot.trade.deadlines.usdcDepositDeadline).getTime()) return false;
  // Only act for trades whose state semantics anchor the Pearl side as the source of
  // truth — same modes that the auto-release path supports. Skip for legacy trades that
  // never had a multisig escrow allocated.
  if (snapshot.trade.pearlEscrowMode !== 'multisig') return false;
  return ['pearl_escrow_pending', 'pearl_escrow_seen', 'pearl_escrow_confirmed'].includes(snapshot.trade.state);
}

function isPrlReleaseAllowed(snapshot: SettlementSnapshot): boolean {
  const baseConditionsMet =
    snapshot.trade.state === 'usdc_escrow_confirmed' &&
    snapshot.pearl.status === 'confirmed' &&
    snapshot.base.status === 'deposited' &&
    snapshot.pearl.confirmations >= snapshot.trade.pearlEscrow.requiredConfirmations &&
    snapshot.base.confirmations >= snapshot.trade.usdcEscrow.requiredConfirmations &&
    new Date(snapshot.pearl.observedAt).getTime() <= new Date(snapshot.trade.deadlines.pearlFundingDeadline).getTime();
  if (!baseConditionsMet) return false;
  return isWorkerAutoReleaseAuthorized(snapshot);
}

function isWorkerAutoReleaseAuthorized(snapshot: SettlementSnapshot): boolean {
  // Multisig escrows require an explicit buyer opt-in via preauthorize_release AND a
  // buyer-presigned PSBT before the worker can co-sign with the arbiter. Manual-mode
  // multisig trades wait for the user's paste-broadcast flow. Coordinator (xpub) and
  // legacy/undefined escrow modes auto-release through the desk signer client.
  if (snapshot.trade.pearlEscrowMode === 'multisig') {
    if (snapshot.trade.pearlReleaseSigningMode !== 'preauthorize_release') return false;
    const presig = snapshot.trade.pearlEscrow.buyerReleasePresignature;
    if (!presig) return false;
    if (presig.revokedAt) return false;
  }
  return true;
}

function sha256Json(value: unknown): string {
  return sha256(JSON.stringify(canonicalize(value)));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
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
