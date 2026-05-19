import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodePearlBridgeLog,
  IgraBridgeEventPoller,
  InMemoryIgraBridgeCheckpointStore,
} from '../dist/igra-poller.js';
import { InMemoryBridgeStateRepository } from '../dist/repository.js';
import type { IgraLogClient, IgraRpcLog } from '../src/igra-poller.ts';

const EXIT_REQUESTED_TOPIC = '0x597fc4db481a96fed24b724817ee0f9cc9a920864680f5e7cd4bcfe94e58fcb6';
const EXIT_ID = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const REQUESTER = '0x1111111111111111111111111111111111111111';

test('decodes PearlBridge ExitRequested logs into bridge events', () => {
  const event = decodePearlBridgeLog(exitRequestedLog(), 19416, new Date('2026-05-19T00:00:00.000Z'));

  assert.equal(event.eventType, 'exit_requested');
  assert.equal(event.eventId, 'igra:19416:0xburn:7');
  assert.equal(event.payload.exitId, EXIT_ID);
  assert.equal(event.payload.requester, REQUESTER);
  assert.equal(event.payload.pearlRecipient, 'tprl1recipient');
  assert.equal(event.payload.amountGrains, '100000000');
});

test('polls Igra logs, checkpoints blocks, persists events, and mirrors exit rows', async () => {
  const repo = new InMemoryBridgeStateRepository();
  const checkpoint = new InMemoryIgraBridgeCheckpointStore();
  const client = new FakeIgraClient(130, [exitRequestedLog()]);
  const poller = new IgraBridgeEventPoller({
    client,
    bridgeAddress: '0x2222222222222222222222222222222222222222',
    chainId: 19416,
    eventRepository: repo,
    exitRepository: repo,
    checkpointStore: checkpoint,
    startBlock: 100,
    confirmations: 5,
    maxBlockRange: 10,
  });

  const first = await poller.pollOnce(new Date('2026-05-19T00:00:00.000Z'));
  const second = await poller.pollOnce(new Date('2026-05-19T00:01:00.000Z'));

  assert.deepEqual(first, {
    fromBlock: 100,
    toBlock: 109,
    latestSafeBlock: 125,
    logsRead: 1,
    eventsSaved: 1,
    exitsTouched: 1,
  });
  assert.equal(second.fromBlock, 110);
  assert.equal((await repo.listIgraEvents()).length, 1);
  assert.equal((await repo.findExitRequest(EXIT_ID))?.requestedAmountGrains, '100000000');
});

test('replays duplicate persisted events into exits before checkpointing', async () => {
  const eventRepo = new InMemoryBridgeStateRepository();
  const exitRepo = new InMemoryBridgeStateRepository();
  const checkpoint = new InMemoryIgraBridgeCheckpointStore();
  const log = exitRequestedLog({ blockNumber: '0x64', logIndex: '0x0' });
  const existingEvent = decodePearlBridgeLog(log, 19416, new Date('2026-05-19T00:00:00.000Z'));
  await eventRepo.saveIgraEvent(existingEvent);
  const poller = new IgraBridgeEventPoller({
    client: new FakeIgraClient(100, [log]),
    bridgeAddress: '0x2222222222222222222222222222222222222222',
    chainId: 19416,
    eventRepository: eventRepo,
    exitRepository: exitRepo,
    checkpointStore: checkpoint,
    startBlock: 100,
  });

  const result = await poller.pollOnce(new Date('2026-05-19T00:01:00.000Z'));

  assert.equal(result.eventsSaved, 0);
  assert.equal(result.exitsTouched, 1);
  assert.equal((await exitRepo.findExitRequest(EXIT_ID))?.status, 'pending');
  assert.equal(await checkpoint.loadNextBlock(100), 101);
});

test('rejects logs returned for a different bridge address', async () => {
  const poller = new IgraBridgeEventPoller({
    client: new FakeIgraClient(100, [exitRequestedLog({ address: '0x3333333333333333333333333333333333333333' })]),
    bridgeAddress: '0x2222222222222222222222222222222222222222',
    chainId: 19416,
    eventRepository: new InMemoryBridgeStateRepository(),
    exitRepository: new InMemoryBridgeStateRepository(),
    checkpointStore: new InMemoryIgraBridgeCheckpointStore(),
    startBlock: 100,
  });

  await assert.rejects(
    () => poller.pollOnce(),
    /Igra log address mismatch/,
  );
});

test('validates poller range options before live polling', () => {
  const base = {
    client: new FakeIgraClient(100, []),
    bridgeAddress: '0x2222222222222222222222222222222222222222',
    chainId: 19416,
    eventRepository: new InMemoryBridgeStateRepository(),
    exitRepository: new InMemoryBridgeStateRepository(),
    checkpointStore: new InMemoryIgraBridgeCheckpointStore(),
    startBlock: 100,
  };

  assert.throws(() => new IgraBridgeEventPoller({ ...base, confirmations: -1 }), /confirmations/);
  assert.throws(() => new IgraBridgeEventPoller({ ...base, maxBlockRange: 0 }), /maxBlockRange/);
});

class FakeIgraClient implements IgraLogClient {
  private readonly latest: number;
  private readonly logs: IgraRpcLog[];

  constructor(latest: number, logs: IgraRpcLog[]) {
    this.latest = latest;
    this.logs = logs;
  }

  async getBlockNumber(): Promise<number> {
    return this.latest;
  }

  async getLogs(): Promise<IgraRpcLog[]> {
    return this.logs;
  }
}

function exitRequestedLog(overrides: Partial<IgraRpcLog> = {}): IgraRpcLog {
  return {
    address: '0x2222222222222222222222222222222222222222',
    topics: [
      EXIT_REQUESTED_TOPIC,
      EXIT_ID,
      addressTopic(REQUESTER),
    ],
    data: abiExitRequestedData('tprl1recipient', '100000000'),
    blockNumber: '0x7b',
    transactionHash: '0xBURN',
    logIndex: '0x7',
    ...overrides,
  };
}

function abiExitRequestedData(pearlRecipient: string, amountGrains: string): string {
  const encoded = Buffer.from(pearlRecipient, 'utf8').toString('hex');
  const paddedBytes = encoded.padEnd(Math.ceil(encoded.length / 64) * 64, '0');
  return `0x${word(64n)}${word(BigInt(amountGrains))}${word(BigInt(encoded.length / 2))}${paddedBytes}`;
}

function addressTopic(address: string): string {
  return `0x${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`;
}

function word(value: bigint): string {
  return value.toString(16).padStart(64, '0');
}
