import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decideDepositMint,
  decideExitRelease,
} from '../src/relayer-policy.ts';
import { createBridgeReconciliationSnapshot } from '../src/reconciliation.ts';
import type { BridgeAddressObservation, BridgeExitRequest, WatchedBridgeAddressWithHistory } from '../src/types.ts';
import type { BridgePilotLimits } from '../src/types.ts';

const limits: BridgePilotLimits = {
  minDepositGrains: '100',
  maxDepositGrains: '1000',
  maxExitGrains: '800',
  pilotSupplyCapGrains: '5000',
  rollingWindowCapGrains: '2000',
  rollingWindowUsedGrains: '200',
};

test('prepares mint only after confirmed deposit and manual approval', () => {
  const watch = depositWatch();
  const obs = observation({ amountGrains: '500', matchStatus: 'confirmed' });

  const waiting = decideDepositMint({
    watch,
    observation: obs,
    limits,
    mintedSupplyGrains: '1000',
  });
  const approved = decideDepositMint({
    watch,
    observation: obs,
    limits,
    mintedSupplyGrains: '1000',
    manualApprovalId: 'approval-1',
  });

  assert.equal(waiting.action, 'wait');
  assert.match(waiting.reason, /manual federation approval/);
  assert.equal(approved.action, 'prepare_mint');
  assert.equal(approved.metadata?.amountGrains, '500');
  assert.match(approved.idempotencyKey, /^bridge:prepare_mint:/);
});

test('routes unsafe deposits to manual review before mint', () => {
  const decision = decideDepositMint({
    watch: depositWatch(),
    observation: observation({ amountGrains: '5000', matchStatus: 'confirmed' }),
    limits,
    mintedSupplyGrains: '1000',
    manualApprovalId: 'approval-1',
  });

  assert.equal(decision.action, 'manual_review');
  assert.match(decision.reason, /above pilot maximum/);
});

test('prepares exit release only when reconciliation is clean and approval exists', () => {
  const reconciliation = createBridgeReconciliationSnapshot({
    depositWatches: [],
    reserveWatches: [reserveWatch('1000')],
    exits: [exitRequest({ requestedAmountGrains: '200' })],
    mintedSupplyGrains: '500',
    now: new Date('2026-05-18T18:00:00.000Z'),
  });

  const waiting = decideExitRelease({
    exit: exitRequest({ requestedAmountGrains: '200' }),
    reconciliation,
    limits,
  });
  const approved = decideExitRelease({
    exit: exitRequest({ requestedAmountGrains: '200' }),
    reconciliation,
    limits,
    manualApprovalId: 'approval-exit-1',
  });

  assert.equal(waiting.action, 'wait');
  assert.match(waiting.reason, /manual federation approval/);
  assert.equal(approved.action, 'prepare_exit_release');
  assert.equal(approved.metadata?.amountGrains, '200');
});

test('blocks exit release on reconciliation blockers or exit caps', () => {
  const blockedReconciliation = createBridgeReconciliationSnapshot({
    depositWatches: [],
    reserveWatches: [reserveWatch('100')],
    exits: [exitRequest({ requestedAmountGrains: '200' })],
    mintedSupplyGrains: '500',
    now: new Date('2026-05-18T18:00:00.000Z'),
  });
  const reconciliationDecision = decideExitRelease({
    exit: exitRequest({ requestedAmountGrains: '200' }),
    reconciliation: blockedReconciliation,
    limits,
    manualApprovalId: 'approval-exit-1',
  });

  const cleanReconciliation = createBridgeReconciliationSnapshot({
    depositWatches: [],
    reserveWatches: [reserveWatch('5000')],
    exits: [exitRequest({ requestedAmountGrains: '900' })],
    mintedSupplyGrains: '500',
    now: new Date('2026-05-18T18:00:00.000Z'),
  });
  const capDecision = decideExitRelease({
    exit: exitRequest({ requestedAmountGrains: '900' }),
    reconciliation: cleanReconciliation,
    limits,
    manualApprovalId: 'approval-exit-1',
  });

  assert.equal(reconciliationDecision.action, 'manual_review');
  assert.match(reconciliationDecision.reason, /reserve_deficit/);
  assert.equal(capDecision.action, 'manual_review');
  assert.match(capDecision.reason, /max exit cap/);
});

function depositWatch(): WatchedBridgeAddressWithHistory {
  return {
    watchId: 'deposit-1',
    purpose: 'bridge_deposit',
    network: 'testnet2',
    address: 'tprl1pdeposit',
    requiredConfirmations: 6,
    status: 'active',
    metadata: {},
    createdAt: '2026-05-18T17:59:00.000Z',
    updatedAt: '2026-05-18T17:59:00.000Z',
    observations: [],
    spends: [],
  };
}

function reserveWatch(amountGrains: string): WatchedBridgeAddressWithHistory {
  return {
    watchId: `reserve-${amountGrains}`,
    purpose: 'bridge_reserve',
    network: 'testnet2',
    address: 'tprl1preserve',
    requiredConfirmations: 6,
    status: 'active',
    metadata: {},
    createdAt: '2026-05-18T17:59:00.000Z',
    updatedAt: '2026-05-18T17:59:00.000Z',
    observations: [observation({ amountGrains, matchStatus: 'confirmed' })],
    spends: [],
  };
}

function observation(overrides: Partial<BridgeAddressObservation> = {}): BridgeAddressObservation {
  return {
    outpoint: 'tx:0',
    watchId: 'watch-1',
    blockHash: 'block',
    height: 100,
    amountGrains: '500',
    confirmations: 6,
    matchStatus: 'confirmed',
    classification: 'on_time',
    observedAt: '2026-05-18T17:59:00.000Z',
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
    requestedAmountGrains: '200',
    pearlRecipient: 'tprl1precipient',
    status: 'pending',
    createdAt: '2026-05-18T17:59:00.000Z',
    updatedAt: '2026-05-18T17:59:00.000Z',
    ...overrides,
  };
}
