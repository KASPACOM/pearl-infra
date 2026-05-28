import { parseUsdcToMicros, type OtcTrade, type TradeState } from '@kaspacom/pearl-sdk';
import type { UsdcEscrowTradeEventState } from '@kaspacom/usdc-escrow-client';

import { createSettlementSnapshot, recordSettlementDecision } from './decision-engine.js';
import type {
  BaseEscrowEventState,
  PearlProofState,
  SettlementBaseEscrowSource,
  SettlementBroadcasterAdapter,
  SettlementDecisionRecord,
  SettlementDecisionRepository,
  SettlementPearlProofSource,
  SettlementPreparedAction,
  SettlementSignerAdapter,
  SettlementWorkerIterationResult,
  SettlementWorkerTradeSource,
} from './types.js';

export interface SettlementWorkerDependencies {
  trades: SettlementWorkerTradeSource;
  pearl: SettlementPearlProofSource;
  base: SettlementBaseEscrowSource;
  decisions: SettlementDecisionRepository;
  signer: SettlementSignerAdapter;
  broadcaster: SettlementBroadcasterAdapter;
}

export async function runSettlementWorkerIteration(
  dependencies: SettlementWorkerDependencies,
  now: Date = new Date(),
): Promise<SettlementWorkerIterationResult> {
  const trades = await dependencies.trades.listOpenTrades();
  const decisions: SettlementDecisionRecord[] = [];
  const createdDecisionIds: string[] = [];
  const preparedActions: SettlementPreparedAction[] = [];

  for (const trade of trades) {
    const [pearl, base] = await Promise.all([
      dependencies.pearl.getPearlProofState(trade),
      dependencies.base.getBaseEscrowState(trade),
    ]);
    const snapshot = createSettlementSnapshot({ trade, pearl, base, now });
    const saved = await recordSettlementDecision(dependencies.decisions, snapshot, now);
    decisions.push(saved.decision);

    if (!saved.created) {
      continue;
    }

    createdDecisionIds.push(saved.decision.decisionId);
    const prepared = await executeSettlementDecision(dependencies, trade, saved.decision);
    if (prepared) {
      preparedActions.push(prepared);
    }
  }

  return {
    scannedTrades: trades.length,
    decisions,
    createdDecisionIds,
    preparedActions,
  };
}

export async function executeSettlementDecision(
  dependencies: Pick<SettlementWorkerDependencies, 'trades' | 'signer' | 'broadcaster'>,
  trade: OtcTrade,
  decision: SettlementDecisionRecord,
): Promise<SettlementPreparedAction | undefined> {
  switch (decision.action) {
    case 'wait':
      return undefined;
    case 'manual_review':
      await dependencies.trades.flagManualReview?.(trade.tradeId, decision.reason, decision);
      return undefined;
    case 'prepare_prl_release':
      await dependencies.trades.applyTradeState?.(trade.tradeId, decision.toState ?? 'release_pending', decision);
      return dependencies.signer.preparePrlRelease(trade, decision);
    case 'prepare_prl_refund':
      await dependencies.trades.applyTradeState?.(trade.tradeId, decision.toState ?? 'refund_pending', decision);
      return dependencies.signer.preparePrlRefund(trade, decision);
    case 'prepare_base_create_trade':
      if (dependencies.broadcaster.prepareBaseCreateTrade) {
        return dependencies.broadcaster.prepareBaseCreateTrade(trade, decision);
      }
      return undefined;
    case 'prepare_usdc_release':
      return dependencies.broadcaster.prepareUsdcRelease(trade, decision);
    case 'mark_released':
    case 'mark_refunded':
      if (decision.toState) {
        await dependencies.trades.applyTradeState?.(trade.tradeId, decision.toState, decision);
      }
      return undefined;
  }
}

export function baseEscrowEventStateFromUsdcTradeState(
  state: UsdcEscrowTradeEventState | undefined,
  trade?: OtcTrade,
): BaseEscrowEventState {
  if (!state) {
    return {
      status: 'none',
      sourceEventId: 'base:none',
      confirmations: 0,
      observedAt: new Date(0).toISOString(),
    };
  }
  const mismatch = trade ? findBaseEscrowStateMismatch(state, trade) : undefined;
  if (mismatch) {
    return {
      status: 'stale',
      sourceEventId: state.sourceEventId,
      txHash: state.txHash,
      confirmations: state.confirmations,
      observedAt: state.observedAt,
      reason: mismatch,
    };
  }

  return {
    status: state.status,
    sourceEventId: state.sourceEventId,
    txHash: state.txHash,
    confirmations: state.confirmations,
    observedAt: state.observedAt,
  };
}

function findBaseEscrowStateMismatch(state: UsdcEscrowTradeEventState, trade: OtcTrade): string | undefined {
  const expectedAmount = parseUsdcToMicros(trade.amountUsdc).toString();
  const expectedFee = parseUsdcToMicros(trade.feeUsdc).toString();
  const expectedExpiry = Math.floor(new Date(trade.usdcEscrow.expiresAt).getTime() / 1000);
  if (state.tradeKey !== trade.usdcEscrow.tradeKey) {
    return 'Base escrow trade key mismatch';
  }
  if (state.chainId !== trade.usdcEscrow.chainId) {
    return 'Base escrow chain mismatch';
  }
  if (state.contractAddress.toLowerCase() !== trade.usdcEscrow.contract.toLowerCase()) {
    return 'Base escrow contract mismatch';
  }
  if (requiresCreatedTerms(state.status) && (!state.buyer || !state.seller || state.feeMicros === undefined || state.expiryUnixSeconds === undefined)) {
    return 'Base escrow created terms missing';
  }
  if (state.buyer && state.buyer.toLowerCase() !== trade.buyerUsdcAddress.toLowerCase()) {
    return 'Base escrow buyer mismatch';
  }
  if (state.seller && state.seller.toLowerCase() !== trade.sellerUsdcReceiveAddress.toLowerCase()) {
    return 'Base escrow seller mismatch';
  }
  if (state.expiryUnixSeconds !== undefined && state.expiryUnixSeconds !== expectedExpiry) {
    return 'Base escrow expiry mismatch';
  }
  if (state.status === 'created') {
    if (state.amountMicros !== expectedAmount || state.feeMicros !== expectedFee) {
      return 'Base escrow created terms mismatch';
    }
  }
  if (state.feeMicros !== undefined && state.feeMicros !== parseUsdcToMicros(trade.feeUsdc).toString()) {
    return 'Base escrow fee mismatch';
  }
  if (['deposited', 'released', 'refunded'].includes(state.status) && state.amountMicros !== trade.usdcEscrow.expectedAmountMicros) {
    return 'Base escrow funded amount mismatch';
  }
  if (
    state.status === 'released' &&
    (state.sellerAmountMicros !== parseUsdcToMicros(trade.amountUsdc).toString() ||
      state.feeAmountMicros !== parseUsdcToMicros(trade.feeUsdc).toString())
  ) {
    return 'Base escrow release amount mismatch';
  }
  return undefined;
}

function requiresCreatedTerms(status: UsdcEscrowTradeEventState['status']): boolean {
  return status === 'created' || status === 'deposited' || status === 'released' || status === 'refunded';
}

export class InMemorySettlementWorkerTradeSource implements SettlementWorkerTradeSource {
  readonly manualReviews: { tradeId: string; reason: string; decisionId: string }[] = [];
  readonly transitions: { tradeId: string; state: TradeState; decisionId: string }[] = [];

  constructor(private readonly trades: OtcTrade[]) {}

  async listOpenTrades(): Promise<readonly OtcTrade[]> {
    return this.trades.filter((trade) => !['released', 'refunded', 'cancelled', 'failed_manual_review'].includes(trade.state));
  }

  async applyTradeState(tradeId: string, state: TradeState, decision: SettlementDecisionRecord): Promise<void> {
    const trade = this.trades.find((candidate) => candidate.tradeId === tradeId);
    if (trade) {
      trade.state = state;
      trade.updatedAt = decision.createdAt;
    }
    this.transitions.push({ tradeId, state, decisionId: decision.decisionId });
  }

  async flagManualReview(tradeId: string, reason: string, decision: SettlementDecisionRecord): Promise<void> {
    const trade = this.trades.find((candidate) => candidate.tradeId === tradeId);
    if (trade) {
      trade.state = 'failed_manual_review';
      trade.updatedAt = decision.createdAt;
    }
    this.manualReviews.push({ tradeId, reason, decisionId: decision.decisionId });
  }
}

export class StaticSettlementPearlProofSource implements SettlementPearlProofSource {
  constructor(private readonly statesByTradeId: ReadonlyMap<string, PearlProofState>) {}

  async getPearlProofState(trade: OtcTrade): Promise<PearlProofState> {
    return (
      this.statesByTradeId.get(trade.tradeId) ?? {
        status: 'missing',
        sourceEventId: `pearl:missing:${trade.tradeId}`,
        confirmations: 0,
        observedAt: new Date(0).toISOString(),
      }
    );
  }
}

export class StaticSettlementBaseEscrowSource implements SettlementBaseEscrowSource {
  constructor(private readonly statesByTradeKey: ReadonlyMap<string, UsdcEscrowTradeEventState>) {}

  async getBaseEscrowState(trade: OtcTrade): Promise<BaseEscrowEventState> {
    return baseEscrowEventStateFromUsdcTradeState(this.statesByTradeKey.get(trade.usdcEscrow.tradeKey), trade);
  }
}

export class InMemorySettlementSignerAdapter implements SettlementSignerAdapter {
  readonly preparedActions: SettlementPreparedAction[] = [];

  async preparePrlRelease(trade: OtcTrade, decision: SettlementDecisionRecord): Promise<SettlementPreparedAction> {
    return this.prepare(trade, decision);
  }

  async preparePrlRefund(trade: OtcTrade, decision: SettlementDecisionRecord): Promise<SettlementPreparedAction> {
    return this.prepare(trade, decision);
  }

  private prepare(trade: OtcTrade, decision: SettlementDecisionRecord): SettlementPreparedAction {
    const action = createPreparedAction(trade, decision, 'signer');
    this.preparedActions.push(action);
    return action;
  }
}

export class InMemorySettlementBroadcasterAdapter implements SettlementBroadcasterAdapter {
  readonly preparedActions: SettlementPreparedAction[] = [];

  async prepareUsdcRelease(trade: OtcTrade, decision: SettlementDecisionRecord): Promise<SettlementPreparedAction> {
    const action = createPreparedAction(trade, decision, 'broadcaster');
    this.preparedActions.push(action);
    return action;
  }
}

function createPreparedAction(
  trade: OtcTrade,
  decision: SettlementDecisionRecord,
  adapter: 'signer' | 'broadcaster',
): SettlementPreparedAction {
  return {
    actionId: `${adapter}_${decision.decisionId}`,
    decisionId: decision.decisionId,
    tradeId: trade.tradeId,
    action: decision.action,
    status: 'prepared',
    idempotencyKey: `${adapter}:${decision.idempotencyKey}`,
    createdAt: decision.createdAt,
    metadata: {
      adapter,
      liveBroadcast: false,
    },
  };
}
