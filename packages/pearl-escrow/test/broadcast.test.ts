import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPearlEscrowBroadcastAttempt,
  createPearlEscrowObservedStateHash,
  createPearlEscrowPackage,
  createPearlEscrowSignerRequest,
  createPearlEscrowTxTemplateHash,
  createPearlEscrowUnsignedTx,
  markPearlEscrowBroadcastFailed,
  markPearlEscrowBroadcastSubmitted,
} from '../dist/index.js';

const INTERNAL_PUBKEY = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const BUYER_RELEASE_ADDRESS = 'rprl1pgxxyvcmdncdxs06cudd5yvmwwahaesaj6n3eu7st7x4sw9hrchaqmpuxye';
const SELLER_REFUND_ADDRESS = 'rprl1pmfyaqrefev5e5qjvaaazcc08rcrqll9lcq8s2kdwd55psu6a244sa3tedd';
const FUNDING_TXID = '22'.repeat(32);
const SIGNED_TXID = '33'.repeat(32);
const BROADCAST_TXID = '44'.repeat(32);

test('creates deterministic signer request with policy hash and idempotency key', () => {
  const escrow = createFixtureEscrow();
  const unsignedTx = createPearlEscrowUnsignedTx({
    escrow,
    kind: 'release',
    feeGrains: '1000',
  });
  const observedStateHash = createPearlEscrowObservedStateHash({
    base: { status: 'deposited', txHash: '0xabc' },
    pearl: { confirmations: 6, outpoint: `${FUNDING_TXID}:0` },
  });
  const request = createPearlEscrowSignerRequest(
    {
      escrow,
      action: 'release',
      unsignedTx,
      destinationAddress: BUYER_RELEASE_ADDRESS,
      feeGrains: '1000',
      feeCapGrains: '5000',
      policyVersion: 'pearl-otc-signer-v1',
      decisionEventId: 'event-release-1',
      derivationPath: 'm/0/7',
      signerKeyId: 'otc-pearl-warm-1',
      observedStateHash,
    },
    new Date('2026-05-17T17:00:00.000Z'),
  );

  assert.equal(request.tradeId, escrow.tradeId);
  assert.equal(request.action, 'release');
  assert.equal(request.fundingOutpoint, `${FUNDING_TXID}:0`);
  assert.equal(request.txTemplateHash, createPearlEscrowTxTemplateHash(unsignedTx));
  assert.match(request.txTemplateHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    request.idempotencyKey,
    `pearl:${escrow.tradeId}:release:${FUNDING_TXID}:0:${request.txTemplateHash}`,
  );
  assert.deepEqual(request.expected, {
    destinationAddress: BUYER_RELEASE_ADDRESS,
    feeGrains: '1000',
    feeCapGrains: '5000',
    outputAmountGrains: '49999999000',
    observedStateHash,
  });
  assert.equal(request.createdAt, '2026-05-17T17:00:00.000Z');
});

test('rejects signer requests that exceed fee cap or destination policy', () => {
  const escrow = createFixtureEscrow();
  const unsignedTx = createPearlEscrowUnsignedTx({
    escrow,
    kind: 'release',
    feeGrains: '6000',
  });
  const base = {
    escrow,
    action: 'release' as const,
    unsignedTx,
    destinationAddress: BUYER_RELEASE_ADDRESS,
    feeGrains: '6000',
    feeCapGrains: '5000',
    policyVersion: 'pearl-otc-signer-v1',
    decisionEventId: 'event-release-2',
    observedStateHash: createPearlEscrowObservedStateHash({ ok: true }),
  };

  assert.throws(() => createPearlEscrowSignerRequest(base), /feeGrains exceeds feeCapGrains/);
  assert.throws(
    () =>
      createPearlEscrowSignerRequest({
        ...base,
        feeGrains: '1000',
        feeCapGrains: '5000',
      }),
    /unsigned transaction fee does not match signer policy/,
  );
  assert.throws(
    () =>
      createPearlEscrowSignerRequest({
        ...base,
        action: 'refund',
        feeGrains: '6000',
        feeCapGrains: '10000',
      }),
    /unsigned transaction kind does not match signer action/,
  );
  assert.throws(
    () =>
      createPearlEscrowSignerRequest({
        ...base,
        feeGrains: '6000',
        feeCapGrains: '10000',
        destinationAddress: SELLER_REFUND_ADDRESS,
      }),
    /release destination does not match escrow template/,
  );
});

test('tracks signed, submitted, and failed broadcast attempts', () => {
  const signed = createPearlEscrowBroadcastAttempt(
    {
      tradeId: 'trade-broadcast-1',
      action: 'refund',
      idempotencyKey: `pearl:trade-broadcast-1:refund:${FUNDING_TXID}:0:sha256:${'55'.repeat(32)}`,
      signedTxHex: '020000000001',
      signedTxid: SIGNED_TXID.toUpperCase(),
      signerKeyId: 'otc-pearl-warm-1',
      signedAt: '2026-05-17T17:01:00.000Z',
    },
    1,
    new Date('2026-05-17T17:02:00.000Z'),
  );
  const submitted = markPearlEscrowBroadcastSubmitted(
    signed,
    BROADCAST_TXID,
    new Date('2026-05-17T17:03:00.000Z'),
  );
  const failed = markPearlEscrowBroadcastFailed(submitted, 'mempool rejected fee', {
    nextRetryAt: '2026-05-17T17:08:00.000Z',
    now: new Date('2026-05-17T17:04:00.000Z'),
  });

  assert.equal(signed.status, 'signed');
  assert.equal(signed.signedTxid, SIGNED_TXID);
  assert.equal(submitted.status, 'submitted');
  assert.equal(submitted.broadcastTxid, BROADCAST_TXID);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'mempool rejected fee');
  assert.equal(failed.nextRetryAt, '2026-05-17T17:08:00.000Z');
});

function createFixtureEscrow() {
  return createPearlEscrowPackage({
    tradeId: 'trade-broadcast-1',
    network: 'simnet',
    internalPubkey: INTERNAL_PUBKEY,
    expectedAmountGrains: '50000000000',
    requiredConfirmations: 6,
    releaseAddress: BUYER_RELEASE_ADDRESS,
    refundAddress: SELLER_REFUND_ADDRESS,
    fundingOutpoint: `${FUNDING_TXID}:0`,
    refundEligibleAfterHeight: 144,
    createdAt: '2026-05-17T17:00:00.000Z',
  });
}
