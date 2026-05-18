import type { OtcTrade, TradeEvent } from '@kaspacom/pearl-sdk';

export interface PearlIndexedProof {
  escrowOutpoint?: string;
  escrowConfirmations: number;
  releaseTxid?: string;
  refundTxid?: string;
  events: TradeEvent[];
}

export interface PearlProofReader {
  getPearlIndexedProof(trade: OtcTrade): Promise<PearlIndexedProof>;
}

export class HttpPearlProofReader implements PearlProofReader {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, timeoutMs = 5_000) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
  }

  async getPearlIndexedProof(trade: OtcTrade): Promise<PearlIndexedProof> {
    const watchId = createPearlEscrowWatchIdForProof(trade.tradeId);
    const response = await fetch(`${this.baseUrl}/watches/${encodeURIComponent(watchId)}`, {
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (response.status === 404) {
      throw new Error(`Pearl indexer watch not found: ${watchId}`);
    }
    if (!response.ok) {
      throw new Error(`Pearl indexer proof fetch failed: ${response.status} ${await response.text()}`);
    }
    return projectPearlIndexedProof(trade, await response.json());
  }
}

function createPearlEscrowWatchIdForProof(tradeId: string): string {
  return `otc:${tradeId}:pearl-escrow`;
}

export function projectPearlIndexedProof(trade: OtcTrade, rawHistory: unknown): PearlIndexedProof {
  const history = parseWatchHistory(rawHistory);
  const observations = history.observations.filter((observation) => observation.matchStatus !== 'detached');
  const funding = observations.find((observation) => observation.matchStatus === 'spent')
    ?? observations.find((observation) => observation.matchStatus === 'confirmed')
    ?? observations[0];
  const releaseSpend = history.spends.find((spend) => spend.classification === 'release');
  const refundSpend = history.spends.find((spend) => spend.classification === 'refund');
  const unknownSpend = history.spends.find((spend) => spend.classification === 'unknown_spend');

  const events: TradeEvent[] = [
    ...observations.map((observation) => observationToEvent(trade, observation)),
    ...history.spends.map((spend) => spendToEvent(trade, spend)),
  ];

  return {
    ...(funding ? { escrowOutpoint: funding.outpoint } : {}),
    escrowConfirmations: funding?.confirmations ?? 0,
    ...(releaseSpend ? { releaseTxid: releaseSpend.spendTxid } : {}),
    ...(refundSpend ? { refundTxid: refundSpend.spendTxid } : {}),
    ...(unknownSpend && !releaseSpend && !refundSpend ? { releaseTxid: undefined, refundTxid: undefined } : {}),
    events,
  };
}

interface WatchHistory {
  observations: IndexedObservation[];
  spends: IndexedSpend[];
}

interface IndexedObservation {
  outpoint: string;
  blockHash: string;
  height: number;
  amountGrains: string;
  confirmations: number;
  matchStatus: string;
  observedAt: string;
}

interface IndexedSpend {
  spendTxid: string;
  spentOutpoint: string;
  blockHash: string;
  height: number;
  classification: string;
  observedAt: string;
}

function parseWatchHistory(raw: unknown): WatchHistory {
  if (!isRecord(raw)) {
    throw new Error('Pearl indexer watch response must be an object');
  }
  return {
    observations: Array.isArray(raw.observations) ? raw.observations.map(parseObservation) : [],
    spends: Array.isArray(raw.spends) ? raw.spends.map(parseSpend) : [],
  };
}

function parseObservation(raw: unknown): IndexedObservation {
  if (!isRecord(raw)) throw new Error('Pearl indexer observation must be an object');
  return {
    outpoint: requireString(raw, 'outpoint'),
    blockHash: requireString(raw, 'blockHash'),
    height: requireNumber(raw, 'height'),
    amountGrains: requireString(raw, 'amountGrains'),
    confirmations: requireNumber(raw, 'confirmations'),
    matchStatus: requireString(raw, 'matchStatus'),
    observedAt: requireString(raw, 'observedAt'),
  };
}

function parseSpend(raw: unknown): IndexedSpend {
  if (!isRecord(raw)) throw new Error('Pearl indexer spend must be an object');
  return {
    spendTxid: requireString(raw, 'spendTxid'),
    spentOutpoint: requireString(raw, 'spentOutpoint'),
    blockHash: requireString(raw, 'blockHash'),
    height: requireNumber(raw, 'height'),
    classification: requireString(raw, 'classification'),
    observedAt: requireString(raw, 'observedAt'),
  };
}

function observationToEvent(trade: OtcTrade, observation: IndexedObservation): TradeEvent {
  return {
    tradeId: trade.tradeId,
    fromState: trade.state,
    toState: observation.matchStatus === 'confirmed' || observation.matchStatus === 'spent'
      ? 'pearl_escrow_confirmed'
      : 'pearl_escrow_seen',
    source: 'pearl_indexer',
    sourceEventId: `pearl-observation:${observation.outpoint}:${observation.matchStatus}`,
    outpoint: observation.outpoint,
    confirmations: observation.confirmations,
    observedAt: observation.observedAt,
    metadata: {
      block_hash: observation.blockHash,
      height: observation.height,
      amount_grains: observation.amountGrains,
      match_status: observation.matchStatus,
    },
  };
}

function spendToEvent(trade: OtcTrade, spend: IndexedSpend): TradeEvent {
  return {
    tradeId: trade.tradeId,
    fromState: trade.state,
    toState: spend.classification === 'release'
      ? 'release_pending'
      : spend.classification === 'refund'
        ? 'refund_pending'
        : 'unknown_spend',
    source: 'pearl_indexer',
    sourceEventId: `pearl-spend:${spend.spendTxid}:${spend.spentOutpoint}`,
    txHash: spend.spendTxid,
    outpoint: spend.spentOutpoint,
    observedAt: spend.observedAt,
    metadata: {
      block_hash: spend.blockHash,
      height: spend.height,
      classification: spend.classification,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Pearl indexer field ${key} must be a string`);
  return value;
}

function requireNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Pearl indexer field ${key} must be a number`);
  return value;
}
