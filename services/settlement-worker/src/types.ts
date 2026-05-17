import type { OtcTrade, TradeState } from '@kaspacom/pearl-sdk';

export type PearlProofStatus =
  | 'missing'
  | 'seen'
  | 'confirmed'
  | 'late'
  | 'amount_mismatch'
  | 'reorged'
  | 'released'
  | 'refunded'
  | 'unknown_spend';

export type BaseEscrowStatus =
  | 'none'
  | 'created'
  | 'deposited'
  | 'released'
  | 'refunded'
  | 'cancelled'
  | 'reorged'
  | 'stale';

export interface PearlProofState {
  status: PearlProofStatus;
  sourceEventId: string;
  txid?: string;
  outpoint?: string;
  confirmations: number;
  observedAt: string;
  reason?: string;
}

export interface BaseEscrowEventState {
  status: BaseEscrowStatus;
  sourceEventId: string;
  txHash?: string;
  confirmations: number;
  observedAt: string;
  reason?: string;
}

export interface SettlementSnapshot {
  trade: OtcTrade;
  pearl: PearlProofState;
  base: BaseEscrowEventState;
  observedAt: string;
}

export type SettlementDecisionAction =
  | 'wait'
  | 'manual_review'
  | 'prepare_prl_release'
  | 'prepare_prl_refund'
  | 'mark_released'
  | 'mark_refunded';

export interface SettlementDecisionRecord {
  decisionId: string;
  idempotencyKey: string;
  tradeId: string;
  action: SettlementDecisionAction;
  toState?: TradeState;
  reason: string;
  sourceEventIds: string[];
  snapshotHash: string;
  createdAt: string;
  metadata: {
    tradeState: TradeState;
    pearlStatus: PearlProofStatus;
    baseStatus: BaseEscrowStatus;
    pearlConfirmations: number;
    baseConfirmations: number;
  };
}

export interface SettlementDecisionRepository {
  saveDecision(decision: SettlementDecisionRecord): Promise<{
    decision: SettlementDecisionRecord;
    created: boolean;
  }>;
  findDecisionByIdempotencyKey(idempotencyKey: string): Promise<SettlementDecisionRecord | undefined>;
}
