import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { InMemoryBridgeStateRepository, JsonFileBridgeStateRepository } from '../src/repository.ts';
import type { BridgeAdminDecision, BridgeExitRequest, BridgeReconciliationSnapshotRecord, IgraBridgeEvent } from '../src/types.ts';

test('stores bridge snapshots, events, exits, and admin decisions idempotently in memory', async () => {
  const repo = new InMemoryBridgeStateRepository();
  const snapshot = snapshotRecord('snap-1');
  assert.equal((await repo.saveReconciliationSnapshot(snapshot)).created, true);
  assert.equal((await repo.saveReconciliationSnapshot(snapshot)).created, false);
  assert.equal((await repo.latestReconciliationSnapshot())?.snapshotId, 'snap-1');

  const event = bridgeEvent('event-1');
  assert.equal((await repo.saveIgraEvent(event)).created, true);
  assert.equal((await repo.saveIgraEvent(event)).created, false);
  assert.equal((await repo.listIgraEvents()).length, 1);

  assert.equal((await repo.upsertExitRequest(exitRequest({ status: 'pending' }))).created, true);
  assert.equal((await repo.upsertExitRequest(exitRequest({ status: 'released', pearlReleaseTxid: 'release_tx' }))).created, false);
  assert.equal((await repo.upsertExitRequest(exitRequest({ status: 'refunded', pearlReleaseTxid: 'conflict_tx' }))).created, false);
  assert.equal((await repo.findExitRequest('exit-1'))?.status, 'released');
  assert.equal((await repo.findExitRequest('exit-1'))?.pearlReleaseTxid, 'release_tx');

  const decision = adminDecision('idem-1');
  assert.equal((await repo.saveAdminDecision(decision)).created, true);
  assert.equal((await repo.saveAdminDecision(decision)).created, false);
  assert.equal((await repo.listAdminDecisions('exit-1')).length, 1);
});

test('persists bridge state through JSON file repository', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-repo-'));
  try {
    const file = join(dir, 'bridge-state.json');
    const first = new JsonFileBridgeStateRepository(file);
    await first.saveReconciliationSnapshot(snapshotRecord('snap-1'));
    await first.saveIgraEvent(bridgeEvent('event-1'));
    await first.upsertExitRequest(exitRequest());
    await first.saveAdminDecision(adminDecision('idem-1'));

    const second = new JsonFileBridgeStateRepository(file);
    assert.equal((await second.latestReconciliationSnapshot())?.snapshotId, 'snap-1');
    assert.equal((await second.listIgraEvents())[0].eventId, 'event-1');
    assert.equal((await second.findExitRequest('exit-1'))?.requestedAmountGrains, '100');
    assert.equal((await second.listAdminDecisions())[0].idempotencyKey, 'idem-1');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rejects duplicate Igra exit events and Pearl release txids in local repositories', async () => {
  const memory = new InMemoryBridgeStateRepository();
  await memory.upsertExitRequest(exitRequest({
    exitId: 'exit-1',
    pearlReleaseTxid: '22bc370a13dcd0f3c4dfdf5c3ddd29323146a78b478157115debc846f855e7b1',
  }));

  await assert.rejects(
    () => memory.upsertExitRequest(exitRequest({ exitId: 'exit-2' })),
    /Igra exit event already belongs to exit exit-1/,
  );
  await assert.rejects(
    () => memory.upsertExitRequest(exitRequest({
      exitId: 'exit-3',
      igraBurnLogIndex: 1,
      pearlReleaseTxid: '0x22bc370a13dcd0f3c4dfdf5c3ddd29323146a78b478157115debc846f855e7b1',
    })),
    /Pearl release txid already belongs to exit exit-1/,
  );

  const dir = await mkdtemp(join(tmpdir(), 'bridge-repo-conflicts-'));
  try {
    const json = new JsonFileBridgeStateRepository(join(dir, 'bridge-state.json'));
    await json.upsertExitRequest(exitRequest({
      exitId: 'exit-1',
      pearlReleaseTxid: 'release_tx',
    }));

    await assert.rejects(
      () => json.upsertExitRequest(exitRequest({ exitId: 'exit-2' })),
      /Igra exit event already belongs to exit exit-1/,
    );
    await assert.rejects(
      () => json.upsertExitRequest(exitRequest({
        exitId: 'exit-3',
        igraBurnLogIndex: 1,
        pearlReleaseTxid: 'release_tx',
      })),
      /Pearl release txid already belongs to exit exit-1/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

function snapshotRecord(snapshotId: string): BridgeReconciliationSnapshotRecord {
  return {
    snapshotId,
    snapshot: { observedAt: '2026-05-19T00:00:00.000Z', deposits: [] },
    observedAt: '2026-05-19T00:00:00.000Z',
    createdAt: '2026-05-19T00:00:01.000Z',
  };
}

function bridgeEvent(eventId: string): IgraBridgeEvent {
  return {
    eventId,
    eventType: 'exit_requested',
    txHash: '0xburn',
    logIndex: 0,
    blockNumber: 100,
    chainId: 19416,
    payload: {},
    observedAt: '2026-05-19T00:00:00.000Z',
  };
}

function exitRequest(overrides: Partial<BridgeExitRequest> = {}): BridgeExitRequest {
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

function adminDecision(idempotencyKey: string): BridgeAdminDecision {
  return {
    decisionId: 'decision-1',
    kind: 'exit_release',
    targetId: 'exit-1',
    actor: 'operator',
    reason: 'approved',
    idempotencyKey,
    metadata: {},
    createdAt: '2026-05-19T00:00:00.000Z',
  };
}
