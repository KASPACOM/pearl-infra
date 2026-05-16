import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertTradeTransition,
  canTransitionTrade,
  tradeStateIsTerminal,
} from '../src/otc.ts';

test('allows the happy-path OTC settlement transitions', () => {
  assert.equal(canTransitionTrade('quoted', 'pearl_escrow_pending'), true);
  assert.equal(canTransitionTrade('pearl_escrow_pending', 'pearl_escrow_seen'), true);
  assert.equal(canTransitionTrade('pearl_escrow_seen', 'pearl_escrow_confirmed'), true);
  assert.equal(canTransitionTrade('pearl_escrow_confirmed', 'usdc_escrow_pending'), true);
  assert.equal(canTransitionTrade('usdc_escrow_pending', 'usdc_escrow_confirmed'), true);
  assert.equal(canTransitionTrade('usdc_escrow_confirmed', 'release_pending'), true);
  assert.equal(canTransitionTrade('release_pending', 'released'), true);
});

test('rejects unsafe settlement transitions', () => {
  assert.equal(canTransitionTrade('quoted', 'released'), false);
  assert.throws(() => assertTradeTransition('quoted', 'released'), /invalid trade transition/);
});

test('marks completed trade states as terminal', () => {
  assert.equal(tradeStateIsTerminal('released'), true);
  assert.equal(tradeStateIsTerminal('refunded'), true);
  assert.equal(tradeStateIsTerminal('quote_expired'), true);
  assert.equal(tradeStateIsTerminal('pearl_escrow_confirmed'), false);
});
