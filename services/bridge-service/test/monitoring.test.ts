import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateBridgeAttestationQuorum, createDepositBridgeEvent } from '../src/attestations.ts';
import { evaluateBridgePilotAlerts } from '../src/monitoring.ts';
import type { BridgeReconciliationSnapshot } from '../src/reconciliation.ts';

test('emits pilot alerts for reserve blockers, cap pressure, and quorum failures', () => {
  const event = createDepositBridgeEvent({
    pearlTxid: 'deposit_tx',
    vout: 0,
    amountGrains: '100',
    igraRecipient: '0x1111111111111111111111111111111111111111',
    pearlNetwork: 'testnet2',
    depositWatchId: 'deposit-1',
    requiredConfirmations: 20,
    observedConfirmations: 20,
  });
  const failedQuorum = evaluateBridgeAttestationQuorum({
    event,
    policy: { relayerIds: ['relayer-a'], requiredAttestations: 1 },
    attestations: [
      {
        relayerId: 'relayer-a',
        eventId: event.eventId,
        eventHash: '0xdead',
        observedAt: '2026-05-19T00:00:00.000Z',
      },
    ],
  });

  const alerts = evaluateBridgePilotAlerts({
    reconciliation: snapshot({
      blockers: ['reserve_deficit', 'unknown_reserve_spend', 'stale_pearl_watches'],
      mintedSupplyGrains: '850',
      staleWatchIds: ['reserve-hot'],
    }),
    attestationQuorums: [failedQuorum],
    pilotSupplyCapGrains: '1000',
  });

  assert.equal(alerts.some((alert) => alert.code === 'reserve_deficit' && alert.severity === 'critical'), true);
  assert.equal(alerts.some((alert) => alert.code === 'cap_near_limit'), true);
  assert.equal(alerts.some((alert) => alert.code === 'quorum_failure'), true);
});

function snapshot(overrides: Partial<BridgeReconciliationSnapshot> = {}): BridgeReconciliationSnapshot {
  return {
    observedAt: '2026-05-19T00:00:00.000Z',
    mintedSupplyGrains: '0',
    confirmedDepositGrains: '0',
    pendingDepositGrains: '0',
    confirmedReserveGrains: '0',
    knownReserveSpendGrains: '0',
    pendingExitGrains: '0',
    reserveAvailableGrains: '0',
    reserveSurplusGrains: '0',
    reserveDeficitGrains: '0',
    deposits: [],
    reserveSpends: [],
    pendingExits: [],
    unknownReserveSpendCount: 0,
    staleWatchIds: [],
    blockers: [],
    ...overrides,
  };
}
