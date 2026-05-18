import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InMemoryUsdcEscrowEventRepository,
  type UsdcEscrowTradeEvent,
} from '@kaspacom/usdc-escrow-client';
import type { OtcTrade } from '@kaspacom/pearl-sdk';

import {
  InMemorySettlementBroadcasterAdapter,
  InMemorySettlementDecisionRepository,
  InMemorySettlementSignerAdapter,
  InMemorySettlementWorkerTradeSource,
  runSettlementWorkerIteration,
  StaticSettlementBaseEscrowSource,
  StaticSettlementPearlProofSource,
} from '../dist/index.js';

const NOW = new Date('2026-05-18T14:00:00.000Z');
const TRADE_KEY = '0x' + '55'.repeat(32);

test('worker loop consumes Base event state and prepares PRL release once', async () => {
  const baseEvents = new InMemoryUsdcEscrowEventRepository();
  await baseEvents.ingestEvents([
    baseEvent({
      eventName: 'TradeCreated',
      txHash: '0xcreate',
      logIndex: 0,
      buyer: '0x1111111111111111111111111111111111111111',
      seller: '0x2222222222222222222222222222222222222222',
      amountMicros: '85000000',
      feeMicros: '0',
      expiryUnixSeconds: 1_779_000_000,
    }),
    baseEvent({
      eventName: 'Deposited',
      txHash: '0xdeposit',
      logIndex: 1,
      payer: '0x1111111111111111111111111111111111111111',
      amountMicros: '85000000',
    }),
  ]);

  const trade = tradeFixture({ state: 'usdc_escrow_confirmed' });
  const trades = new InMemorySettlementWorkerTradeSource([trade]);
  const signer = new InMemorySettlementSignerAdapter();
  const dependencies = {
    trades,
    pearl: new StaticSettlementPearlProofSource(
      new Map([
        [
          trade.tradeId,
          {
            status: 'confirmed' as const,
            sourceEventId: 'pearl:funding:tx1:0',
            txid: 'tx1',
            outpoint: 'tx1:0',
            confirmations: 6,
            observedAt: '2026-05-18T12:30:00.000Z',
          },
        ],
      ]),
    ),
    base: new StaticSettlementBaseEscrowSource(
      new Map([[TRADE_KEY, (await baseEvents.getTradeState(TRADE_KEY))!]]),
    ),
    decisions: new InMemorySettlementDecisionRepository(),
    signer,
    broadcaster: new InMemorySettlementBroadcasterAdapter(),
  };

  const first = await runSettlementWorkerIteration(dependencies, NOW);
  const second = await runSettlementWorkerIteration(dependencies, new Date('2026-05-18T14:05:00.000Z'));

  assert.equal(first.scannedTrades, 1);
  assert.equal(first.decisions[0]?.action, 'prepare_prl_release');
  assert.equal(first.preparedActions.length, 1);
  assert.equal(first.preparedActions[0]?.status, 'prepared');
  assert.equal(first.preparedActions[0]?.metadata?.liveBroadcast, false);
  assert.equal(signer.preparedActions.length, 1);
  assert.equal(trade.state, 'release_pending');
  assert.equal(second.preparedActions.length, 0);
  assert.equal(signer.preparedActions.length, 1);
});

test('worker loop prepares USDC release through broadcaster after PRL release confirmation', async () => {
  const baseEvents = new InMemoryUsdcEscrowEventRepository();
  await baseEvents.ingestEvents([
    baseEvent({
      eventName: 'Deposited',
      txHash: '0xdeposit',
      logIndex: 0,
      payer: '0x1111111111111111111111111111111111111111',
      amountMicros: '85000000',
    }),
  ]);

  const trade = tradeFixture({ state: 'release_pending' });
  const broadcaster = new InMemorySettlementBroadcasterAdapter();
  const result = await runSettlementWorkerIteration(
    {
      trades: new InMemorySettlementWorkerTradeSource([trade]),
      pearl: new StaticSettlementPearlProofSource(
        new Map([
          [
            trade.tradeId,
            {
              status: 'released' as const,
              sourceEventId: 'pearl:release:tx2',
              txid: 'tx2',
              confirmations: 6,
              observedAt: '2026-05-18T13:30:00.000Z',
            },
          ],
        ]),
      ),
      base: new StaticSettlementBaseEscrowSource(
        new Map([[TRADE_KEY, (await baseEvents.getTradeState(TRADE_KEY))!]]),
      ),
      decisions: new InMemorySettlementDecisionRepository(),
      signer: new InMemorySettlementSignerAdapter(),
      broadcaster,
    },
    NOW,
  );

  assert.equal(result.decisions[0]?.action, 'prepare_usdc_release');
  assert.equal(result.preparedActions[0]?.action, 'prepare_usdc_release');
  assert.equal(result.preparedActions[0]?.metadata?.adapter, 'broadcaster');
  assert.equal(broadcaster.preparedActions.length, 1);
});

test('worker loop fails closed and does not prepare actions for unsafe Base state', async () => {
  const trade = tradeFixture({ state: 'usdc_escrow_confirmed' });
  const trades = new InMemorySettlementWorkerTradeSource([trade]);
  const signer = new InMemorySettlementSignerAdapter();
  const result = await runSettlementWorkerIteration(
    {
      trades,
      pearl: new StaticSettlementPearlProofSource(
        new Map([
          [
            trade.tradeId,
            {
              status: 'confirmed' as const,
              sourceEventId: 'pearl:funding:tx3:0',
              confirmations: 6,
              observedAt: '2026-05-18T12:30:00.000Z',
            },
          ],
        ]),
      ),
      base: {
        async getBaseEscrowState() {
          return {
            status: 'stale' as const,
            sourceEventId: 'base:stale',
            confirmations: 0,
            observedAt: '2026-05-18T13:55:00.000Z',
            reason: 'no fresh Base RPC checkpoint',
          };
        },
      },
      decisions: new InMemorySettlementDecisionRepository(),
      signer,
      broadcaster: new InMemorySettlementBroadcasterAdapter(),
    },
    NOW,
  );

  assert.equal(result.decisions[0]?.action, 'manual_review');
  assert.equal(result.preparedActions.length, 0);
  assert.equal(signer.preparedActions.length, 0);
  assert.equal(trade.state, 'failed_manual_review');
  assert.equal(trades.manualReviews.length, 1);
});

function baseEvent(overrides: Partial<UsdcEscrowTradeEvent>): UsdcEscrowTradeEvent {
  return {
    network: 'base_sepolia',
    chainId: 84532,
    contractAddress: '0x3333333333333333333333333333333333333333',
    tradeKey: TRADE_KEY,
    blockNumber: 123,
    blockHash: '0xblock',
    confirmations: 12,
    observedAt: '2026-05-18T13:00:00.000Z',
    ...overrides,
  } as UsdcEscrowTradeEvent;
}

function tradeFixture(overrides: Partial<Pick<OtcTrade, 'state'>> = {}): OtcTrade {
  return {
    tradeId: 'trade-settlement-loop-1',
    quoteId: 'quote-settlement-loop-1',
    state: overrides.state ?? 'usdc_escrow_confirmed',
    side: 'buy_prl',
    amountPrl: '500.00000000',
    amountUsdc: '85.000000',
    feePrl: '0.00000000',
    feeUsdc: '0.000000',
    buyerPearlAddress: 'tprl1pbuyer',
    buyerUsdcAddress: '0x1111111111111111111111111111111111111111',
    sellerPearlRefundAddress: 'tprl1pseller',
    sellerUsdcReceiveAddress: '0x2222222222222222222222222222222222222222',
    pearlEscrow: {
      network: 'testnet2',
      address: 'tprl1pescrow',
      expectedAmountGrains: '50000000000',
      requiredConfirmations: 6,
      fundingOutpoint: 'tx1:0',
    },
    usdcEscrow: {
      network: 'base',
      chainId: 84532,
      contract: '0x3333333333333333333333333333333333333333',
      usdcToken: '0x4444444444444444444444444444444444444444',
      tradeKey: TRADE_KEY,
      expectedAmountMicros: '85000000',
      requiredConfirmations: 12,
      expiresAt: '2026-05-18T13:30:00.000Z',
    },
    deadlines: {
      quoteExpiresAt: '2026-05-18T12:00:00.000Z',
      pearlFundingDeadline: '2026-05-18T13:00:00.000Z',
      usdcDepositDeadline: '2026-05-18T13:30:00.000Z',
      settlementDeadline: '2026-05-18T15:00:00.000Z',
      refundAvailableAt: '2026-05-18T13:30:00.000Z',
    },
    createdAt: '2026-05-18T11:30:00.000Z',
    updatedAt: '2026-05-18T13:45:00.000Z',
  };
}
