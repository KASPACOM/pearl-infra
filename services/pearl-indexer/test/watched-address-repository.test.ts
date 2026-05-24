import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MemoryWatchedAddressRepository,
  PgWatchedAddressRepository,
  WatchConflictError,
  WatchNotFoundError,
} from '../src/watched-address-repository.ts';
import type { PgTransactionalClient } from '../src/postgres-sink.ts';
import type { RegisterWatchInput } from '../src/watched-address-types.ts';

interface QueryCall {
  text: string;
  params?: unknown[];
}

type Row = Record<string, unknown>;

class FakePg implements PgTransactionalClient {
  readonly calls: QueryCall[] = [];
  private readonly fixtures: Array<{ match: RegExp; handler: (params?: unknown[]) => Row[] }> = [];

  setFixture(matcher: RegExp, rows: Row[] | ((params?: unknown[]) => Row[])): void {
    const handler = typeof rows === 'function' ? rows : () => rows;
    this.fixtures.push({ match: matcher, handler });
  }

  async query(text: string, params?: unknown[]) {
    this.calls.push({ text, params });
    for (const fixture of this.fixtures) {
      if (fixture.match.test(text)) {
        const rows = fixture.handler(params);
        return { rows: rows as never, rowCount: rows.length };
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

function input(overrides: Partial<RegisterWatchInput> = {}): RegisterWatchInput {
  return {
    watchId: 'watch-1',
    purpose: 'otc_escrow',
    network: 'testnet2',
    address: 'tprl1pwatch1',
    requiredConfirmations: 6,
    metadata: { expected_amount_grains: '12500000000' },
    ...overrides,
  };
}

const FIXED_AT = new Date('2026-05-17T10:00:00.000Z');

function pgRow(overrides: Partial<Row> = {}): Row {
  return {
    watch_id: 'watch-1',
    purpose: 'otc_escrow',
    network: 'testnet2',
    address: 'tprl1pwatch1',
    required_confirmations: 6,
    status: 'active',
    metadata: { expected_amount_grains: '12500000000' },
    created_at: FIXED_AT,
    updated_at: FIXED_AT,
    ...overrides,
  };
}

// ---- PgWatchedAddressRepository ----

test('Pg.register inserts when no row exists', async () => {
  const pg = new FakePg();
  pg.setFixture(/INSERT INTO watched_addresses/, [pgRow()]);
  const repo = new PgWatchedAddressRepository(pg);

  const result = await repo.register(input());

  assert.equal(result.created, true);
  assert.equal(result.watch.watchId, 'watch-1');
  assert.equal(result.watch.status, 'active');
  assert.ok(pg.calls.some((c) => c.text === 'BEGIN'));
  assert.ok(pg.calls.some((c) => c.text === 'COMMIT'));
});

test('Pg.register returns existing row when params are identical', async () => {
  const pg = new FakePg();
  pg.setFixture(/SELECT watch_id.*FROM watched_addresses WHERE watch_id = \$1 FOR UPDATE/s, [pgRow()]);
  pg.setFixture(/UPDATE watched_addresses\s+SET metadata = \$2::jsonb \|\| metadata/s, [pgRow()]);
  const repo = new PgWatchedAddressRepository(pg);

  const result = await repo.register(input());

  assert.equal(result.created, false);
  assert.equal(result.watch.watchId, 'watch-1');
  assert.equal(result.watch.metadata.expected_amount_grains, '12500000000');
  assert.ok(!pg.calls.some((c) => /INSERT INTO watched_addresses/.test(c.text)));
});

test('Pg.register throws WatchConflictError on differing scalars', async () => {
  const pg = new FakePg();
  pg.setFixture(
    /SELECT watch_id.*FROM watched_addresses WHERE watch_id = \$1 FOR UPDATE/s,
    [pgRow({ address: 'tprl1pdifferent', required_confirmations: 3 })],
  );
  const repo = new PgWatchedAddressRepository(pg);

  await assert.rejects(
    () => repo.register(input()),
    (err: unknown) => {
      assert.ok(err instanceof WatchConflictError);
      assert.deepEqual([...err.differingFields].sort(), ['address', 'required_confirmations']);
      return true;
    },
  );
  assert.ok(pg.calls.some((c) => c.text === 'ROLLBACK'));
});

test('Pg.register fills missing metadata without overwriting existing keys', async () => {
  const pg = new FakePg();
  pg.setFixture(
    /SELECT watch_id.*FROM watched_addresses WHERE watch_id = \$1 FOR UPDATE/s,
    [pgRow({ metadata: { expected_amount_grains: '12500000000', release_address: 'tprl1poriginal' } })],
  );
  pg.setFixture(
    /UPDATE watched_addresses\s+SET metadata = \$2::jsonb \|\| metadata/s,
    [pgRow({
      metadata: {
        expected_amount_grains: '12500000000',
        release_address: 'tprl1poriginal',
        refund_address: 'tprl1psellerrefund',
      },
    })],
  );
  const repo = new PgWatchedAddressRepository(pg);

  const result = await repo.register(input({
    metadata: {
      release_address: 'tprl1poverwrite',
      refund_address: 'tprl1psellerrefund',
    },
  }));

  assert.equal(result.created, false);
  assert.equal(result.watch.metadata.expected_amount_grains, '12500000000');
  assert.equal(result.watch.metadata.release_address, 'tprl1poriginal');
  assert.equal(result.watch.metadata.refund_address, 'tprl1psellerrefund');
});

test('Pg.get returns null when no row', async () => {
  const pg = new FakePg();
  const repo = new PgWatchedAddressRepository(pg);

  const result = await repo.get('missing');

  assert.equal(result, null);
});

test('Pg.get joins observations and spends', async () => {
  const pg = new FakePg();
  pg.setFixture(
    /SELECT watch_id.*FROM watched_addresses WHERE watch_id = \$1$/s,
    [pgRow()],
  );
  pg.setFixture(/FROM address_observations\s+WHERE watch_id/s, [
    {
      outpoint: 'tx1:0',
      watch_id: 'watch-1',
      block_hash: 'b1',
      height: 100,
      amount_grains: '12500000000',
      confirmations: 6,
      match_status: 'confirmed',
      classification: 'on_time',
      observed_at: FIXED_AT,
    },
  ]);
  pg.setFixture(/FROM address_spends s\s+JOIN address_observations o/s, [
    {
      spend_txid: 'spend1',
      spent_outpoint: 'tx1:0',
      block_hash: 'b2',
      height: 110,
      classification: 'release',
      classification_data: { recipient: 'tprl1pbuyer' },
      observed_at: FIXED_AT,
    },
  ]);
  const repo = new PgWatchedAddressRepository(pg);

  const result = await repo.get('watch-1');

  assert.ok(result);
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].matchStatus, 'confirmed');
  assert.equal(result.observations[0].classification, 'on_time');
  assert.equal(result.spends.length, 1);
  assert.equal(result.spends[0].classification, 'release');
});

test('Pg.close throws WatchNotFoundError when missing', async () => {
  const pg = new FakePg();
  const repo = new PgWatchedAddressRepository(pg);

  await assert.rejects(() => repo.close('missing'), WatchNotFoundError);
});

test('Pg.close updates status to closed', async () => {
  const pg = new FakePg();
  pg.setFixture(/UPDATE watched_addresses/, [pgRow({ status: 'closed' })]);
  const repo = new PgWatchedAddressRepository(pg);

  const result = await repo.close('watch-1');

  assert.equal(result.status, 'closed');
});

test('Pg.listActive returns empty array for empty purposes', async () => {
  const pg = new FakePg();
  const repo = new PgWatchedAddressRepository(pg);

  const result = await repo.listActive([]);

  assert.deepEqual(result, []);
  assert.equal(pg.calls.length, 0);
});

test('Pg.listActive filters on status=active and given purposes', async () => {
  const pg = new FakePg();
  pg.setFixture(/FROM watched_addresses\s+WHERE status = 'active'/s, [
    pgRow({ watch_id: 'w1', purpose: 'bridge_deposit' }),
    pgRow({ watch_id: 'w2', purpose: 'bridge_deposit' }),
  ]);
  const repo = new PgWatchedAddressRepository(pg);

  const result = await repo.listActive(['bridge_deposit']);

  assert.equal(result.length, 2);
  const call = pg.calls.find((c) => /FROM watched_addresses/.test(c.text));
  assert.ok(call);
  assert.deepEqual(call.params, [['bridge_deposit']]);
});

test('Pg.recordSpend inserts spend and marks observation spent', async () => {
  const pg = new FakePg();
  pg.setFixture(/INSERT INTO address_spends/s, [
    {
      spend_txid: 'spend1',
      spent_outpoint: 'tx1:0',
      block_hash: 'b2',
      height: 110,
      classification: 'unknown_spend',
      classification_data: { reason: 'no_release_or_refund_template_match' },
      observed_at: FIXED_AT,
    },
  ]);
  const repo = new PgWatchedAddressRepository(pg);

  const result = await repo.recordSpend({
    spendTxid: 'spend1',
    spentOutpoint: 'tx1:0',
    blockHash: 'b2',
    height: 110,
    classification: 'unknown_spend',
    classificationData: { reason: 'no_release_or_refund_template_match' },
  });

  assert.equal(result.classification, 'unknown_spend');
  assert.ok(pg.calls.some((c) => c.text === 'BEGIN'));
  assert.ok(pg.calls.some((c) => /UPDATE address_observations\s+SET match_status = 'spent'/s.test(c.text)));
  assert.ok(pg.calls.some((c) => c.text === 'COMMIT'));
});

// ---- MemoryWatchedAddressRepository ----

test('Memory.register inserts then reads back', async () => {
  const repo = new MemoryWatchedAddressRepository();

  const created = await repo.register(input());
  assert.equal(created.created, true);

  const fetched = await repo.get('watch-1');
  assert.ok(fetched);
  assert.equal(fetched.observations.length, 0);
  assert.equal(fetched.spends.length, 0);
});

test('Memory.register fills missing metadata without overwriting existing keys', async () => {
  const repo = new MemoryWatchedAddressRepository();
  await repo.register(input({ metadata: { expected_amount_grains: '12500000000', release_address: 'tprl1poriginal' } }));

  const second = await repo.register(input({
    metadata: {
      release_address: 'tprl1poverwrite',
      refund_address: 'tprl1psellerrefund',
    },
  }));

  assert.equal(second.created, false);
  assert.equal(second.watch.metadata.expected_amount_grains, '12500000000');
  assert.equal(second.watch.metadata.release_address, 'tprl1poriginal');
  assert.equal(second.watch.metadata.refund_address, 'tprl1psellerrefund');
});

test('Memory.register conflicts on differing scalars', async () => {
  const repo = new MemoryWatchedAddressRepository();
  await repo.register(input());

  await assert.rejects(
    () => repo.register(input({ address: 'tprl1pother', requiredConfirmations: 3 })),
    (err: unknown) => {
      assert.ok(err instanceof WatchConflictError);
      assert.deepEqual([...err.differingFields].sort(), ['address', 'required_confirmations']);
      return true;
    },
  );
});

test('Memory.get returns null on miss', async () => {
  const repo = new MemoryWatchedAddressRepository();
  assert.equal(await repo.get('missing'), null);
});

test('Memory.close marks status closed; idempotent', async () => {
  const repo = new MemoryWatchedAddressRepository();
  await repo.register(input());

  const first = await repo.close('watch-1');
  assert.equal(first.status, 'closed');

  const second = await repo.close('watch-1');
  assert.equal(second.status, 'closed');
});

test('Memory.close throws when missing', async () => {
  const repo = new MemoryWatchedAddressRepository();
  await assert.rejects(() => repo.close('missing'), WatchNotFoundError);
});

test('Memory.listActive filters active + purpose, excludes closed', async () => {
  const repo = new MemoryWatchedAddressRepository();
  await repo.register(input({ watchId: 'a', purpose: 'otc_escrow' }));
  await repo.register(input({ watchId: 'b', purpose: 'bridge_deposit' }));
  await repo.register(input({ watchId: 'c', purpose: 'bridge_reserve' }));
  await repo.close('a');

  const active = await repo.listActive(['otc_escrow', 'bridge_deposit']);

  assert.deepEqual(
    active.map((w) => w.watchId).sort(),
    ['b'],
  );
});

test('Memory.listActive empty purposes returns empty', async () => {
  const repo = new MemoryWatchedAddressRepository();
  await repo.register(input());

  assert.deepEqual(await repo.listActive([]), []);
});

test('Memory.recordSpend persists spend and marks observation spent', async () => {
  const repo = new MemoryWatchedAddressRepository();
  await repo.register(input());
  await repo.recordObservation({
    outpoint: 'funding:0',
    watchId: 'watch-1',
    blockHash: 'b1',
    height: 100,
    amountGrains: '12500000000',
    classification: 'on_time',
  });

  const spend = await repo.recordSpend({
    spendTxid: 'spend1',
    spentOutpoint: 'funding:0',
    blockHash: 'b2',
    height: 101,
    classification: 'release',
    classificationData: { matchedBy: 'release_template' },
  });
  const fetched = await repo.get('watch-1');

  assert.equal(spend.classification, 'release');
  assert.ok(fetched);
  assert.equal(fetched.spends.length, 1);
  assert.equal(fetched.observations[0].matchStatus, 'spent');
  assert.equal(fetched.observations[0].classification, 'on_time');
});

test('Memory.advanceConfirmations marks one-confirmation observations confirmed', async () => {
  const repo = new MemoryWatchedAddressRepository();
  await repo.register(input({ requiredConfirmations: 1 }));
  await repo.recordObservation({
    outpoint: 'funding:0',
    watchId: 'watch-1',
    blockHash: 'b1',
    height: 100,
    amountGrains: '12500000000',
    classification: 'on_time',
  });

  const advanced = await repo.advanceConfirmations(100);
  const fetched = await repo.get('watch-1');

  assert.equal(advanced, 1);
  assert.ok(fetched);
  assert.equal(fetched.observations[0].matchStatus, 'confirmed');
});

test('Memory.detachObservationsForBlock marks observations reorged and recordObservation can replay', async () => {
  const repo = new MemoryWatchedAddressRepository();
  await repo.register(input({ requiredConfirmations: 1 }));
  await repo.recordObservation({
    outpoint: 'funding:0',
    watchId: 'watch-1',
    blockHash: 'stale',
    height: 100,
    amountGrains: '12500000000',
    classification: 'on_time',
  });

  await repo.detachObservationsForBlock('stale');
  const detached = await repo.get('watch-1');
  assert.ok(detached);
  assert.equal(detached.observations[0].matchStatus, 'detached');
  assert.equal(detached.observations[0].classification, 'reorged');

  await repo.recordObservation({
    outpoint: 'funding:0',
    watchId: 'watch-1',
    blockHash: 'canonical',
    height: 101,
    amountGrains: '12500000000',
    classification: 'on_time',
  });
  const replayed = await repo.get('watch-1');

  assert.ok(replayed);
  assert.equal(replayed.observations[0].blockHash, 'canonical');
  assert.equal(replayed.observations[0].matchStatus, 'pending');
  assert.equal(replayed.observations[0].classification, 'on_time');
});
