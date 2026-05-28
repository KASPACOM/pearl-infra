import type {
  BridgeDepositWatchRequest,
  BridgeReserveWatchRequest,
  RegisterBridgeWatchInput,
  WatchedBridgeAddressWithHistory,
} from './types.js';
import {
  buildBridgeDepositWatch,
  buildBridgeReserveWatch,
} from './watch-registration.js';

export interface PearlBridgeIndexerClientOptions {
  baseUrl: string;
  timeoutMs?: number;
}

export class HttpPearlBridgeIndexerClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: PearlBridgeIndexerClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async registerDepositWatch(input: BridgeDepositWatchRequest): Promise<RegisterBridgeWatchInput> {
    const registration = buildBridgeDepositWatch(input);
    await this.postWatch(registration);
    return registration;
  }

  async registerReserveWatch(input: BridgeReserveWatchRequest): Promise<RegisterBridgeWatchInput> {
    const registration = buildBridgeReserveWatch(input);
    await this.postWatch(registration);
    return registration;
  }

  async getWatchHistory(watchId: string): Promise<WatchedBridgeAddressWithHistory> {
    const response = await fetch(`${this.baseUrl}/watches/${encodeURIComponent(watchId)}`, {
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (response.status === 404) {
      throw new Error(`Pearl bridge watch not found: ${watchId}`);
    }
    if (!response.ok) {
      throw new Error(`Pearl bridge watch fetch failed: ${response.status} ${await response.text()}`);
    }
    return parseWatchHistory(await response.json());
  }

  private async postWatch(registration: RegisterBridgeWatchInput): Promise<void> {
    const response = await fetch(`${this.baseUrl}/watches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toIndexerRequest(registration)),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (response.status !== 200 && response.status !== 201) {
      throw new Error(`Pearl bridge watch registration failed: ${response.status} ${await response.text()}`);
    }
  }
}

export function toIndexerRequest(registration: RegisterBridgeWatchInput): Record<string, unknown> {
  return {
    watch_id: registration.watchId,
    purpose: registration.purpose,
    network: registration.network,
    address: registration.address,
    required_confirmations: registration.requiredConfirmations,
    metadata: registration.metadata,
  };
}

export function parseWatchHistory(raw: unknown): WatchedBridgeAddressWithHistory {
  if (!isRecord(raw)) throw new Error('Pearl indexer watch response must be an object');
  return {
    watchId: requireString(raw, 'watchId'),
    purpose: requireEnum(raw, 'purpose', ['bridge_deposit', 'bridge_reserve']),
    network: requireEnum(raw, 'network', ['mainnet', 'testnet', 'testnet2', 'simnet', 'regtest']),
    address: requireString(raw, 'address'),
    requiredConfirmations: requireNumber(raw, 'requiredConfirmations'),
    status: requireEnum(raw, 'status', ['active', 'closed']),
    metadata: readMetadata(raw.metadata),
    createdAt: requireString(raw, 'createdAt'),
    updatedAt: requireString(raw, 'updatedAt'),
    observations: readArray(raw.observations).map(parseObservation),
    spends: readArray(raw.spends).map(parseSpend),
  };
}

function parseObservation(raw: unknown): WatchedBridgeAddressWithHistory['observations'][number] {
  if (!isRecord(raw)) throw new Error('Pearl indexer observation must be an object');
  return {
    outpoint: requireString(raw, 'outpoint'),
    watchId: requireString(raw, 'watchId'),
    blockHash: requireString(raw, 'blockHash'),
    height: requireNumber(raw, 'height'),
    amountGrains: requireString(raw, 'amountGrains'),
    confirmations: requireNumber(raw, 'confirmations'),
    matchStatus: requireEnum(raw, 'matchStatus', ['pending', 'confirmed', 'spent', 'detached']),
    classification: requireString(raw, 'classification'),
    observedAt: requireString(raw, 'observedAt'),
  };
}

function parseSpend(raw: unknown): WatchedBridgeAddressWithHistory['spends'][number] {
  if (!isRecord(raw)) throw new Error('Pearl indexer spend must be an object');
  return {
    spendTxid: requireString(raw, 'spendTxid'),
    spentOutpoint: requireString(raw, 'spentOutpoint'),
    blockHash: requireString(raw, 'blockHash'),
    height: requireNumber(raw, 'height'),
    classification: requireString(raw, 'classification'),
    classificationData: raw.classificationData === null || raw.classificationData === undefined
      ? null
      : readMetadata(raw.classificationData),
    observedAt: requireString(raw, 'observedAt'),
  };
}

function readArray(value: unknown): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Pearl indexer history arrays must be arrays');
  return value;
}

function readMetadata(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new Error('Pearl indexer metadata must be an object');
  return value;
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

function requireEnum<T extends string>(record: Record<string, unknown>, key: string, allowed: readonly T[]): T {
  const value = requireString(record, key);
  if (!allowed.includes(value as T)) throw new Error(`Pearl indexer field ${key} is invalid`);
  return value as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
