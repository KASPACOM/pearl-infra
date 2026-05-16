import assert from 'node:assert/strict';
import test from 'node:test';

import { escrowFundingIsConfirmed } from '../src/proof.ts';
import { applyDetachedBlock } from '../src/reorg.ts';
import { createEscrowWatch } from '../src/watch.ts';

test('creates an escrow watch in watching state', () => {
  const watch = createEscrowWatch({
    tradeId: 'trade_1',
    network: 'mainnet',
    address: 'prl1p...',
    expectedAmountGrains: '100000000',
    requiredConfirmations: 3,
  }, new Date('2026-05-16T00:00:00.000Z'));

  assert.equal(watch.status, 'watching');
  assert.equal(watch.createdAt, '2026-05-16T00:00:00.000Z');
});

test('checks funding confirmation threshold', () => {
  assert.equal(escrowFundingIsConfirmed({
    requiredConfirmations: 3,
    funding: { confirmations: 2 },
  }), false);

  assert.equal(escrowFundingIsConfirmed({
    requiredConfirmations: 3,
    funding: { confirmations: 3 },
  }), true);
});

test('marks a transaction detached when its block reorgs out', () => {
  const view = applyDetachedBlock({
    txid: 'abc',
    confirmations: 4,
    blockHeight: 100,
    detached: false,
  }, 100);

  assert.equal(view.confirmations, 0);
  assert.equal(view.detached, true);
});
