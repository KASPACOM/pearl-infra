import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PgBridgeExitRequestRepository,
  PgIgraBridgeCheckpointStore,
  type PgTransactionalClient,
} from '../src/postgres-exits.ts';
import type { BridgeExitRequest } from '../src/types.ts';

interface QueryCall {
  text: string;
  params?: unknown[];
}

type FakeRow = Record<string, unknown>;

class FakePg implements PgTransactionalClient {
  readonly calls: QueryCall[] = [];
  private readonly exits = new Map<string, FakeRow>();
  private readonly state = new Map<string, string>();

  async query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, params: unknown[] = []) {
    this.calls.push({ text, params });

    if (/SELECT value FROM indexer_state/i.test(text)) {
      const value = this.state.get(params[0] as string);
      return { rows: (value ? [{ value }] : []) as R[], rowCount: value ? 1 : 0 };
    }
    if (/INSERT INTO indexer_state/i.test(text)) {
      this.state.set(params[0] as string, params[1] as string);
      return { rows: [] as R[], rowCount: 1 };
    }
    if (/SELECT .*FROM bridge_exit_requests\s+WHERE igra_burn_txid/is.test(text)) {
      const row = this.exits.get(exitKey(params[0] as string, params[1] as number));
      return { rows: (row ? [row] : []) as R[], rowCount: row ? 1 : 0 };
    }
    if (/INSERT INTO bridge_exit_requests/is.test(text)) {
      const key = exitKey(params[0] as string, params[1] as number);
      const previous = this.exits.get(key);
      const row = paramsToExitRow(params, previous);
      this.exits.set(key, row);
      return { rows: [row] as R[], rowCount: 1 };
    }
    if (/WHERE exit_id = \$1/i.test(text)) {
      const row = [...this.exits.values()].find((candidate) => candidate.exit_id === params[0]);
      return { rows: (row ? [row] : []) as R[], rowCount: row ? 1 : 0 };
    }
    if (/FROM bridge_exit_requests/is.test(text)) {
      return { rows: [...this.exits.values()] as R[], rowCount: this.exits.size };
    }
    return { rows: [] as R[], rowCount: 0 };
  }

  async withTransaction<T>(fn: (tx: PgTransactionalClient) => Promise<T>): Promise<T> {
    this.calls.push({ text: 'BEGIN' });
    try {
      const result = await fn(this);
      this.calls.push({ text: 'COMMIT' });
      return result;
    } catch (error) {
      this.calls.push({ text: 'ROLLBACK' });
      throw error;
    }
  }
}

test('upserts bridge exits into bridge_exit_requests without regressing released rows', async () => {
  const pg = new FakePg();
  const repo = new PgBridgeExitRequestRepository(pg);

  assert.equal((await repo.upsertExitRequest(exit({ status: 'pending' }))).created, true);
  assert.equal((await repo.upsertExitRequest(exit({
    status: 'released',
    pearlReleaseTxid: 'release_tx',
    pearlReleaseBlock: 200,
    releasedAt: '2026-05-19T00:10:00.000Z',
  }))).created, false);
  assert.equal((await repo.upsertExitRequest(exit({ status: 'pending' }))).exit.status, 'released');

  const saved = await repo.findExitRequest('exit-1');
  assert.equal(saved?.status, 'released');
  assert.equal(saved?.pearlReleaseTxid, 'release_tx');
  assert.ok(pg.calls.some((call) => /ON CONFLICT \(igra_burn_txid, igra_burn_log_index\)/i.test(call.text)));
});

test('stores Igra poll checkpoints in indexer_state', async () => {
  const pg = new FakePg();
  const checkpoint = new PgIgraBridgeCheckpointStore(pg, {
    chainId: 19416,
    bridgeAddress: '0x2222222222222222222222222222222222222222',
  });

  assert.equal(await checkpoint.loadNextBlock(100), 100);
  await checkpoint.saveNextBlock(123);
  assert.equal(await checkpoint.loadNextBlock(100), 123);
});

function paramsToExitRow(params: unknown[], previous?: FakeRow): FakeRow {
  const nextStatus = params[7] as string;
  const previousStatus = previous?.status as string | undefined;
  const status = previousStatus && ['released', 'refunded', 'cancelled'].includes(previousStatus) && nextStatus === 'pending'
    ? previousStatus
    : nextStatus;
  return {
    igra_burn_txid: params[0],
    igra_burn_log_index: params[1],
    igra_burn_block: params[2],
    igra_chain_id: params[3],
    exit_id: params[4],
    requested_amount_grains: params[5],
    pearl_recipient: params[6],
    status,
    pearl_release_txid: params[8] ?? previous?.pearl_release_txid ?? null,
    pearl_release_block: params[9] ?? previous?.pearl_release_block ?? null,
    released_at: params[10] ? new Date(params[10] as string) : previous?.released_at ?? null,
    metadata: {
      ...((previous?.metadata as Record<string, unknown> | undefined) ?? {}),
      ...(JSON.parse(params[11] as string) as Record<string, unknown>),
    },
    created_at: previous?.created_at ?? new Date(params[12] as string),
    updated_at: new Date(params[13] as string),
  };
}

function exit(overrides: Partial<BridgeExitRequest> = {}): BridgeExitRequest {
  return {
    exitId: 'exit-1',
    igraBurnTxid: '0xburn',
    igraBurnLogIndex: 0,
    igraBurnBlock: 100,
    igraChainId: 19416,
    requestedAmountGrains: '100',
    pearlRecipient: 'tprl1recipient',
    status: 'pending',
    createdAt: '2026-05-19T00:00:00.000Z',
    updatedAt: '2026-05-19T00:00:00.000Z',
    ...overrides,
  };
}

function exitKey(txid: string, logIndex: number): string {
  return `${txid}:${logIndex}`;
}
