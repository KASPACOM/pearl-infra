import assert from 'node:assert/strict';
import test from 'node:test';

import { applyExitLifecycleEvent, bridgeExitFromIgraEvent, mirrorIgraBridgeEvent } from '../src/igra-events.ts';

test('mirrors Igra exit request event into idempotent bridge exit row', () => {
  const event = mirrorIgraBridgeEvent({
    eventType: 'exit_requested',
    txHash: '0xBURN',
    logIndex: 2,
    blockNumber: 123,
    chainId: 19416,
    payload: {
      exitId: 'exit-1',
      amountGrains: '100',
      pearlRecipient: 'tprl1recipient',
      requester: '0x1111111111111111111111111111111111111111',
    },
    observedAt: '2026-05-19T00:00:00.000Z',
  });
  const exit = bridgeExitFromIgraEvent(event, new Date('2026-05-19T00:00:01.000Z'));

  assert.equal(event.eventId, 'igra:19416:0xburn:2');
  assert.equal(event.txHash, '0xburn');
  assert.equal(exit?.exitId, 'exit-1');
  assert.equal(exit?.igraBurnLogIndex, 2);
  assert.equal(exit?.status, 'pending');
});

test('applies processed and refunded lifecycle events to existing exit rows', () => {
  const requested = bridgeExitFromIgraEvent(mirrorIgraBridgeEvent({
    eventType: 'exit_requested',
    txHash: '0xburn',
    logIndex: 0,
    blockNumber: 123,
    chainId: 19416,
    payload: {
      exitId: 'exit-1',
      amountGrains: '100',
      pearlRecipient: 'tprl1recipient',
    },
  }))!;
  const processed = applyExitLifecycleEvent(requested, mirrorIgraBridgeEvent({
    eventType: 'exit_processed',
    txHash: '0xprocess',
    logIndex: 0,
    blockNumber: 124,
    chainId: 19416,
    payload: {
      pearlReleaseTxid: 'release_tx',
      pearlReleaseBlock: 99,
    },
  }), new Date('2026-05-19T00:05:00.000Z'));
  const refunded = applyExitLifecycleEvent(requested, mirrorIgraBridgeEvent({
    eventType: 'exit_refunded',
    txHash: '0xrefund',
    logIndex: 0,
    blockNumber: 125,
    chainId: 19416,
    payload: {},
  }), new Date('2026-05-19T00:06:00.000Z'));

  assert.equal(processed.status, 'processed');
  assert.equal(processed.pearlReleaseTxid, 'release_tx');
  assert.equal(processed.pearlReleaseBlock, 99);
  assert.equal(processed.releasedAt, undefined);
  assert.equal(refunded.status, 'refunded');
});

test('normalizes bytes32 Pearl release txids from Igra processed events', () => {
  const requested = bridgeExitFromIgraEvent(mirrorIgraBridgeEvent({
    eventType: 'exit_requested',
    txHash: '0xburn',
    logIndex: 0,
    blockNumber: 123,
    chainId: 19416,
    payload: {
      exitId: 'exit-1',
      amountGrains: '100',
      pearlRecipient: 'tprl1recipient',
    },
  }))!;
  const releaseTxid = '22bc370a13dcd0f3c4dfdf5c3ddd29323146a78b478157115debc846f855e7b1';
  const processed = applyExitLifecycleEvent(requested, mirrorIgraBridgeEvent({
    eventType: 'exit_processed',
    txHash: '0xprocess',
    logIndex: 0,
    blockNumber: 124,
    chainId: 19416,
    payload: {
      pearlReleaseTxid: `0x${releaseTxid.toUpperCase()}`,
      pearlReleaseBlock: 99,
    },
  }));

  assert.equal(processed.pearlReleaseTxid, releaseTxid);
});
