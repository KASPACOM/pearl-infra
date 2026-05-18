import assert from 'node:assert/strict';
import test from 'node:test';

import { createBridgePublicProof } from '../src/proof.ts';
import { createBridgeReconciliationSnapshot } from '../src/reconciliation.ts';
import type { BridgeExitRequest, WatchedBridgeAddressWithHistory } from '../src/types.ts';

const NOW = new Date('2026-05-18T18:00:00.000Z');
const RECENT = '2026-05-18T17:59:00.000Z';
const OLD = '2026-05-18T17:00:00.000Z';

test('reconciles confirmed deposits, reserves, pending exits, and public proof', () => {
  const deposit = watch({
    watchId: 'deposit-1',
    purpose: 'bridge_deposit',
    metadata: {
      igra_recipient: '0x1111111111111111111111111111111111111111',
      expected_amount_min_grains: '100',
      expected_amount_max_grains: '200',
      igra_mint_tx_hash: '0xmint',
    },
    observations: [
      observation({
        outpoint: 'pearl-deposit:0',
        amountGrains: '150',
        matchStatus: 'confirmed',
        confirmations: 8,
      }),
    ],
  });
  const reserve = watch({
    watchId: 'reserve-hot-1',
    purpose: 'bridge_reserve',
    observations: [
      observation({
        outpoint: 'reserve-funding:0',
        amountGrains: '1000',
        matchStatus: 'confirmed',
        confirmations: 12,
      }),
    ],
    spends: [
      spend({
        spendTxid: 'release-1',
        spentOutpoint: 'reserve-funding:0',
        classification: 'exit_release',
        classificationData: { amount_grains: '100' },
      }),
    ],
  });
  const exit = exitRequest({ requestedAmountGrains: '200' });

  const snapshot = createBridgeReconciliationSnapshot({
    depositWatches: [deposit],
    reserveWatches: [reserve],
    exits: [exit],
    mintedSupplyGrains: '500',
    now: NOW,
  });

  assert.equal(snapshot.confirmedDepositGrains, '150');
  assert.equal(snapshot.confirmedReserveGrains, '1000');
  assert.equal(snapshot.knownReserveSpendGrains, '100');
  assert.equal(snapshot.pendingExitGrains, '200');
  assert.equal(snapshot.reserveAvailableGrains, '700');
  assert.equal(snapshot.reserveSurplusGrains, '200');
  assert.equal(snapshot.reserveDeficitGrains, '0');
  assert.deepEqual(snapshot.blockers, []);

  const proof = createBridgePublicProof({
    reconciliation: snapshot,
    depositWatches: [deposit],
    exits: [exit],
  });
  assert.equal(proof.deposits[0].pearlOutpoint, 'pearl-deposit:0');
  assert.equal(proof.deposits[0].mintTxHash, '0xmint');
  assert.equal(proof.reserveBacking.reserveAvailableGrains, '700');
});

test('blocks bridge operations on reserve deficit, stale watches, unsafe deposits, and unknown reserve spends', () => {
  const deposit = watch({
    watchId: 'deposit-unsafe',
    purpose: 'bridge_deposit',
    updatedAt: OLD,
    metadata: {
      expected_amount_min_grains: '100',
      expected_amount_max_grains: '200',
    },
    observations: [
      observation({
        outpoint: 'late:0',
        amountGrains: '50',
        matchStatus: 'confirmed',
        classification: 'underpaid',
      }),
    ],
  });
  const reserve = watch({
    watchId: 'reserve-stale',
    purpose: 'bridge_reserve',
    updatedAt: OLD,
    observations: [
      observation({
        outpoint: 'reserve:0',
        amountGrains: '300',
        matchStatus: 'confirmed',
      }),
    ],
    spends: [
      spend({
        classification: 'unknown',
        classificationData: {},
      }),
    ],
  });

  const snapshot = createBridgeReconciliationSnapshot({
    depositWatches: [deposit],
    reserveWatches: [reserve],
    exits: [exitRequest({ requestedAmountGrains: '100' })],
    mintedSupplyGrains: '500',
    staleAfterMs: 15 * 60 * 1000,
    now: NOW,
  });

  assert.equal(snapshot.reserveDeficitGrains, '300');
  assert.equal(snapshot.unknownReserveSpendCount, 1);
  assert.deepEqual(snapshot.staleWatchIds, ['deposit-unsafe', 'reserve-stale']);
  assert.deepEqual(snapshot.blockers, [
    'reserve_deficit',
    'unknown_reserve_spend',
    'stale_pearl_watches',
    'unsafe_deposit_observation',
  ]);
  assert.equal(snapshot.deposits[0].status, 'unsafe');
  assert.deepEqual(snapshot.deposits[0].blockers, ['deposit_below_min', 'deposit_underpaid']);
});

test('treats multiple live outputs to one bridge deposit address as unsafe', () => {
  const snapshot = createBridgeReconciliationSnapshot({
    depositWatches: [
      watch({
        watchId: 'deposit-multi',
        purpose: 'bridge_deposit',
        metadata: {
          expected_amount_min_grains: '100',
          expected_amount_max_grains: '200',
        },
        observations: [
          observation({ outpoint: 'deposit:0', amountGrains: '150', confirmations: 8 }),
          observation({ outpoint: 'deposit:1', amountGrains: '150', confirmations: 7 }),
        ],
      }),
    ],
    reserveWatches: [],
    exits: [],
    mintedSupplyGrains: '0',
    now: NOW,
  });

  assert.equal(snapshot.deposits[0].status, 'unsafe');
  assert.deepEqual(snapshot.deposits[0].blockers, ['multiple_deposit_observations']);
  assert.deepEqual(snapshot.blockers, ['unsafe_deposit_observation']);
});

function watch(overrides: Partial<WatchedBridgeAddressWithHistory> = {}): WatchedBridgeAddressWithHistory {
  return {
    watchId: 'watch-1',
    purpose: 'bridge_deposit',
    network: 'testnet2',
    address: 'tprl1pwatch',
    requiredConfirmations: 6,
    status: 'active',
    metadata: {},
    createdAt: RECENT,
    updatedAt: RECENT,
    observations: [],
    spends: [],
    ...overrides,
  };
}

function observation(overrides: Partial<WatchedBridgeAddressWithHistory['observations'][number]> = {}) {
  return {
    outpoint: 'tx:0',
    watchId: 'watch-1',
    blockHash: 'block',
    height: 100,
    amountGrains: '100',
    confirmations: 6,
    matchStatus: 'confirmed' as const,
    classification: 'on_time',
    observedAt: RECENT,
    ...overrides,
  };
}

function spend(overrides: Partial<WatchedBridgeAddressWithHistory['spends'][number]> = {}) {
  return {
    spendTxid: 'spend',
    spentOutpoint: 'tx:0',
    blockHash: 'block-spend',
    height: 120,
    classification: 'exit_release',
    classificationData: { amount_grains: '100' },
    observedAt: RECENT,
    ...overrides,
  };
}

function exitRequest(overrides: Partial<BridgeExitRequest> = {}): BridgeExitRequest {
  return {
    exitId: 'exit-1',
    igraBurnTxid: '0xburn',
    igraBurnLogIndex: 0,
    igraBurnBlock: 123,
    igraChainId: 19416,
    requestedAmountGrains: '100',
    pearlRecipient: 'tprl1precipient',
    status: 'pending',
    createdAt: RECENT,
    updatedAt: RECENT,
    ...overrides,
  };
}
