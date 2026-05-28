import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { handleBridgeHttpRequest } from '../src/http.ts';
import { InMemoryBridgeStateRepository } from '../src/repository.ts';
import type { BridgeReconciliationSnapshotRecord, BridgeExitRequest } from '../src/types.ts';

test('serves public bridge proof, deposit status, and exit status from repository state', async () => {
  const repo = new InMemoryBridgeStateRepository();
  await repo.saveReconciliationSnapshot(snapshotRecord());
  await repo.upsertExitRequest(exitRequest());

  const proof = await handleBridgeHttpRequest(repo, request('GET', '/bridge/proof'));
  const deposit = await handleBridgeHttpRequest(repo, request('GET', '/bridge/deposits/deposit-1'));
  const exit = await handleBridgeHttpRequest(repo, request('GET', '/bridge/exits/exit-1'));

  assert.equal(proof.statusCode, 200);
  assert.equal(deposit.statusCode, 200);
  assert.equal((deposit.body as { depositId: string }).depositId, 'deposit-1');
  assert.equal(exit.statusCode, 200);
  assert.equal((exit.body as BridgeExitRequest).exitId, 'exit-1');
});

test('requires admin token and stores bridge admin decisions idempotently', async () => {
  const repo = new InMemoryBridgeStateRepository();
  const unauthorized = await handleBridgeHttpRequest(repo, request('POST', '/bridge/admin/decisions', {
    kind: 'exit_release',
    targetId: 'exit-1',
    actor: 'operator',
    reason: 'approved',
  }), { adminToken: 'secret' });
  const created = await handleBridgeHttpRequest(repo, request('POST', '/bridge/admin/decisions', {
    kind: 'exit_release',
    targetId: 'exit-1',
    actor: 'operator',
    reason: 'approved',
    idempotencyKey: 'approve-exit-1',
  }, 'secret'), { adminToken: 'secret' });
  const list = await handleBridgeHttpRequest(repo, request('GET', '/bridge/admin/decisions', undefined, 'secret'), { adminToken: 'secret' });

  assert.equal(unauthorized.statusCode, 401);
  assert.equal(created.statusCode, 201);
  assert.equal((created.body as { created: boolean }).created, true);
  assert.equal((list.body as unknown[]).length, 1);
});

function request(method: string, url: string, body?: unknown, token?: string): Readable & { method: string; url: string; headers: Record<string, string> } {
  const stream = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  return Object.assign(stream, {
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

function snapshotRecord(): BridgeReconciliationSnapshotRecord {
  return {
    snapshotId: 'snapshot-1',
    observedAt: '2026-05-19T00:00:00.000Z',
    createdAt: '2026-05-19T00:00:01.000Z',
    snapshot: {
      observedAt: '2026-05-19T00:00:00.000Z',
      deposits: [
        {
          depositId: 'deposit-1',
          status: 'confirmed',
          pearlAddress: 'tprl1deposit',
        },
      ],
    },
  };
}

function exitRequest(): BridgeExitRequest {
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
  };
}
