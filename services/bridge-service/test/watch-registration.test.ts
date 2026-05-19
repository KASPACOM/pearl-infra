import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildBridgeDepositWatch,
  buildBridgeReserveWatch,
} from '../src/watch-registration.ts';

test('builds bridge deposit watch metadata for the Pearl indexer', () => {
  const watch = buildBridgeDepositWatch({
    depositId: 'deposit-1',
    network: 'testnet2',
    depositAddress: 'tprl1pdeposit',
    igraRecipient: '0x1111111111111111111111111111111111111111',
    expectedAmountMinGrains: '100000000',
    expectedAmountMaxGrains: '200000000',
    expiryHeight: 1200,
    requiredConfirmations: 6,
    createdAt: '2026-05-18T18:00:00.000Z',
  });

  assert.equal(watch.watchId, 'deposit-1');
  assert.equal(watch.purpose, 'bridge_deposit');
  assert.equal(watch.metadata.igra_recipient, '0x1111111111111111111111111111111111111111');
  assert.equal(watch.metadata.expected_amount_min_grains, '100000000');
  assert.equal(watch.metadata.expected_amount_max_grains, '200000000');
  assert.equal(watch.metadata.expiry_height, 1200);
});

test('builds bridge reserve watch metadata for reconciliation', () => {
  const watch = buildBridgeReserveWatch({
    reserveId: 'reserve-hot-1',
    network: 'testnet2',
    reserveAddress: 'tprl1preserve',
    custodyTier: 'hot',
    activeFromHeight: 1000,
    activeToHeight: 5000,
    requiredConfirmations: 6,
  });

  assert.equal(watch.watchId, 'reserve-hot-1');
  assert.equal(watch.purpose, 'bridge_reserve');
  assert.equal(watch.metadata.custody_tier, 'hot');
  assert.equal(watch.metadata.active_from_height, 1000);
  assert.equal(watch.metadata.active_to_height, 5000);
});

test('rejects unsafe bridge watch inputs before indexer registration', () => {
  assert.throws(
    () =>
      buildBridgeDepositWatch({
        depositId: 'deposit-1',
        network: 'testnet2',
        depositAddress: 'tprl1pdeposit',
        igraRecipient: '0x123',
        expectedAmountMinGrains: '100',
        expectedAmountMaxGrains: '200',
        expiryHeight: 1200,
        requiredConfirmations: 6,
      }),
    /igraRecipient must be an EVM address/,
  );

  assert.throws(
    () =>
      buildBridgeDepositWatch({
        depositId: 'deposit-1',
        network: 'testnet2',
        depositAddress: 'tprl1pdeposit',
        igraRecipient: '0x1111111111111111111111111111111111111111',
        expectedAmountMinGrains: '300',
        expectedAmountMaxGrains: '200',
        expiryHeight: 1200,
        requiredConfirmations: 6,
      }),
    /expectedAmountMinGrains must be <= expectedAmountMaxGrains/,
  );

  assert.throws(
    () =>
      buildBridgeReserveWatch({
        reserveId: 'reserve-hot-1',
        network: 'testnet2',
        reserveAddress: 'tprl1preserve',
        custodyTier: 'hot',
        activeFromHeight: 1000,
        activeToHeight: 999,
        requiredConfirmations: 6,
      }),
    /activeToHeight must be greater/,
  );
});
