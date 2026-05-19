export type PearlNetwork = 'mainnet' | 'testnet' | 'testnet2' | 'simnet' | 'regtest';

export type BridgeWatchPurpose = 'bridge_deposit' | 'bridge_reserve';
export type WatchStatus = 'active' | 'closed';
export type ObservationMatchStatus = 'pending' | 'confirmed' | 'spent' | 'detached';

export interface RegisterBridgeWatchInput {
  watchId: string;
  purpose: BridgeWatchPurpose;
  network: PearlNetwork;
  address: string;
  requiredConfirmations: number;
  metadata: Record<string, unknown>;
}

export interface BridgeDepositWatchRequest {
  depositId: string;
  network: PearlNetwork;
  depositAddress: string;
  igraRecipient: string;
  expectedAmountMinGrains: string;
  expectedAmountMaxGrains: string;
  expiryHeight: number;
  requiredConfirmations: number;
  createdAt?: string;
}

export interface BridgeReserveWatchRequest {
  reserveId: string;
  network: PearlNetwork;
  reserveAddress: string;
  custodyTier: 'hot' | 'warm' | 'cold';
  activeFromHeight: number;
  activeToHeight?: number;
  requiredConfirmations: number;
  createdAt?: string;
}

export interface WatchedBridgeAddress {
  watchId: string;
  purpose: BridgeWatchPurpose;
  network: PearlNetwork;
  address: string;
  requiredConfirmations: number;
  status: WatchStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface BridgeAddressObservation {
  outpoint: string;
  watchId: string;
  blockHash: string;
  height: number;
  amountGrains: string;
  confirmations: number;
  matchStatus: ObservationMatchStatus;
  classification: string;
  observedAt: string;
}

export interface BridgeAddressSpend {
  spendTxid: string;
  spentOutpoint: string;
  blockHash: string;
  height: number;
  classification: string;
  classificationData: Record<string, unknown> | null;
  observedAt: string;
}

export interface WatchedBridgeAddressWithHistory extends WatchedBridgeAddress {
  observations: BridgeAddressObservation[];
  spends: BridgeAddressSpend[];
}

export type BridgeExitStatus = 'pending' | 'processed' | 'released' | 'refunded' | 'cancelled' | 'unknown';

export interface BridgeExitRequest {
  exitId: string;
  igraBurnTxid: string;
  igraBurnLogIndex: number;
  igraBurnBlock: number;
  igraChainId: number;
  requestedAmountGrains: string;
  pearlRecipient: string;
  status: BridgeExitStatus;
  pearlReleaseTxid?: string;
  pearlReleaseBlock?: number;
  releasedAt?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface BridgePilotLimits {
  minDepositGrains: string;
  maxDepositGrains: string;
  maxExitGrains: string;
  pilotSupplyCapGrains: string;
  rollingWindowCapGrains?: string;
  rollingWindowUsedGrains?: string;
}

export type BridgeRelayerDecisionAction =
  | 'wait'
  | 'manual_review'
  | 'prepare_mint'
  | 'prepare_exit_release'
  | 'mark_exit_released';

export interface BridgeRelayerDecision {
  action: BridgeRelayerDecisionAction;
  reason: string;
  idempotencyKey: string;
  sourceIds: string[];
  metadata?: Record<string, string | number | boolean | null>;
}

export interface BridgeReconciliationSnapshotRecord {
  snapshotId: string;
  snapshot: unknown;
  observedAt: string;
  createdAt: string;
}

export type IgraBridgeEventType =
  | 'deposit_claimed'
  | 'exit_requested'
  | 'exit_processed'
  | 'exit_refunded'
  | 'caps_updated'
  | 'entry_paused'
  | 'exit_request_paused'
  | 'exit_processing_paused'
  | 'relayer_updated'
  | 'operator_updated';

export interface IgraBridgeEvent {
  eventId: string;
  eventType: IgraBridgeEventType;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  chainId: number;
  payload: Record<string, string | number | boolean | null>;
  observedAt: string;
}

export type BridgeApprovalKind = 'mint' | 'exit_release' | 'rejection' | 'pause_recommendation' | 'replay';

export interface BridgeAdminDecision {
  decisionId: string;
  kind: BridgeApprovalKind;
  targetId: string;
  actor: string;
  reason: string;
  idempotencyKey: string;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
}

export type BridgeAlertSeverity = 'info' | 'warning' | 'critical';

export interface BridgePilotAlert {
  alertId: string;
  severity: BridgeAlertSeverity;
  code: string;
  message: string;
  sourceIds: string[];
  metadata?: Record<string, string | number | boolean | null>;
}
