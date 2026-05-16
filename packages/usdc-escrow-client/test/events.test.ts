import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isUsdcEscrowEventName,
  usdcEscrowObservationIsConfirmed,
} from '../src/events.ts';
import {
  BASE_MAINNET_USDC,
  BASE_SEPOLIA_USDC,
  getUsdcEscrowNetworkConfig,
} from '../src/networks.ts';

test('recognizes escrow event names', () => {
  assert.equal(isUsdcEscrowEventName('Deposited'), true);
  assert.equal(isUsdcEscrowEventName('Paused'), true);
  assert.equal(isUsdcEscrowEventName('Transfer'), false);
});

test('checks Base confirmation threshold', () => {
  assert.equal(usdcEscrowObservationIsConfirmed({ confirmations: 5 }, 6), false);
  assert.equal(usdcEscrowObservationIsConfirmed({ confirmations: 6 }, 6), true);
});

test('exposes Base USDC network config', () => {
  assert.equal(getUsdcEscrowNetworkConfig('base').chainId, 8453);
  assert.equal(getUsdcEscrowNetworkConfig('base').usdcToken, BASE_MAINNET_USDC);
  assert.equal(getUsdcEscrowNetworkConfig('base_sepolia').chainId, 84532);
  assert.equal(getUsdcEscrowNetworkConfig('base_sepolia').usdcToken, BASE_SEPOLIA_USDC);
});
