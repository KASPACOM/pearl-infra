import type {
  OtcRepository,
  PearlIndexedProof,
  PearlProofReader,
  UsdcEscrowReader,
} from '@kaspacom/otc-api';
import type { OtcTrade, TradeState } from '@kaspacom/pearl-sdk';
import { baseEscrowEventStateFromUsdcTradeState } from './settlement-loop.js';
import type {
  BaseEscrowEventState,
  PearlProofState,
  SettlementBaseEscrowSource,
  SettlementDecisionRecord,
  SettlementPearlProofSource,
  SettlementWorkerTradeSource,
} from './types.js';

export class PgOtcRepositorySettlementTradeSource implements SettlementWorkerTradeSource {
  constructor(private readonly repository: OtcRepository) {}

  async listOpenTrades(): Promise<readonly OtcTrade[]> {
    const trades = await this.repository.listTrades();
    return trades.filter((trade) => !TERMINAL_STATES.includes(trade.state));
  }

  async applyTradeState(tradeId: string, state: TradeState, decision: SettlementDecisionRecord): Promise<void> {
    const trade = await this.requireTrade(tradeId);
    await this.repository.updateTrade({ ...trade, state, updatedAt: decision.createdAt });
    await this.repository.appendEvent({
      tradeId,
      fromState: trade.state,
      toState: state,
      source: 'settlement_worker',
      sourceEventId: decision.decisionId,
      observedAt: decision.createdAt,
      metadata: { reason: decision.reason },
    });
  }

  async flagManualReview(tradeId: string, reason: string, decision: SettlementDecisionRecord): Promise<void> {
    const trade = await this.requireTrade(tradeId);
    await this.repository.updateTrade({ ...trade, state: 'failed_manual_review', updatedAt: decision.createdAt });
    await this.repository.appendEvent({
      tradeId,
      fromState: trade.state,
      toState: 'failed_manual_review',
      source: 'settlement_worker',
      sourceEventId: decision.decisionId,
      observedAt: decision.createdAt,
      metadata: { reason },
    });
  }

  async findTradeById(tradeId: string): Promise<OtcTrade | undefined> {
    return this.repository.findTradeById(tradeId);
  }

  private async requireTrade(tradeId: string): Promise<OtcTrade> {
    const trade = await this.repository.findTradeById(tradeId);
    if (!trade) throw new Error(`trade not found: ${tradeId}`);
    return trade;
  }
}

export class IndexerBackedSettlementPearlProofSource implements SettlementPearlProofSource {
  constructor(private readonly reader: PearlProofReader) {}

  async getPearlProofState(trade: OtcTrade): Promise<PearlProofState> {
    const proof = await this.reader.getPearlIndexedProof(trade);
    return projectIndexedProofToState(trade, proof);
  }
}

export class EthersBackedSettlementBaseEscrowSource implements SettlementBaseEscrowSource {
  constructor(private readonly reader: UsdcEscrowReader) {}

  async getBaseEscrowState(trade: OtcTrade): Promise<BaseEscrowEventState> {
    const onChain = await this.reader.getTrade(trade.usdcEscrow.tradeKey);
    if (onChain.status === 'none') {
      return {
        status: 'none',
        sourceEventId: `base:none:${trade.usdcEscrow.tradeKey}`,
        confirmations: 0,
        observedAt: new Date(0).toISOString(),
      };
    }
    // Dev path: we don't yet operate a Base event indexer, so we assume the on-chain
    // state was observed deep enough to satisfy the trade's required-confirmation gate.
    const observedAt = new Date().toISOString();
    return baseEscrowEventStateFromUsdcTradeState(
      {
        status: onChain.status,
        sourceEventId: `base:on-chain:${trade.usdcEscrow.tradeKey}:${onChain.status}`,
        observedAt,
        confirmations: trade.usdcEscrow.requiredConfirmations,
        chainId: trade.usdcEscrow.chainId,
        network: trade.usdcEscrow.network,
        contractAddress: trade.usdcEscrow.contract,
        tradeKey: trade.usdcEscrow.tradeKey,
        lastEventName: onChain.status === 'cancelled' ? 'TradeCreated' : (onChain.status === 'created' ? 'TradeCreated' : onChain.status === 'deposited' ? 'Deposited' : onChain.status === 'released' ? 'Released' : 'Refunded'),
        txHash: '0x' + '0'.repeat(64),
        blockNumber: 0,
        buyer: onChain.buyer,
        seller: onChain.seller,
        feeMicros: onChain.feeMicros,
        amountMicros: onChain.amountMicros,
        sellerAmountMicros: onChain.amountMicros,
        feeAmountMicros: onChain.feeMicros,
        expiryUnixSeconds: onChain.expiryUnixSeconds,
      } as Parameters<typeof baseEscrowEventStateFromUsdcTradeState>[0],
      trade,
    );
  }
}

function projectIndexedProofToState(trade: OtcTrade, proof: PearlIndexedProof): PearlProofState {
  if (proof.releaseTxid) {
    return {
      status: 'released',
      sourceEventId: `pearl:release:${proof.releaseTxid}`,
      txid: proof.releaseTxid,
      outpoint: proof.escrowOutpoint,
      confirmations: proof.escrowConfirmations,
      observedAt: latestEventObservedAt(proof) ?? new Date(0).toISOString(),
    };
  }
  if (proof.refundTxid) {
    return {
      status: 'refunded',
      sourceEventId: `pearl:refund:${proof.refundTxid}`,
      txid: proof.refundTxid,
      outpoint: proof.escrowOutpoint,
      confirmations: proof.escrowConfirmations,
      observedAt: latestEventObservedAt(proof) ?? new Date(0).toISOString(),
    };
  }
  if (!proof.escrowOutpoint) {
    return {
      status: 'missing',
      sourceEventId: `pearl:missing:${trade.tradeId}`,
      confirmations: 0,
      observedAt: new Date(0).toISOString(),
    };
  }
  const confirmedEnough = proof.escrowConfirmations >= trade.pearlEscrow.requiredConfirmations;
  return {
    status: confirmedEnough ? 'confirmed' : 'seen',
    sourceEventId: `pearl:observation:${proof.escrowOutpoint}`,
    outpoint: proof.escrowOutpoint,
    confirmations: proof.escrowConfirmations,
    observedAt: latestEventObservedAt(proof) ?? new Date().toISOString(),
  };
}

function latestEventObservedAt(proof: PearlIndexedProof): string | undefined {
  if (proof.events.length === 0) return undefined;
  return proof.events[proof.events.length - 1]?.observedAt;
}

const TERMINAL_STATES: TradeState[] = [
  'released',
  'refunded',
  'cancelled',
  'failed_manual_review',
  'quote_expired',
];
