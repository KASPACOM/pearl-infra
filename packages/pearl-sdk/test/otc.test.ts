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
  assert.equal(tradeStateIsTerminal('failed_manual_review'), true);
  assert.equal(tradeStateIsTerminal('pearl_escrow_confirmed'), false);
});

test('routes edge-case observations to failed manual review only', () => {
  assert.equal(canTransitionTrade('pearl_escrow_pending', 'late_prl_funding'), true);
  assert.equal(canTransitionTrade('late_prl_funding', 'failed_manual_review'), true);
  assert.equal(canTransitionTrade('late_prl_funding', 'disputed'), false);
  assert.equal(canTransitionTrade('late_prl_funding', 'release_pending'), false);
  assert.equal(canTransitionTrade('usdc_escrow_confirmed', 'usdc_refunded'), true);
  assert.equal(canTransitionTrade('usdc_refunded', 'failed_manual_review'), true);
  assert.equal(canTransitionTrade('usdc_refunded', 'release_pending'), false);
  assert.equal(canTransitionTrade('release_pending', 'prl_release_failed'), true);
  assert.equal(canTransitionTrade('prl_release_failed', 'failed_manual_review'), true);
});
