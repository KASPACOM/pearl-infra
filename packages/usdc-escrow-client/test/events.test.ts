import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isUsdcEscrowEventName,
  usdcEscrowObservationIsConfirmed,
} from '../src/events.ts';

test('recognizes escrow event names', () => {
  assert.equal(isUsdcEscrowEventName('Deposited'), true);
  assert.equal(isUsdcEscrowEventName('Transfer'), false);
});

test('checks Arbitrum confirmation threshold', () => {
  assert.equal(usdcEscrowObservationIsConfirmed({ confirmations: 5 }, 6), false);
  assert.equal(usdcEscrowObservationIsConfirmed({ confirmations: 6 }, 6), true);
});
