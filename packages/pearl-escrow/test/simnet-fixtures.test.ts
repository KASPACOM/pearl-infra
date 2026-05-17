import assert from 'node:assert/strict';
import test from 'node:test';

import { Transaction } from 'bitcoinjs-lib';

import {
  createPearlEscrowPackage,
  createPearlEscrowUnsignedTx,
  matchPearlEscrowFundingOutput,
} from '../dist/index.js';

const INTERNAL_PUBKEY = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const BUYER_RELEASE_ADDRESS = 'rprl1pgxxyvcmdncdxs06cudd5yvmwwahaesaj6n3eu7st7x4sw9hrchaqmpuxye';
const SELLER_REFUND_ADDRESS = 'rprl1pmfyaqrefev5e5qjvaaazcc08rcrqll9lcq8s2kdwd55psu6a244sa3tedd';
const FUNDING_TXID = '11'.repeat(32);
const FUNDING_OUTPOINT = `${FUNDING_TXID}:1`;
const EXPECTED_ESCROW_ADDRESS = 'rprl1pmfr3p9j00pfxjh0zmgp99y8zftmd3s5pmedqhyptwy6lm87hf5ssgn706v';
const EXPECTED_ESCROW_SCRIPT = '5120da4710964f7852695de2da025290e24af6d8c281de5a0b902b7135fd9fd74d21';

test('simnet fixture derives the expected P2TR escrow address and script', () => {
  const escrow = createSimnetFixtureEscrow();

  assert.equal(escrow.network, 'simnet');
  assert.equal(escrow.escrowAddress, EXPECTED_ESCROW_ADDRESS);
  assert.equal(escrow.keys.taprootOutputScriptHex, EXPECTED_ESCROW_SCRIPT);
  assert.equal(escrow.fundingOutpoint, FUNDING_OUTPOINT);
  assert.equal(escrow.releaseTemplate.inputs[0].outpoint, FUNDING_OUTPOINT);
  assert.equal(escrow.refundTemplate.inputs[0].outpoint, FUNDING_OUTPOINT);
});

test('simnet fixture matches funding outputs by script, outpoint, and amount', () => {
  const escrow = createSimnetFixtureEscrow();

  assert.deepEqual(
    matchPearlEscrowFundingOutput(escrow, {
      txid: FUNDING_TXID,
      vout: 1,
      amountGrains: '50000000000',
      scriptPubKeyHex: EXPECTED_ESCROW_SCRIPT,
      blockHeight: 25,
      confirmations: 6,
    }),
    {
      matched: true,
      status: 'matched',
      outpoint: FUNDING_OUTPOINT,
      expectedAmountGrains: '50000000000',
      observedAmountGrains: '50000000000',
      scriptPubKeyHex: EXPECTED_ESCROW_SCRIPT,
      blockHeight: 25,
      confirmations: 6,
    },
  );

  assert.equal(
    matchPearlEscrowFundingOutput(escrow, {
      txid: FUNDING_TXID,
      vout: 1,
      amountGrains: '49999999999',
      address: EXPECTED_ESCROW_ADDRESS,
    }).status,
    'underpaid',
  );
  const overpaid = matchPearlEscrowFundingOutput(escrow, {
    txid: FUNDING_TXID,
    vout: 1,
    amountGrains: '50000000001',
    address: EXPECTED_ESCROW_ADDRESS,
  });
  assert.equal(overpaid.matched, false);
  assert.equal(overpaid.status, 'overpaid');
  assert.equal(
    matchPearlEscrowFundingOutput(escrow, {
      txid: FUNDING_TXID,
      vout: 2,
      amountGrains: '50000000000',
      scriptPubKeyHex: EXPECTED_ESCROW_SCRIPT,
    }).status,
    'outpoint_mismatch',
  );
  assert.equal(
    matchPearlEscrowFundingOutput(escrow, {
      txid: FUNDING_TXID,
      vout: 1,
      amountGrains: '50000000000',
      address: BUYER_RELEASE_ADDRESS,
    }).status,
    'script_mismatch',
  );
});

test('simnet fixture constructs unsigned release transaction', () => {
  const tx = createPearlEscrowUnsignedTx({
    escrow: createSimnetFixtureEscrow(),
    kind: 'release',
    feeGrains: '1000',
  });
  const parsed = Transaction.fromHex(tx.unsignedTxHex);

  assert.equal(tx.kind, 'release');
  assert.equal(tx.inputOutpoint, FUNDING_OUTPOINT);
  assert.equal(tx.inputAmountGrains, '50000000000');
  assert.equal(tx.outputAmountGrains, '49999999000');
  assert.equal(tx.feeGrains, '1000');
  assert.equal(tx.lockTime, 0);
  assert.equal(parsed.version, 2);
  assert.equal(parsed.ins.length, 1);
  assert.equal(parsed.ins[0].hash.reverse().toString('hex'), FUNDING_TXID);
  assert.equal(parsed.ins[0].index, 1);
  assert.equal(parsed.ins[0].sequence, Transaction.DEFAULT_SEQUENCE);
  assert.equal(parsed.outs.length, 1);
  assert.equal(parsed.outs[0].value, 49999999000);
});

test('simnet fixture constructs unsigned refund transaction with locktime', () => {
  const tx = createPearlEscrowUnsignedTx({
    escrow: createSimnetFixtureEscrow(),
    kind: 'refund',
    feeGrains: '2000',
  });
  const parsed = Transaction.fromHex(tx.unsignedTxHex);

  assert.equal(tx.kind, 'refund');
  assert.equal(tx.outputAmountGrains, '49999998000');
  assert.equal(tx.lockTime, 144);
  assert.equal(parsed.locktime, 144);
  assert.equal(parsed.ins[0].sequence, Transaction.DEFAULT_SEQUENCE - 1);
  assert.equal(parsed.outs[0].value, 49999998000);
});

function createSimnetFixtureEscrow() {
  return createPearlEscrowPackage({
    tradeId: 'simnet-fixture-1',
    network: 'simnet',
    internalPubkey: INTERNAL_PUBKEY,
    expectedAmountGrains: '50000000000',
    requiredConfirmations: 6,
    releaseAddress: BUYER_RELEASE_ADDRESS,
    refundAddress: SELLER_REFUND_ADDRESS,
    fundingOutpoint: FUNDING_OUTPOINT,
    refundEligibleAfterHeight: 144,
    createdAt: '2026-05-17T16:00:00.000Z',
  });
}
