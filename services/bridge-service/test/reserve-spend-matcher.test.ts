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
  assert.deepEqual(matchReserveSpendToExit({
    spend: spend({ classificationData: { amount_grains: '100' } }),
    exits: [exit()],
  }).blockers, ['reserve_spend_missing_match_fields']);

  assert.equal(matchReserveSpendToExit({
    spend: spend({ spendTxid: 'release_tx' }),
    exits: [exit()],
    usedReleaseTxids: new Set(['release_tx']),
  }).status, 'duplicate_release_txid');
});

test('allows idempotent replay of an already matched release spend', () => {
  const result = matchReserveSpendToExit({
    spend: spend({ spendTxid: 'release_tx' }),
    exits: [exit({ status: 'released', pearlReleaseTxid: 'release_tx' })],
    usedReleaseTxids: new Set(['release_tx']),
  });

  assert.equal(result.status, 'matched_exit_release');
  assert.equal(result.exitId, 'exit-1');
});

test('rejects Pearl reserve spend that conflicts with operator processed txid', () => {
  const result = matchReserveSpendToExit({
    spend: spend({ spendTxid: 'different_release_tx' }),
    exits: [exit({ status: 'processed', pearlReleaseTxid: 'operator_reported_release_tx' })],
  });

  assert.equal(result.status, 'duplicate_release_txid');
  assert.deepEqual(result.blockers, ['processed_release_txid_mismatch']);
});

test('blocks ambiguous reserve spend matches instead of choosing the first exit', () => {
  const result = matchReserveSpendToExit({
    spend: spend(),
    exits: [
      exit({ exitId: 'exit-1' }),
      exit({ exitId: 'exit-2' }),
    ],
  });

  assert.equal(result.status, 'unknown_spend');
  assert.deepEqual(result.blockers, ['ambiguous_exit_release_match']);
});

test('matches Pearl spend txids against bytes32 Igra release txids', () => {
  const releaseTxid = '22bc370a13dcd0f3c4dfdf5c3ddd29323146a78b478157115debc846f855e7b1';
  const result = matchReserveSpendToExit({
    spend: spend({ spendTxid: releaseTxid }),
    exits: [exit({ status: 'processed', pearlReleaseTxid: `0x${releaseTxid}` })],
    usedReleaseTxids: new Set([`0x${releaseTxid}`]),
  });

  assert.equal(result.status, 'matched_exit_release');
  assert.equal(result.exitId, 'exit-1');
});

test('does not match non-release reserve spend classifications to exits', () => {
  const result = matchReserveSpendToExit({
    spend: spend({ classification: 'consolidation' }),
    exits: [exit()],
  });

  assert.equal(result.status, 'unknown_spend');
  assert.deepEqual(result.blockers, ['reserve_spend_not_exit_release']);
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
