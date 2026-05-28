import assert from 'node:assert/strict';
import test from 'node:test';

import { createBridgePublicProof } from '../dist/proof.js';
import { createBridgeReconciliationSnapshot } from '../dist/reconciliation.js';
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
      canonical_event_id: '0xevent',
      canonical_event_hash: '0xhash',
      relayer_attestation_count: 2,
      relayer_quorum_required: 3,
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
        classificationData: { amount_grains: '100', pearl_recipient: 'tprl1precipient' },
      }),
    ],
  });
  const matchedRelease = exitRequest({
    exitId: 'exit-released',
    requestedAmountGrains: '100',
    status: 'released',
    pearlReleaseTxid: 'release-1',
  });
  const pendingExit = exitRequest({ requestedAmountGrains: '200' });

  const snapshot = createBridgeReconciliationSnapshot({
    depositWatches: [deposit],
    reserveWatches: [reserve],
    exits: [matchedRelease, pendingExit],
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
  assert.equal(snapshot.reserveSpends[0].matchStatus, 'matched_exit_release');
  assert.equal(snapshot.reserveSpends[0].exitId, 'exit-released');

  const proof = createBridgePublicProof({
    reconciliation: snapshot,
    depositWatches: [deposit],
    exits: [matchedRelease, pendingExit],
  });
  assert.equal(proof.deposits[0].pearlOutpoint, 'pearl-deposit:0');
  assert.equal(proof.deposits[0].eventId, '0xevent');
  assert.equal(proof.deposits[0].eventHash, '0xhash');
  assert.equal(proof.deposits[0].relayerAttestationCount, 2);
  assert.equal(proof.deposits[0].relayerQuorumRequired, 3);
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

test('treats malformed reserve exit_release spends as unknown blockers', () => {
  const snapshot = createBridgeReconciliationSnapshot({
    depositWatches: [],
    reserveWatches: [
      watch({
        watchId: 'reserve-malformed-spend',
        purpose: 'bridge_reserve',
        observations: [
          observation({
            outpoint: 'reserve:0',
            amountGrains: '300',
            matchStatus: 'confirmed',
          }),
        ],
        spends: [
          spend({
            classification: 'exit_release',
            classificationData: { amount_grains: '100' },
          }),
        ],
      }),
    ],
    exits: [],
    mintedSupplyGrains: '0',
    now: NOW,
  });

  assert.equal(snapshot.knownReserveSpendGrains, '0');
  assert.equal(snapshot.unknownReserveSpendCount, 1);
  assert.deepEqual(snapshot.blockers, ['unknown_reserve_spend']);
});

test('blocks release-shaped reserve spends that do not match exactly one mirrored exit', () => {
  const baseReserve = {
    watchId: 'reserve-unmatched-spend',
    purpose: 'bridge_reserve' as const,
    observations: [
      observation({
        outpoint: 'reserve:0',
        amountGrains: '1000',
        matchStatus: 'confirmed',
      }),
    ],
  };

  const unmatched = createBridgeReconciliationSnapshot({
    depositWatches: [],
    reserveWatches: [
      watch({
        ...baseReserve,
        spends: [
          spend({
            spendTxid: 'unmatched-release-shape',
            classification: 'exit_release',
            classificationData: { amount_grains: '25', pearl_recipient: 'tprl1unknownrecipient' },
          }),
        ],
      }),
    ],
    exits: [exitRequest({ requestedAmountGrains: '100', pearlRecipient: 'tprl1precipient' })],
    mintedSupplyGrains: '500',
    now: NOW,
  });

  assert.equal(unmatched.knownReserveSpendGrains, '0');
  assert.equal(unmatched.unknownReserveSpendCount, 1);
  assert.equal(unmatched.reserveSpends[0].matchStatus, 'unknown_spend');
  assert.deepEqual(unmatched.reserveSpends[0].blockers, ['unknown_reserve_spend']);
  assert.deepEqual(unmatched.blockers, ['unknown_reserve_spend']);

  const ambiguous = createBridgeReconciliationSnapshot({
    depositWatches: [],
    reserveWatches: [
      watch({
        ...baseReserve,
        spends: [
          spend({
            spendTxid: 'ambiguous-release-shape',
            classification: 'exit_release',
            classificationData: { amount_grains: '100', pearl_recipient: 'tprl1precipient' },
          }),
        ],
      }),
    ],
    exits: [
      exitRequest({ exitId: 'exit-1' }),
      exitRequest({ exitId: 'exit-2' }),
    ],
    mintedSupplyGrains: '500',
    now: NOW,
  });

  assert.equal(ambiguous.knownReserveSpendGrains, '0');
  assert.equal(ambiguous.unknownReserveSpendCount, 1);
  assert.equal(ambiguous.reserveSpends[0].matchStatus, 'unknown_spend');
  assert.deepEqual(ambiguous.reserveSpends[0].blockers, ['ambiguous_exit_release_match']);
  assert.deepEqual(ambiguous.blockers, ['unknown_reserve_spend']);
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

test('does not count non-reserve watches as Pearl reserve backing', () => {
  const snapshot = createBridgeReconciliationSnapshot({
    depositWatches: [],
    reserveWatches: [
      watch({
        watchId: 'deposit-watch-in-reserve-slot',
        purpose: 'bridge_deposit',
        observations: [
          observation({ outpoint: 'not-reserve:0', amountGrains: '1000', confirmations: 8 }),
        ],
        spends: [
          spend({
            spendTxid: 'not-reserve-release-shape',
            classification: 'exit_release',
            classificationData: { amount_grains: '100', pearl_recipient: 'tprl1precipient' },
          }),
        ],
      }),
    ],
    exits: [exitRequest()],
    mintedSupplyGrains: '500',
    now: NOW,
  });

  assert.equal(snapshot.confirmedReserveGrains, '0');
  assert.equal(snapshot.knownReserveSpendGrains, '0');
  assert.equal(snapshot.unknownReserveSpendCount, 1);
  assert.equal(snapshot.reserveSpends[0].matchStatus, 'unknown_spend');
  assert.deepEqual(snapshot.reserveSpends[0].blockers, ['unexpected_reserve_watch_purpose']);
  assert.deepEqual(snapshot.blockers, [
    'reserve_deficit',
    'unknown_reserve_spend',
    'unexpected_reserve_watch_purpose',
  ]);
});

test('keeps operator-processed exits in liabilities until Pearl reserve spend matches', () => {
  const snapshot = createBridgeReconciliationSnapshot({
    depositWatches: [],
    reserveWatches: [
      watch({
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
      }),
    ],
    exits: [
      exitRequest({
        requestedAmountGrains: '200',
        status: 'processed',
        pearlReleaseTxid: 'operator-reported-release',
      }),
    ],
    mintedSupplyGrains: '500',
    now: NOW,
  });

  assert.equal(snapshot.pendingExitGrains, '200');
  assert.equal(snapshot.reserveAvailableGrains, '800');
  assert.equal(snapshot.reserveSurplusGrains, '300');
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
    classificationData: { amount_grains: '100', pearl_recipient: 'tprl1precipient' },
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
