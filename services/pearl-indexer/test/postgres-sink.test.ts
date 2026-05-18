import assert from 'node:assert/strict';
import test from 'node:test';

import { PgBlockSink, type PgTransactionalClient } from '../src/postgres-sink.ts';
import type { PearlBlockSummary } from '../src/block-poller.ts';

interface QueryCall {
  text: string;
  params?: unknown[];
}

interface FakeRow {
  height?: number;
  detached?: boolean;
  hash?: string;
  value?: string;
}

class FakePg implements PgTransactionalClient {
  readonly calls: QueryCall[] = [];
  /** Per-query-pattern row fixtures; first regex match wins. */
  private readonly fixtures: Array<{ match: RegExp; rows: FakeRow[] }> = [];

  setFixture(matcher: RegExp, rows: FakeRow[]): void {
    this.fixtures.push({ match: matcher, rows });
  }

  async query(text: string, params?: unknown[]) {
    this.calls.push({ text, params });
    for (const fixture of this.fixtures) {
      if (fixture.match.test(text)) {
        return { rows: fixture.rows as never, rowCount: fixture.rows.length };
      }
    }
    return { rows: [] as never, rowCount: 0 };
  }

  async withTransaction<T>(fn: (tx: PgTransactionalClient) => Promise<T>): Promise<T> {
    this.calls.push({ text: 'BEGIN' });
    try {
      const result = await fn(this);
      this.calls.push({ text: 'COMMIT' });
      return result;
    } catch (err) {
      this.calls.push({ text: 'ROLLBACK' });
      throw err;
    }
  }
}

function makeBlock(height: number, hash: string, previousHash?: string): PearlBlockSummary {
  return {
    height,
    hash,
    previousHash,
    txids: [`tx-${height}`],
    inputs: [],
    outputs: [],
    timestamp: new Date(height * 1000).toISOString(),
  };
}

test('saves a brand-new block at height 0 with no parent check', async () => {
  const pg = new FakePg();
  const sink = new PgBlockSink(pg);

  const result = await sink.saveBlock(makeBlock(0, 'hash-0'));

  assert.deepEqual(result, { kind: 'saved' });
  assert.equal(pg.calls[0].text, 'BEGIN');
  assert.ok(pg.calls.some((c) => /INSERT INTO pearl_blocks/i.test(c.text)));
  assert.ok(pg.calls.some((c) => /indexer_state/i.test(c.text)));
  assert.equal(pg.calls[pg.calls.length - 1].text, 'COMMIT');
});

test('saves block whose previousHash matches indexed parent', async () => {
  const pg = new FakePg();
  pg.setFixture(/SELECT hash FROM pearl_blocks/i, [{ hash: 'hash-0' }]);
  const sink = new PgBlockSink(pg);

  const result = await sink.saveBlock(makeBlock(1, 'hash-1', 'hash-0'));

  assert.deepEqual(result, { kind: 'saved' });
});

test('detects reorg when previousHash does not match indexed parent', async () => {
  const pg = new FakePg();
  pg.setFixture(/SELECT hash FROM pearl_blocks/i, [{ hash: 'hash-0-stale' }]);
  const sink = new PgBlockSink(pg);

  const result = await sink.saveBlock(makeBlock(1, 'hash-1-new', 'hash-0-new'));

  assert.equal(result.kind, 'reorg');
  if (result.kind === 'reorg') {
    assert.equal(result.detachedFromHeight, 0);
    assert.equal(result.indexedHash, 'hash-0-stale');
    assert.equal(result.newPreviousHash, 'hash-0-new');
  }

  const markedDetached = pg.calls.some((c) => /UPDATE pearl_blocks SET detached = true/i.test(c.text));
  const insertedNew = pg.calls.some((c) => /INSERT INTO pearl_blocks/i.test(c.text));
  assert.equal(markedDetached, true, 'should mark stale parent detached');
  assert.equal(insertedNew, false, 'should NOT insert the new block on reorg detection');
});

test('returns duplicate for an already-indexed block', async () => {
  const pg = new FakePg();
  pg.setFixture(/SELECT height, detached FROM pearl_blocks/i, [{ height: 5, detached: false }]);
  const sink = new PgBlockSink(pg);

  const result = await sink.saveBlock(makeBlock(5, 'hash-5', 'hash-4'));

  assert.deepEqual(result, { kind: 'duplicate' });
});

test('loadNextHeight returns the persisted value', async () => {
  const pg = new FakePg();
  pg.setFixture(/SELECT value FROM indexer_state/i, [{ value: '42' }]);
  const sink = new PgBlockSink(pg);

  const next = await sink.loadNextHeight(0);

  assert.equal(next, 42);
});

test('loadNextHeight falls back to default when state is empty', async () => {
  const pg = new FakePg();
  const sink = new PgBlockSink(pg);

  const next = await sink.loadNextHeight(54000);

  assert.equal(next, 54000);
});
