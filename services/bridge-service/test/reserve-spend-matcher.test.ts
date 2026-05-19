import assert from 'node:assert/strict';
import test from 'node:test';

import { matchReserveSpendToExit } from '../src/reserve-spend-matcher.ts';
import type { BridgeAddressSpend, BridgeExitRequest } from '../src/types.ts';

test('matches reserve spend to pending exit by amount and Pearl recipient', () => {
  const result = matchReserveSpendToExit({
    spend: spend({ classificationData: { amount_grains: '100', pearl_recipient: 'tprl1recipient' } }),
    exits: [exit()],
  });

  assert.equal(result.status, 'matched_exit_release');
  assert.equal(result.exitId, 'exit-1');
  assert.deepEqual(result.blockers, []);
});

test('routes unknown, amount mismatch, recipient mismatch, and duplicate release txid to manual blockers', () => {
  assert.equal(matchReserveSpendToExit({
    spend: spend({ classificationData: { amount_grains: '100', pearl_recipient: 'other' } }),
    exits: [exit()],
  }).status, 'recipient_mismatch');

  assert.equal(matchReserveSpendToExit({
    spend: spend({ classificationData: { amount_grains: '101', pearl_recipient: 'tprl1recipient' } }),
    exits: [exit()],
  }).status, 'amount_mismatch');

  assert.equal(matchReserveSpendToExit({
    spend: spend({ classificationData: {} }),
    exits: [exit()],
  }).status, 'unknown_spend');

  assert.equal(matchReserveSpendToExit({
    spend: spend({ spendTxid: 'release_tx' }),
    exits: [exit()],
    usedReleaseTxids: new Set(['release_tx']),
  }).status, 'duplicate_release_txid');
});

function spend(overrides: Partial<BridgeAddressSpend> = {}): BridgeAddressSpend {
  return {
    spendTxid: 'release_tx',
    spentOutpoint: 'reserve:0',
    blockHash: 'block',
    height: 100,
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
