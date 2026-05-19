import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDepositBridgeEvent,
  createExitBridgeEvent,
  evaluateBridgeAttestationQuorum,
  type BridgeRelayerAttestation,
} from '../src/attestations.ts';

const policy = {
  relayerIds: ['relayer-a', 'relayer-b', 'relayer-c'],
  requiredAttestations: 2,
};

test('creates deterministic canonical deposit event identity independent of object ordering', () => {
  const first = createDepositBridgeEvent({
    pearlNetwork: 'testnet2',
    pearlTxid: 'pearl_tx_1',
    vout: 0,
    amountGrains: '100000000',
    igraRecipient: '0x1111111111111111111111111111111111111111',
    depositWatchId: 'deposit-1',
    requiredConfirmations: 20,
    observedConfirmations: 20,
  });
  const second = createDepositBridgeEvent({
    pearlNetwork: 'testnet2',
    pearlTxid: 'pearl_tx_1',
    vout: 0,
    amountGrains: '100000000',
    igraRecipient: '0x1111111111111111111111111111111111111111'.toUpperCase(),
    depositWatchId: 'deposit-1',
    requiredConfirmations: 20,
    observedConfirmations: 20,
  });

  assert.equal(first.eventId, second.eventId);
  assert.equal(first.eventHash, second.eventHash);
  assert.match(first.eventHash, /^0x[0-9a-f]{64}$/);
});

test('deposit event id stays tied to Pearl outpoint while event hash changes on amount', () => {
  const base = createDepositBridgeEvent({
    pearlNetwork: 'testnet2',
    pearlTxid: 'pearl_tx_1',
    vout: 0,
    amountGrains: '100000000',
    igraRecipient: '0x1111111111111111111111111111111111111111',
    depositWatchId: 'deposit-1',
    requiredConfirmations: 20,
    observedConfirmations: 20,
  });
  const changedAmount = createDepositBridgeEvent({
    pearlNetwork: 'testnet2',
    pearlTxid: 'pearl_tx_1',
    vout: 0,
    amountGrains: '200000000',
    igraRecipient: '0x1111111111111111111111111111111111111111',
    depositWatchId: 'deposit-1',
    requiredConfirmations: 20,
    observedConfirmations: 20,
  });

  assert.equal(base.eventId, changedAmount.eventId);
  assert.notEqual(base.eventHash, changedAmount.eventHash);
});

test('approves quorum from distinct authorized relayers after finality', () => {
  const event = createExitBridgeEvent({
    exitId: 'exit-1',
    igraBurnTxid: '0xburn',
    igraBurnLogIndex: 0,
    igraBurnBlock: 100,
    igraChainId: 19416,
    bridgeAddress: '0x2222222222222222222222222222222222222222',
    amountGrains: '100000000',
    pearlRecipient: 'tprl1precipient',
    requiredConfirmations: 20,
    observedConfirmations: 21,
  });

  const quorum = evaluateBridgeAttestationQuorum({
    event,
    policy,
    attestations: [attestation('relayer-b', event), attestation('relayer-a', event)],
  });

  assert.equal(quorum.status, 'approved');
  assert.equal(quorum.validAttestationCount, 2);
  assert.deepEqual(quorum.relayerIds, ['relayer-a', 'relayer-b']);
  assert.deepEqual(quorum.blockers, []);
});

test('waits before finality and fails closed on mismatched hashes or unknown relayers', () => {
  const event = createDepositBridgeEvent({
    pearlNetwork: 'testnet2',
    pearlTxid: 'pearl_tx_1',
    vout: 0,
    amountGrains: '100000000',
    igraRecipient: '0x1111111111111111111111111111111111111111',
    depositWatchId: 'deposit-1',
    requiredConfirmations: 20,
    observedConfirmations: 10,
  });

  const waiting = evaluateBridgeAttestationQuorum({
    event,
    policy,
    attestations: [attestation('relayer-a', event), attestation('relayer-b', event)],
  });
  assert.equal(waiting.status, 'wait');
  assert.deepEqual(waiting.blockers, ['event_finality_not_reached']);

  const blocked = evaluateBridgeAttestationQuorum({
    event: { ...event, observedConfirmations: 20 },
    policy,
    attestations: [
      { ...attestation('relayer-a', event), eventHash: '0xdead' },
      attestation('relayer-x', event),
    ],
  });
  assert.equal(blocked.status, 'manual_review');
  assert.deepEqual(blocked.blockers, [
    'attestation_event_hash_mismatch:relayer-a',
    'unknown_relayer:relayer-x',
  ]);
});

function attestation(relayerId: string, event: { eventId: string; eventHash: string }): BridgeRelayerAttestation {
  return {
    relayerId,
    eventId: event.eventId,
    eventHash: event.eventHash,
    observedAt: '2026-05-19T00:00:00.000Z',
    signature: `sig:${relayerId}`,
  };
}
