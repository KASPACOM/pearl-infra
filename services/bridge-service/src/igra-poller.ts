import {
  applyIgraBridgeEventToExitRepository,
  mirrorIgraBridgeEvent,
} from './igra-events.js';
import type { BridgeExitRequestRepository, BridgeStateRepository } from './repository.js';
import type { IgraBridgeEvent, IgraBridgeEventType } from './types.js';

const EVENT_TOPICS: Record<string, IgraBridgeEventType> = {
  '0xa76f05a6c07c3e3fdc7f55ef7a584a33a376ef3cb0e5a276efe26a1bd562a5a8': 'deposit_claimed',
  '0x597fc4db481a96fed24b724817ee0f9cc9a920864680f5e7cd4bcfe94e58fcb6': 'exit_requested',
  '0x4aed4d832fc1b10d1ce31c1c59dcf25cf7b4787fc08e5f1dba598e3b5e6f9640': 'exit_processed',
  '0x589c383952ebb582ab9efe809246aa17bd78035a2a9992687e801c44ad252530': 'exit_refunded',
  '0x665a42636197ac675d1afe6acdc6e4ab4199f0c8a4807c4bc9f52f59ea0f6ebf': 'caps_updated',
  '0x4b36b2e66f38ed349bec532105790177f1283bcbc094e6cd48565195d3033c43': 'relayer_updated',
  '0x966c160e1c4dbc7df8d69af4ace01e9297c3cf016397b7914971f2fbfa32672d': 'operator_updated',
  '0xa83dea07ca0773195eee63ec0775c7c53322e3825ce504fee1bdcec558e1e81b': 'entry_paused',
  '0x0996dc8352edbd58d0c45dac53be4390fe4a42d5b0f046748535435e2399848c': 'exit_request_paused',
  '0xf4eecbc719c3345f721838a54b527c937d87a18b0362e4569e08870c423cbffa': 'exit_processing_paused',
};

export const PEARL_BRIDGE_EVENT_TOPICS = Object.keys(EVENT_TOPICS);

export interface IgraRpcLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
}

export interface IgraLogFilter {
  address: string;
  fromBlock: number;
  toBlock: number;
  topics?: unknown[];
}

export interface IgraLogClient {
  getBlockNumber(): Promise<number>;
  getLogs(filter: IgraLogFilter): Promise<IgraRpcLog[]>;
}

export interface IgraBridgePollerCheckpointStore {
  loadNextBlock(defaultStartBlock: number): Promise<number>;
  saveNextBlock(nextBlock: number): Promise<void>;
}

export interface IgraBridgeEventPollerOptions {
  client: IgraLogClient;
  bridgeAddress: string;
  chainId: number;
  eventRepository: Pick<BridgeStateRepository, 'saveIgraEvent'>;
  exitRepository: BridgeExitRequestRepository;
  checkpointStore: IgraBridgePollerCheckpointStore;
  startBlock: number;
  confirmations?: number;
  maxBlockRange?: number;
}

export interface IgraBridgePollResult {
  fromBlock: number;
  toBlock: number;
  latestSafeBlock: number;
  logsRead: number;
  eventsSaved: number;
  exitsTouched: number;
}

export class IgraBridgeEventPoller {
  private readonly options: Required<Pick<IgraBridgeEventPollerOptions, 'confirmations' | 'maxBlockRange'>> & IgraBridgeEventPollerOptions;

  constructor(options: IgraBridgeEventPollerOptions) {
    assertPositiveInteger(options.chainId, 'chainId');
    assertPositiveInteger(options.startBlock, 'startBlock');
    this.options = {
      confirmations: 0,
      maxBlockRange: 1_000,
      ...options,
      bridgeAddress: normalizeAddress(options.bridgeAddress),
    };
  }

  async pollOnce(now = new Date()): Promise<IgraBridgePollResult> {
    const latest = await this.options.client.getBlockNumber();
    const latestSafeBlock = latest - this.options.confirmations;
    const fromBlock = await this.options.checkpointStore.loadNextBlock(this.options.startBlock);
    if (latestSafeBlock < fromBlock) {
      return {
        fromBlock,
        toBlock: fromBlock - 1,
        latestSafeBlock,
        logsRead: 0,
        eventsSaved: 0,
        exitsTouched: 0,
      };
    }

    const toBlock = Math.min(latestSafeBlock, fromBlock + this.options.maxBlockRange - 1);
    const logs = await this.options.client.getLogs({
      address: this.options.bridgeAddress,
      fromBlock,
      toBlock,
      topics: [PEARL_BRIDGE_EVENT_TOPICS],
    });

    let eventsSaved = 0;
    let exitsTouched = 0;
    for (const log of logs) {
      const event = decodePearlBridgeLog(log, this.options.chainId, now);
      const saved = await this.options.eventRepository.saveIgraEvent(event);
      if (!saved.created) continue;
      eventsSaved += 1;
      const applied = await applyIgraBridgeEventToExitRepository(this.options.exitRepository, event, now);
      if (applied.action === 'exit_created' || applied.action === 'exit_updated') exitsTouched += 1;
    }

    await this.options.checkpointStore.saveNextBlock(toBlock + 1);
    return {
      fromBlock,
      toBlock,
      latestSafeBlock,
      logsRead: logs.length,
      eventsSaved,
      exitsTouched,
    };
  }
}

export class IgraJsonRpcClient implements IgraLogClient {
  private readonly url: string;
  private nextId = 1;

  constructor(url: string) {
    if (url.trim() === '') throw new Error('Igra RPC URL is required');
    this.url = url;
  }

  async getBlockNumber(): Promise<number> {
    const hex = await this.request<string>('eth_blockNumber', []);
    return hexToNumber(hex, 'blockNumber');
  }

  async getLogs(filter: IgraLogFilter): Promise<IgraRpcLog[]> {
    return this.request<IgraRpcLog[]>('eth_getLogs', [{
      address: normalizeAddress(filter.address),
      fromBlock: numberToHex(filter.fromBlock),
      toBlock: numberToHex(filter.toBlock),
      ...(filter.topics ? { topics: filter.topics } : {}),
    }]);
  }

  private async request<T>(method: string, params: unknown[]): Promise<T> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: this.nextId++,
        method,
        params,
      }),
    });
    if (!response.ok) throw new Error(`Igra RPC ${method} failed: HTTP ${response.status}`);
    const body = await response.json() as { result?: T; error?: { message?: string } };
    if (body.error) throw new Error(`Igra RPC ${method} failed: ${body.error.message ?? 'unknown error'}`);
    if (body.result === undefined) throw new Error(`Igra RPC ${method} returned no result`);
    return body.result;
  }
}

export class InMemoryIgraBridgeCheckpointStore implements IgraBridgePollerCheckpointStore {
  private nextBlock?: number;

  async loadNextBlock(defaultStartBlock: number): Promise<number> {
    return this.nextBlock ?? defaultStartBlock;
  }

  async saveNextBlock(nextBlock: number): Promise<void> {
    this.nextBlock = nextBlock;
  }
}

export function decodePearlBridgeLog(log: IgraRpcLog, chainId: number, now = new Date()): IgraBridgeEvent {
  const topic0 = normalizeTopic(log.topics[0] ?? '');
  const eventType = EVENT_TOPICS[topic0];
  if (!eventType) throw new Error(`unsupported PearlBridge event topic: ${topic0}`);
  const payload = decodePayload(eventType, log.topics.map(normalizeTopic), normalizeHex(log.data));
  return mirrorIgraBridgeEvent({
    eventType,
    txHash: log.transactionHash,
    logIndex: hexToNumber(log.logIndex, 'logIndex'),
    blockNumber: hexToNumber(log.blockNumber, 'blockNumber'),
    chainId,
    payload,
    observedAt: now.toISOString(),
  });
}

function decodePayload(eventType: IgraBridgeEventType, topics: string[], data: string): Record<string, string | number | boolean | null> {
  if (eventType === 'deposit_claimed') {
    return {
      claimId: topicBytes32(topics, 1),
      pearlTxid: topicBytes32(topics, 2),
      vout: Number(topicBigInt(topics, 3)),
      recipient: wordAddress(data, 0),
      amountGrains: wordBigInt(data, 1).toString(),
    };
  }
  if (eventType === 'exit_requested') {
    return {
      exitId: topicBytes32(topics, 1),
      requester: topicAddress(topics, 2),
      pearlRecipient: abiString(data, Number(wordBigInt(data, 0))),
      amountGrains: wordBigInt(data, 1).toString(),
    };
  }
  if (eventType === 'exit_processed') {
    return {
      exitId: topicBytes32(topics, 1),
      pearlReleaseTxid: topicBytes32(topics, 2),
      operator: topicAddress(topics, 3),
    };
  }
  if (eventType === 'exit_refunded') {
    return {
      exitId: topicBytes32(topics, 1),
      requester: topicAddress(topics, 2),
      operator: topicAddress(topics, 3),
      amountGrains: wordBigInt(data, 0).toString(),
    };
  }
  if (eventType === 'caps_updated') {
    return {
      minDepositGrains: wordBigInt(data, 0).toString(),
      maxDepositGrains: wordBigInt(data, 1).toString(),
      minExitGrains: wordBigInt(data, 2).toString(),
      maxExitGrains: wordBigInt(data, 3).toString(),
      rollingWindowSeconds: wordBigInt(data, 4).toString(),
      rollingWindowMintCapGrains: wordBigInt(data, 5).toString(),
      pilotSupplyCapGrains: wordBigInt(data, 6).toString(),
    };
  }
  if (eventType === 'relayer_updated') {
    return { relayer: topicAddress(topics, 1), enabled: wordBool(data, 0) };
  }
  if (eventType === 'operator_updated') {
    return { operator: topicAddress(topics, 1), enabled: wordBool(data, 0) };
  }
  if (eventType === 'entry_paused' || eventType === 'exit_request_paused' || eventType === 'exit_processing_paused') {
    return { actor: topicAddress(topics, 1), paused: wordBool(data, 0) };
  }
  return {};
}

function topicBytes32(topics: string[], index: number): string {
  const topic = topics[index];
  if (!topic) throw new Error(`missing topic ${index}`);
  return topic;
}

function topicAddress(topics: string[], index: number): string {
  const topic = topicBytes32(topics, index);
  return `0x${topic.slice(-40)}`.toLowerCase();
}

function topicBigInt(topics: string[], index: number): bigint {
  return BigInt(topicBytes32(topics, index));
}

function word(data: string, index: number): string {
  const normalized = normalizeHex(data).slice(2);
  const start = index * 64;
  const value = normalized.slice(start, start + 64);
  if (value.length !== 64) throw new Error(`missing ABI word ${index}`);
  return `0x${value}`;
}

function wordBigInt(data: string, index: number): bigint {
  return BigInt(word(data, index));
}

function wordAddress(data: string, index: number): string {
  return `0x${word(data, index).slice(-40)}`.toLowerCase();
}

function wordBool(data: string, index: number): boolean {
  const value = wordBigInt(data, index);
  if (value !== 0n && value !== 1n) throw new Error(`ABI word ${index} is not bool`);
  return value === 1n;
}

function abiString(data: string, byteOffset: number): string {
  if (!Number.isInteger(byteOffset) || byteOffset < 0 || byteOffset % 32 !== 0) {
    throw new Error('invalid ABI string offset');
  }
  const length = Number(wordBigIntAtByteOffset(data, byteOffset));
  const normalized = normalizeHex(data).slice(2);
  const start = (byteOffset + 32) * 2;
  const hex = normalized.slice(start, start + length * 2);
  if (hex.length !== length * 2) throw new Error('truncated ABI string');
  return Buffer.from(hex, 'hex').toString('utf8');
}

function wordBigIntAtByteOffset(data: string, byteOffset: number): bigint {
  return wordBigInt(data, byteOffset / 32);
}

function normalizeTopic(value: string): string {
  const hex = normalizeHex(value).toLowerCase();
  if (hex.length !== 66) throw new Error(`invalid topic: ${value}`);
  return hex;
}

function normalizeAddress(value: string): string {
  const hex = normalizeHex(value).toLowerCase();
  if (hex.length !== 42) throw new Error(`invalid address: ${value}`);
  return hex;
}

function normalizeHex(value: string): string {
  if (!/^0x[0-9a-fA-F]*$/.test(value)) throw new Error(`invalid hex: ${value}`);
  return value.length % 2 === 0 ? value : `0x0${value.slice(2)}`;
}

function hexToNumber(value: string, field: string): number {
  const parsed = Number(BigInt(normalizeHex(value)));
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${field} is not a safe integer`);
  return parsed;
}

function numberToHex(value: number): string {
  assertNonNegativeInteger(value, 'block');
  return `0x${value.toString(16)}`;
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${field} must be a positive integer`);
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer`);
}
