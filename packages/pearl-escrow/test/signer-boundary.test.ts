import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createPearlEscrowObservedStateHash,
  createPearlEscrowPackage,
  createPearlEscrowTxTemplateHash,
  createPearlEscrowUnsignedTx,
  InMemoryPearlSignerAuditRepository,
  InMemoryPearlSignerRequestRepository,
  JsonFilePearlSignerRequestRepository,
  JsonlPearlSignerAuditRepository,
  PearlSignerBoundary,
  type PearlEscrowSignerRequest,
  type PearlEscrowSignerResponse,
  type PearlSignerBoundaryPolicy,
} from '../dist/index.js';

const INTERNAL_PUBKEY = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const BUYER_RELEASE_ADDRESS = 'rprl1pgxxyvcmdncdxs06cudd5yvmwwahaesaj6n3eu7st7x4sw9hrchaqmpuxye';
const SELLER_REFUND_ADDRESS = 'rprl1pmfyaqrefev5e5qjvaaazcc08rcrqll9lcq8s2kdwd55psu6a244sa3tedd';
const FUNDING_TXID = '22'.repeat(32);
const SIGNED_TXID = '33'.repeat(32);
const NOW = new Date('2026-05-18T14:00:00.000Z');

test('signs through the Pearl boundary after policy checks and appends audit records', async () => {
  const { boundary, auditRepository, signerCalls } = createBoundary();
  const input = createReleaseInput();

  const result = await boundary.requestSignature(input);

  assert.equal(result.created, true);
  assert.equal(result.signed, true);
  assert.equal(result.record.status, 'signed');
  assert.equal(result.record.attempts, 1);
  assert.equal(result.record.request.txTemplateHash, createPearlEscrowTxTemplateHash(input.unsignedTx));
  assert.equal(result.record.request.signerKeyId, 'otc-pearl-warm-1');
  assert.equal(result.record.response?.signedTxid, SIGNED_TXID);
  assert.equal(signerCalls.count, 1);
  assert.equal('broadcastTxid' in result.record, false);
  assert.deepEqual(auditRepository.records.map((record) => record.status), ['requested', 'signed']);
  assert.equal(auditRepository.records[1]?.signedTxid, SIGNED_TXID);
});

test('returns an existing signed record for duplicate signer requests without signing again', async () => {
  const { boundary, signerCalls } = createBoundary();
  const input = createReleaseInput();

  const first = await boundary.requestSignature(input);
  const duplicate = await boundary.requestSignature({
    ...input,
    now: new Date('2026-05-18T14:05:00.000Z'),
  });

  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.signed, true);
  assert.equal(duplicate.record.requestId, first.record.requestId);
  assert.equal(duplicate.record.attempts, 1);
  assert.equal(signerCalls.count, 1);
});

test('rejects unsafe fee, template, destination, custody, and pause policies', async () => {
  const input = createReleaseInput();

  await assert.rejects(
    () => createBoundary({ policy: { releaseFeeCapGrains: '999' } }).boundary.requestSignature(input),
    /feeGrains exceeds feeCapGrains/,
  );
  await assert.rejects(
    () =>
      createBoundary().boundary.requestSignature({
        ...input,
        expectedTxTemplateHash: `sha256:${'00'.repeat(32)}`,
      }),
    /unsigned transaction template hash mismatch/,
  );
  await assert.rejects(
    () =>
      createBoundary().boundary.requestSignature({
        ...input,
        destinationAddress: SELLER_REFUND_ADDRESS,
      }),
    /release destination does not match signer output policy/,
  );
  await assert.rejects(
    () => createBoundary({ policy: { allowedSignerKeyIds: ['otc-pearl-cold-1'] } }).boundary.requestSignature(input),
    /signerKeyId is not allowed by custody policy/,
  );
  await assert.rejects(
    () => createBoundary({ policy: { paused: true } }).boundary.requestSignature(input),
    /Pearl signer boundary is paused/,
  );
});

test('persists failed signer requests and retries the same idempotency key safely', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pearl-signer-boundary-'));
  const requestPath = join(dir, 'requests.json');
  const auditPath = join(dir, 'audit.jsonl');
  const input = createReleaseInput();
  let calls = 0;

  const failingBoundary = createFileBoundary({
    requestPath,
    auditPath,
    sign: async () => {
      calls += 1;
      throw new Error('signer temporarily unavailable');
    },
  });

  await assert.rejects(() => failingBoundary.requestSignature(input), /signer temporarily unavailable/);

  const persistedFailure = JSON.parse(await readFile(requestPath, 'utf8')) as Array<{ status: string; attempts: number }>;
  assert.equal(persistedFailure[0]?.status, 'failed');
  assert.equal(persistedFailure[0]?.attempts, 1);

  const retryBoundary = createFileBoundary({
    requestPath,
    auditPath,
    sign: async (request) => {
      calls += 1;
      return signedResponse(request);
    },
  });
  const retried = await retryBoundary.requestSignature({
    ...input,
    now: new Date('2026-05-18T14:10:00.000Z'),
  });

  const persistedSuccess = JSON.parse(await readFile(requestPath, 'utf8')) as Array<{ status: string; attempts: number }>;
  const auditLines = (await readFile(auditPath, 'utf8')).trim().split('\n');

  assert.equal(retried.created, false);
  assert.equal(retried.record.status, 'signed');
  assert.equal(retried.record.attempts, 2);
  assert.equal(persistedSuccess[0]?.status, 'signed');
  assert.equal(persistedSuccess[0]?.attempts, 2);
  assert.equal(auditLines.length, 3);
  assert.equal(calls, 2);
});

function createBoundary(overrides: {
  policy?: Partial<PearlSignerBoundaryPolicy>;
} = {}) {
  const requestRepository = new InMemoryPearlSignerRequestRepository();
  const auditRepository = new InMemoryPearlSignerAuditRepository();
  const signerCalls = { count: 0 };
  const boundary = new PearlSignerBoundary({
    policy: {
      ...policyFixture(),
      ...overrides.policy,
    },
    requestRepository,
    auditRepository,
    signerClient: {
      async sign(request) {
        signerCalls.count += 1;
        return signedResponse(request);
      },
    },
  });

  return { boundary, requestRepository, auditRepository, signerCalls };
}

function createFileBoundary(input: {
  requestPath: string;
  auditPath: string;
  sign: (request: PearlEscrowSignerRequest) => Promise<PearlEscrowSignerResponse>;
}) {
  return new PearlSignerBoundary({
    policy: policyFixture(),
    requestRepository: new JsonFilePearlSignerRequestRepository(input.requestPath),
    auditRepository: new JsonlPearlSignerAuditRepository(input.auditPath),
    signerClient: {
      sign: input.sign,
    },
  });
}

function createReleaseInput() {
  const escrow = createPearlEscrowPackage({
    tradeId: 'trade-signer-boundary-1',
    network: 'simnet',
    internalPubkey: INTERNAL_PUBKEY,
    expectedAmountGrains: '50000000000',
    requiredConfirmations: 6,
    releaseAddress: BUYER_RELEASE_ADDRESS,
    refundAddress: SELLER_REFUND_ADDRESS,
    fundingOutpoint: `${FUNDING_TXID}:0`,
    refundEligibleAfterHeight: 144,
    createdAt: '2026-05-18T13:55:00.000Z',
  });
  const unsignedTx = createPearlEscrowUnsignedTx({
    escrow,
    kind: 'release',
    feeGrains: '1000',
  });

  return {
    escrow,
    decisionAction: 'prepare_prl_release' as const,
    decisionEventId: 'decision-release-1',
    unsignedTx,
    destinationAddress: BUYER_RELEASE_ADDRESS,
    observedStateHash: createPearlEscrowObservedStateHash({
      pearl: { outpoint: `${FUNDING_TXID}:0`, confirmations: 6 },
      base: { status: 'deposited' },
    }),
    expectedTxTemplateHash: createPearlEscrowTxTemplateHash(unsignedTx),
    now: NOW,
  };
}

function signedResponse(request: PearlEscrowSignerRequest): PearlEscrowSignerResponse {
  return {
    tradeId: request.tradeId,
    action: request.action,
    idempotencyKey: request.idempotencyKey,
    signedTxHex: '020000000001',
    signedTxid: SIGNED_TXID,
    signerKeyId: request.signerKeyId ?? 'otc-pearl-warm-1',
    signedAt: '2026-05-18T14:01:00.000Z',
  };
}

function policyFixture(): PearlSignerBoundaryPolicy {
  return {
    policyVersion: 'pearl-otc-signer-v1',
    releaseFeeCapGrains: '5000',
    refundFeeCapGrains: '7000',
    signerKeyId: 'otc-pearl-warm-1',
    allowedSignerKeyIds: ['otc-pearl-warm-1'],
    derivationPath: 'm/0/7',
  };
}
