import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyReserveSpendMatchesToExits,
  applyReserveWatchSpendMatchesToExits,
  reserveSpendsFromWatches,
} from '../dist/reserve-spend-applier.js';
import { InMemoryBridgeStateRepository } from '../src/repository.ts';
import type { BridgeAddressSpend, BridgeExitRequest, WatchedBridgeAddressWithHistory } from '../src/types.ts';

test('marks matching Pearl reserve spends as released exits', async () => {
  const repo = new InMemoryBridgeStateRepository();
  await repo.upsertExitRequest(exit());

  const [result] = await applyReserveSpendMatchesToExits({
    repository: repo,
    spends: [spend()],
    now: new Date('2026-05-19T00:10:00.000Z'),
  });

  const updated = await repo.findExitRequest('exit-1');
  assert.equal(result.status, 'matched_exit_release');
  assert.equal(result.exitId, 'exit-1');
  assert.equal(updated?.status, 'released');
  assert.equal(updated?.pearlReleaseTxid, 'release_tx');
  assert.equal(updated?.pearlReleaseBlock, 150);
  assert.equal(updated?.metadata?.pearl_release_spent_outpoint, 'reserve:0');
});

test('replays already applied Pearl reserve spends idempotently', async () => {
  const repo = new InMemoryBridgeStateRepository();
  await repo.upsertExitRequest(exit({
    status: 'released',
    pearlReleaseTxid: 'release_tx',
    pearlReleaseBlock: 150,
    releasedAt: '2026-05-19T00:10:00.000Z',
  }));

  const [result] = await applyReserveSpendMatchesToExits({
    repository: repo,
    spends: [spend()],
    now: new Date('2026-05-19T00:20:00.000Z'),
  });

  const updated = await repo.findExitRequest('exit-1');
  assert.equal(result.status, 'matched_exit_release');
  assert.equal(updated?.releasedAt, '2026-05-19T00:10:00.000Z');
});

test('keeps mismatch and unknown Pearl reserve spends as manual-review blockers', async () => {
  const repo = new InMemoryBridgeStateRepository();
  await repo.upsertExitRequest(exit());

  const results = await applyReserveSpendMatchesToExits({
    repository: repo,
    spends: [
      spend({ spendTxid: 'recipient_mismatch', classificationData: { amount_grains: '100', pearl_recipient: 'other' } }),
      spend({ spendTxid: 'unknown', classificationData: {} }),
    ],
  });

  assert.equal(results[0].status, 'recipient_mismatch');
  assert.deepEqual(results[0].blockers, ['reserve_spend_recipient_mismatch']);
  assert.equal(results[1].status, 'unknown_spend');
  assert.deepEqual(results[1].blockers, ['reserve_spend_missing_match_fields']);
  assert.equal((await repo.findExitRequest('exit-1'))?.status, 'pending');
});

test('applies live bridge reserve watch spends and ignores non-reserve watches', async () => {
  const repo = new InMemoryBridgeStateRepository();
  await repo.upsertExitRequest(exit());

  const results = await applyReserveWatchSpendMatchesToExits({
    repository: repo,
    reserveWatches: [
      watch({ purpose: 'bridge_deposit', spends: [spend({ spendTxid: 'deposit_spend' })] }),
      watch({ purpose: 'bridge_reserve', spends: [spend()] }),
    ],
    now: new Date('2026-05-19T00:10:00.000Z'),
  });

  assert.deepEqual(reserveSpendsFromWatches([
    watch({ purpose: 'bridge_deposit', spends: [spend({ spendTxid: 'deposit_spend' })] }),
    watch({ purpose: 'bridge_reserve', spends: [spend()] }),
  ]).map((candidate) => candidate.spendTxid), ['release_tx']);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'matched_exit_release');
  assert.equal((await repo.findExitRequest('exit-1'))?.status, 'released');
});

function spend(overrides: Partial<BridgeAddressSpend> = {}): BridgeAddressSpend {
  return {
    spendTxid: 'release_tx',
    spentOutpoint: 'reserve:0',
    blockHash: 'block',
    height: 150,
    classification: 'exit_release',
    classificationData: { amount_grains: '100', pearl_recipient: 'tprl1recipient' },
    observedAt: '2026-05-19T00:00:00.000Z',
    ...overrides,
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

function watch(overrides: Partial<WatchedBridgeAddressWithHistory> = {}): WatchedBridgeAddressWithHistory {
  return {
    watchId: 'watch-1',
    purpose: 'bridge_reserve',
    network: 'simnet',
    address: 'tprl1reserve',
    requiredConfirmations: 1,
    status: 'active',
    metadata: {},
    createdAt: '2026-05-19T00:00:00.000Z',
    updatedAt: '2026-05-19T00:00:00.000Z',
    observations: [],
    spends: [],
    ...overrides,
  };
}
