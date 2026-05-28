import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createUsdcEscrowSourceEventId,
  InMemoryUsdcEscrowEventRepository,
  isUsdcEscrowEventName,
  normalizeUsdcEscrowTradeEvents,
  usdcEscrowObservationIsConfirmed,
} from '../src/events.ts';
import {
  BASE_MAINNET_USDC,
  BASE_SEPOLIA_USDC,
  BASE_SEPOLIA_USDC_ESCROW,
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
  assert.equal(getUsdcEscrowNetworkConfig('base_sepolia').escrowContract, BASE_SEPOLIA_USDC_ESCROW);
});

test('normalizes escrow lifecycle events into typed trade state', () => {
  const states = normalizeUsdcEscrowTradeEvents([
    eventFixture({
      eventName: 'TradeCreated',
      txHash: '0xcreate',
      logIndex: 0,
      buyer: '0xbuyer',
      seller: '0xseller',
      amountMicros: '85000000',
      feeMicros: '250000',
      expiryUnixSeconds: 1_779_000_000,
    }),
    eventFixture({
      eventName: 'Deposited',
      txHash: '0xdeposit',
      logIndex: 1,
      payer: '0xbuyer',
      amountMicros: '85000000',
    }),
    eventFixture({
      eventName: 'Released',
      txHash: '0xrelease',
      logIndex: 2,
      seller: '0xseller',
      sellerAmountMicros: '84750000',
      feeAmountMicros: '250000',
    }),
  ]);

  const state = states.get(TRADE_KEY);
  assert.equal(state?.status, 'released');
  assert.equal(state?.lastEventName, 'Released');
  assert.equal(state?.buyer, '0xbuyer');
  assert.equal(state?.seller, '0xseller');
  assert.equal(state?.depositTxHash, '0xdeposit');
  assert.equal(state?.releaseTxHash, '0xrelease');
  assert.equal(state?.sourceEventId, `base:84532:${TRADE_KEY}:Released:0xrelease:2`);
});

test('stores Base escrow events idempotently by source event id', async () => {
  const repository = new InMemoryUsdcEscrowEventRepository();
  const created = eventFixture({
    eventName: 'TradeCreated',
    txHash: '0xcreate',
    logIndex: 0,
    buyer: '0xbuyer',
    seller: '0xseller',
    amountMicros: '85000000',
    feeMicros: '250000',
    expiryUnixSeconds: 1_779_000_000,
  });
  const deposited = eventFixture({
    eventName: 'Deposited',
    txHash: '0xdeposit',
    logIndex: 1,
    payer: '0xbuyer',
    amountMicros: '85000000',
  });

  await repository.ingestEvents([created, deposited, deposited]);
  const state = await repository.getTradeState(TRADE_KEY);

  assert.equal(createUsdcEscrowSourceEventId(deposited), `base:84532:${TRADE_KEY}:Deposited:0xdeposit:1`);
  assert.equal(state?.status, 'deposited');
  assert.equal(state?.depositTxHash, '0xdeposit');
});

const TRADE_KEY = '0x' + '55'.repeat(32);

function eventFixture(overrides: Record<string, unknown>) {
  return {
    network: 'base_sepolia',
    chainId: 84532,
    contractAddress: '0x3333333333333333333333333333333333333333',
    tradeKey: TRADE_KEY,
    blockNumber: 123,
    blockHash: '0xblock',
    confirmations: 12,
    observedAt: '2026-05-18T12:00:00.000Z',
    ...overrides,
  } as never;
}
