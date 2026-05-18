import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { OtcTrade } from '@kaspacom/pearl-sdk';

import {
  createSettlementDecisionRecord,
  createSettlementSnapshot,
  JsonFileSettlementDecisionRepository,
} from '../dist/index.js';

const NOW = new Date('2026-05-18T14:00:00.000Z');

test('JSON settlement decision repository persists decisions idempotently', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'settlement-decisions-'));
  const filePath = join(dir, 'decisions.json');
  const decision = createSettlementDecisionRecord(
    createSettlementSnapshot({
      trade: tradeFixture(),
      pearl: {
        status: 'confirmed',
        sourceEventId: 'pearl:funding:simnet:1',
        outpoint: '11'.repeat(32) + ':1',
        confirmations: 6,
        observedAt: '2026-05-18T13:00:00.000Z',
      },
      base: {
        status: 'deposited',
        sourceEventId: 'base:deposit:0xabc',
        txHash: '0xabc',
        confirmations: 12,
        observedAt: '2026-05-18T13:30:00.000Z',
      },
      now: NOW,
    }),
    NOW,
  );

  const repository = new JsonFileSettlementDecisionRepository(filePath);
  const first = await repository.saveDecision(decision);
  const reloaded = new JsonFileSettlementDecisionRepository(filePath);
  const duplicate = await reloaded.saveDecision({
    ...decision,
    createdAt: '2026-05-18T14:05:00.000Z',
  });
  const found = await reloaded.findDecisionByIdempotencyKey(decision.idempotencyKey);
  const persisted = JSON.parse(await readFile(filePath, 'utf8')) as unknown[];

  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.decision.createdAt, decision.createdAt);
  assert.equal(found?.decisionId, decision.decisionId);
  assert.equal(persisted.length, 1);
});

function tradeFixture(): OtcTrade {
  return {
    tradeId: 'trade-durable-decision-1',
    quoteId: 'quote-durable-decision-1',
    state: 'usdc_escrow_confirmed',
    side: 'buy_prl',
    amountPrl: '500.00000000',
    amountUsdc: '85.000000',
    feePrl: '0.00000000',
    feeUsdc: '0.000000',
    buyerPearlAddress: 'rprl1pgxxyvcmdncdxs06cudd5yvmwwahaesaj6n3eu7st7x4sw9hrchaqmpuxye',
    buyerUsdcAddress: '0x1111111111111111111111111111111111111111',
    sellerPearlRefundAddress: 'rprl1pmfyaqrefev5e5qjvaaazcc08rcrqll9lcq8s2kdwd55psu6a244sa3tedd',
    sellerUsdcReceiveAddress: '0x2222222222222222222222222222222222222222',
    pearlEscrow: {
      network: 'simnet',
      address: 'rprl1pmfr3p9j00pfxjh0zmgp99y8zftmd3s5pmedqhyptwy6lm87hf5ssgn706v',
      expectedAmountGrains: '50000000000',
      requiredConfirmations: 6,
      fundingOutpoint: '11'.repeat(32) + ':1',
    },
    usdcEscrow: {
      network: 'base',
      chainId: 84532,
      contract: '0x3333333333333333333333333333333333333333',
      usdcToken: '0x4444444444444444444444444444444444444444',
      tradeKey: '0x' + '55'.repeat(32),
      expectedAmountMicros: '85000000',
      requiredConfirmations: 12,
      expiresAt: '2026-05-18T13:30:00.000Z',
    },
    deadlines: {
      quoteExpiresAt: '2026-05-18T12:00:00.000Z',
      pearlFundingDeadline: '2026-05-18T13:15:00.000Z',
      usdcDepositDeadline: '2026-05-18T13:30:00.000Z',
      settlementDeadline: '2026-05-18T15:00:00.000Z',
      refundAvailableAt: '2026-05-18T13:30:00.000Z',
    },
    createdAt: '2026-05-18T11:30:00.000Z',
    updatedAt: '2026-05-18T13:45:00.000Z',
  };
}
