import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decideDepositMint,
  decideExitRelease,
} from '../src/relayer-policy.ts';
import {
  createDepositBridgeEvent,
  createExitBridgeEvent,
  evaluateBridgeAttestationQuorum,
  type BridgeAttestationQuorum,
} from '../src/attestations.ts';
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

const quorumPolicy = {
  relayerIds: ['relayer-a', 'relayer-b', 'relayer-c'],
  requiredAttestations: 2,
};

test('prepares mint only after confirmed deposit and manual approval', () => {
  const obs = observation({ amountGrains: '500', matchStatus: 'confirmed' });
  const watch = depositWatch({ observations: [obs] });

  const waiting = decideDepositMint({
    watch,
    observation: obs,
    limits,
    mintedSupplyGrains: '1000',
    attestationQuorum: approvedDepositQuorum(watch, obs),
  });
  const approved = decideDepositMint({
    watch,
    observation: obs,
    limits,
    mintedSupplyGrains: '1000',
    attestationQuorum: approvedDepositQuorum(watch, obs),
    manualApprovalId: 'approval-1',
  });

  assert.equal(waiting.action, 'wait');
  assert.match(waiting.reason, /manual operator approval/);
  assert.equal(approved.action, 'prepare_mint');
  assert.equal(approved.metadata?.amountGrains, '500');
  assert.equal(approved.metadata?.relayerAttestations, 2);
  assert.match(approved.idempotencyKey, /^bridge:prepare_mint:/);
});

test('waits for quorum attestations before mint even with manual approval', () => {
  const obs = observation({ amountGrains: '500', matchStatus: 'confirmed' });
  const watch = depositWatch({ observations: [obs] });

  const missing = decideDepositMint({
    watch,
    observation: obs,
    limits,
    mintedSupplyGrains: '1000',
    manualApprovalId: 'approval-1',
  });
  const incomplete = decideDepositMint({
    watch,
    observation: obs,
    limits,
    mintedSupplyGrains: '1000',
    attestationQuorum: approvedDepositQuorum(watch, obs, 1),
    manualApprovalId: 'approval-1',
  });

  assert.equal(missing.action, 'wait');
  assert.match(missing.reason, /quorum attestations/);
  assert.equal(incomplete.action, 'wait');
  assert.match(incomplete.reason, /1\/2/);
});

test('routes unsafe deposits to manual review before mint', () => {
  const obs = observation({ amountGrains: '5000', matchStatus: 'confirmed' });
  const decision = decideDepositMint({
    watch: depositWatch({
      metadata: {
        expected_amount_min_grains: '100',
        expected_amount_max_grains: '10000',
      },
      observations: [obs],
    }),
    observation: obs,
    limits,
    mintedSupplyGrains: '1000',
    attestationQuorum: approvedDepositQuorum(depositWatch({ observations: [obs] }), obs),
    manualApprovalId: 'approval-1',
  });

  assert.equal(decision.action, 'manual_review');
  assert.match(decision.reason, /above pilot maximum/);
});

test('routes wrong-watch, low-confirmation, and out-of-range deposit inputs to manual review', () => {
  const lowConfirmationWatch = depositWatch({
    observations: [observation({ confirmations: 2, matchStatus: 'confirmed' })],
  });
  const lowConfirmation = decideDepositMint({
    watch: lowConfirmationWatch,
    observation: lowConfirmationWatch.observations[0],
    limits,
    mintedSupplyGrains: '1000',
    attestationQuorum: approvedDepositQuorum(lowConfirmationWatch, lowConfirmationWatch.observations[0]),
    manualApprovalId: 'approval-1',
  });

  const wrongWatch = decideDepositMint({
    watch: depositWatch(),
    observation: observation({ watchId: 'other-watch', amountGrains: '500', matchStatus: 'confirmed' }),
    limits,
    mintedSupplyGrains: '1000',
    attestationQuorum: approvedDepositQuorum(depositWatch(), observation({ watchId: 'other-watch', amountGrains: '500', matchStatus: 'confirmed' })),
    manualApprovalId: 'approval-1',
  });

  const aboveExpectedWatch = depositWatch({
    metadata: {
      expected_amount_min_grains: '100',
      expected_amount_max_grains: '400',
    },
    observations: [observation({ amountGrains: '500', matchStatus: 'confirmed' })],
  });
  const aboveExpected = decideDepositMint({
    watch: aboveExpectedWatch,
    observation: aboveExpectedWatch.observations[0],
    limits,
    mintedSupplyGrains: '1000',
    attestationQuorum: approvedDepositQuorum(aboveExpectedWatch, aboveExpectedWatch.observations[0]),
    manualApprovalId: 'approval-1',
  });

  assert.equal(lowConfirmation.action, 'manual_review');
  assert.match(lowConfirmation.reason, /enough confirmations/);
  assert.equal(wrongWatch.action, 'manual_review');
  assert.match(wrongWatch.reason, /does not belong/);
  assert.equal(aboveExpected.action, 'manual_review');
  assert.match(aboveExpected.reason, /expected maximum/);
});

test('routes multiple live deposit observations to manual review before mint', () => {
  const watch = depositWatch({
    observations: [
      observation({ outpoint: 'tx:0', amountGrains: '500', matchStatus: 'confirmed' }),
      observation({ outpoint: 'tx:1', amountGrains: '500', matchStatus: 'confirmed' }),
    ],
  });

  const decision = decideDepositMint({
    watch,
    observation: watch.observations[0],
    limits,
    mintedSupplyGrains: '1000',
    attestationQuorum: approvedDepositQuorum(watch, watch.observations[0]),
    manualApprovalId: 'approval-1',
  });

  assert.equal(decision.action, 'manual_review');
  assert.match(decision.reason, /multiple live deposit/);
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
    attestationQuorum: approvedExitQuorum(exitRequest({ requestedAmountGrains: '200' })),
  });
  const approved = decideExitRelease({
    exit: exitRequest({ requestedAmountGrains: '200' }),
    reconciliation,
    limits,
    attestationQuorum: approvedExitQuorum(exitRequest({ requestedAmountGrains: '200' })),
    manualApprovalId: 'approval-exit-1',
  });

  assert.equal(waiting.action, 'wait');
  assert.match(waiting.reason, /manual operator approval/);
  assert.equal(approved.action, 'prepare_exit_release');
  assert.equal(approved.metadata?.amountGrains, '200');
  assert.equal(approved.metadata?.relayerAttestations, 2);
});

test('waits for Pearl reserve-spend confirmation after Igra exit is processed', () => {
  const exit = exitRequest({
    status: 'processed',
    pearlReleaseTxid: 'operator-reported-release',
  });
  const reconciliation = createBridgeReconciliationSnapshot({
    depositWatches: [],
    reserveWatches: [reserveWatch('1000')],
    exits: [exit],
    mintedSupplyGrains: '500',
    now: new Date('2026-05-18T18:00:00.000Z'),
  });

  const decision = decideExitRelease({
    exit,
    reconciliation,
    limits,
    attestationQuorum: approvedExitQuorum(exit),
    manualApprovalId: 'approval-exit-1',
  });

  assert.equal(decision.action, 'wait');
  assert.match(decision.reason, /waiting for Pearl reserve spend/);
});

test('blocks exit release on failed quorum before release preparation', () => {
  const exit = exitRequest({ requestedAmountGrains: '200' });
  const reconciliation = createBridgeReconciliationSnapshot({
    depositWatches: [],
    reserveWatches: [reserveWatch('1000')],
    exits: [exit],
    mintedSupplyGrains: '500',
    now: new Date('2026-05-18T18:00:00.000Z'),
  });
  const event = createExitBridgeEvent({
    exitId: exit.exitId,
    igraBurnTxid: exit.igraBurnTxid,
    igraBurnLogIndex: exit.igraBurnLogIndex,
    igraBurnBlock: exit.igraBurnBlock,
    igraChainId: exit.igraChainId,
    bridgeAddress: '0x2222222222222222222222222222222222222222',
    amountGrains: exit.requestedAmountGrains,
    pearlRecipient: exit.pearlRecipient,
    requiredConfirmations: 20,
    observedConfirmations: 20,
  });
  const blockedQuorum = evaluateBridgeAttestationQuorum({
    event,
    policy: quorumPolicy,
    attestations: [
      {
        relayerId: 'relayer-a',
        eventId: event.eventId,
        eventHash: '0xdead',
        observedAt: '2026-05-18T18:00:00.000Z',
      },
    ],
  });

  const decision = decideExitRelease({
    exit,
    reconciliation,
    limits,
    attestationQuorum: blockedQuorum,
    manualApprovalId: 'approval-exit-1',
  });

  assert.equal(decision.action, 'manual_review');
  assert.match(decision.reason, /event_hash_mismatch/);
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

function depositWatch(overrides: Partial<WatchedBridgeAddressWithHistory> = {}): WatchedBridgeAddressWithHistory {
  return {
    watchId: 'deposit-1',
    purpose: 'bridge_deposit',
    network: 'testnet2',
    address: 'tprl1pdeposit',
    requiredConfirmations: 6,
    status: 'active',
    metadata: {
      expected_amount_min_grains: '100',
      expected_amount_max_grains: '1000',
    },
    createdAt: '2026-05-18T17:59:00.000Z',
    updatedAt: '2026-05-18T17:59:00.000Z',
    observations: [],
    spends: [],
    ...overrides,
  };
}

function approvedDepositQuorum(
  watch: WatchedBridgeAddressWithHistory,
  obs: BridgeAddressObservation,
  attestationCount = 2,
): BridgeAttestationQuorum {
  const [pearlTxid, vout = '0'] = obs.outpoint.split(':');
  const event = createDepositBridgeEvent({
    pearlNetwork: watch.network,
    pearlTxid,
    vout: Number(vout),
    amountGrains: obs.amountGrains,
    igraRecipient: typeof watch.metadata.igra_recipient === 'string'
      ? watch.metadata.igra_recipient
      : '0x1111111111111111111111111111111111111111',
    depositWatchId: watch.watchId,
    requiredConfirmations: watch.requiredConfirmations,
    observedConfirmations: obs.confirmations,
  });
  return evaluateBridgeAttestationQuorum({
    event,
    policy: quorumPolicy,
    attestations: quorumPolicy.relayerIds.slice(0, attestationCount).map((relayerId) => ({
      relayerId,
      eventId: event.eventId,
      eventHash: event.eventHash,
      observedAt: '2026-05-18T18:00:00.000Z',
    })),
  });
}

function approvedExitQuorum(exit: BridgeExitRequest): BridgeAttestationQuorum {
  const event = createExitBridgeEvent({
    exitId: exit.exitId,
    igraBurnTxid: exit.igraBurnTxid,
    igraBurnLogIndex: exit.igraBurnLogIndex,
    igraBurnBlock: exit.igraBurnBlock,
    igraChainId: exit.igraChainId,
    bridgeAddress: '0x2222222222222222222222222222222222222222',
    amountGrains: exit.requestedAmountGrains,
    pearlRecipient: exit.pearlRecipient,
    requiredConfirmations: 20,
    observedConfirmations: 20,
  });
  return evaluateBridgeAttestationQuorum({
    event,
    policy: quorumPolicy,
    attestations: quorumPolicy.relayerIds.slice(0, 2).map((relayerId) => ({
      relayerId,
      eventId: event.eventId,
      eventHash: event.eventHash,
      observedAt: '2026-05-18T18:00:00.000Z',
    })),
  });
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
    watchId: 'deposit-1',
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
