import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createPearlEscrowPackage,
  JsonFilePearlSignerRequestRepository,
  JsonlPearlSignerAuditRepository,
  matchPearlEscrowFundingOutput,
  PearlSignerBoundary,
  type PearlEscrowPackage,
  type PearlEscrowSignerRequest,
  type PearlEscrowSignerResponse,
} from '@kaspacom/pearl-escrow';
import type { OtcTrade } from '@kaspacom/pearl-sdk';
import type { PearlTransactionBroadcaster } from '@kaspacom/pearl-rpc';

import {
  InMemorySettlementBroadcasterAdapter,
  InMemorySettlementWorkerTradeSource,
  JsonFilePearlEscrowBroadcastAttemptRepository,
  JsonFileSettlementDecisionRepository,
  PearlEscrowSettlementSignerAdapter,
  runSettlementWorkerIteration,
  StaticSettlementPearlProofSource,
  submitPearlEscrowBroadcastAttempt,
  type BaseEscrowEventState,
} from '../dist/index.js';

const NOW = new Date('2026-05-18T14:00:00.000Z');
const INTERNAL_PUBKEY = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const BUYER_RELEASE_ADDRESS = 'rprl1pgxxyvcmdncdxs06cudd5yvmwwahaesaj6n3eu7st7x4sw9hrchaqmpuxye';
const SELLER_REFUND_ADDRESS = 'rprl1pmfyaqrefev5e5qjvaaazcc08rcrqll9lcq8s2kdwd55psu6a244sa3tedd';
const FUNDING_TXID = '11'.repeat(32);
const FUNDING_OUTPOINT = `${FUNDING_TXID}:1`;
const EXPECTED_ESCROW_SCRIPT = '5120da4710964f7852695de2da025290e24af6d8c281de5a0b902b7135fd9fd74d21';
const BASE_TRADE_KEY = '0x' + '55'.repeat(32);

test('settlement worker persists release decision, signer request, audit, and PRL broadcast attempt', async () => {
  const store = await createStores();
  const signerClient = new FakeSignerClient();
  const dependencies = workerDependencies({
    trade: createTrade({ state: 'usdc_escrow_confirmed' }),
    base: baseState({ status: 'deposited' }),
    stores: store,
    signerClient,
  });

  const first = await runSettlementWorkerIteration(dependencies, NOW);
  const duplicate = await runSettlementWorkerIteration(
    workerDependencies({
      trade: createTrade({ state: 'usdc_escrow_confirmed' }),
      base: baseState({ status: 'deposited' }),
      stores: store,
      signerClient: new FakeSignerClient(),
    }),
    NOW,
  );

  const decisionRows = await jsonRows(store.decisionsPath);
  const signerRequests = await jsonRows(store.signerRequestsPath);
  const broadcastAttempts = await jsonRows(store.broadcastAttemptsPath);
  const auditRows = await jsonlRows(store.signerAuditPath);

  assert.equal(first.decisions[0]?.action, 'prepare_prl_release');
  assert.equal(first.preparedActions[0]?.metadata?.adapter, 'pearl_signer_boundary');
  assert.equal(first.preparedActions[0]?.metadata?.signerRequestCreated, true);
  assert.equal(first.preparedActions[0]?.metadata?.broadcastAttemptCreated, true);
  assert.equal(first.preparedActions[0]?.metadata?.signedTxid, '33'.repeat(32));
  assert.equal(dependencies.trades.transitions[0]?.state, 'release_pending');
  assert.equal(signerClient.requests.length, 1);
  assert.equal(duplicate.preparedActions.length, 0);
  assert.equal(decisionRows.length, 1);
  assert.equal(signerRequests.length, 1);
  assert.equal(signerRequests[0].status, 'signed');
  assert.equal(broadcastAttempts.length, 1);
  assert.equal(broadcastAttempts[0].status, 'signed');
  assert.equal(auditRows.map((row) => row.status).join(','), 'requested,signed');
});

test('settlement worker persists refund request through the same signer boundary', async () => {
  const store = await createStores();
  const signerClient = new FakeSignerClient();
  const dependencies = workerDependencies({
    trade: createTrade({ state: 'pearl_escrow_confirmed' }),
    base: baseState({ status: 'created' }),
    stores: store,
    signerClient,
  });

  const result = await runSettlementWorkerIteration(dependencies, NOW);
  const signerRequests = await jsonRows(store.signerRequestsPath);
  const broadcastAttempts = await jsonRows(store.broadcastAttemptsPath);

  assert.equal(result.decisions[0]?.action, 'prepare_prl_refund');
  assert.equal(result.preparedActions[0]?.metadata?.adapter, 'pearl_signer_boundary');
  assert.equal(dependencies.trades.transitions[0]?.state, 'refund_pending');
  assert.equal(signerClient.requests[0]?.action, 'refund');
  assert.equal(signerRequests[0].request.action, 'refund');
  assert.equal(broadcastAttempts[0].action, 'refund');
});

test('PRL broadcast wrapper durably records submitted and failed attempts', async () => {
  const store = await createStores();
  const signerClient = new FakeSignerClient();
  await runSettlementWorkerIteration(
    workerDependencies({
      trade: createTrade({ state: 'usdc_escrow_confirmed' }),
      base: baseState({ status: 'deposited' }),
      stores: store,
      signerClient,
    }),
    NOW,
  );

  const repository = new JsonFilePearlEscrowBroadcastAttemptRepository(store.broadcastAttemptsPath);
  const attempt = (await repository.listBroadcastAttempts())[0];
  assert.ok(attempt);

  const submitted = await submitPearlEscrowBroadcastAttempt({
    repository,
    broadcaster: new FakeBroadcaster('44'.repeat(32)),
    attempt,
    now: new Date('2026-05-18T14:01:00.000Z'),
  });
  assert.equal(submitted.status, 'submitted');
  assert.equal(submitted.broadcastTxid, '44'.repeat(32));

  await assert.rejects(
    submitPearlEscrowBroadcastAttempt({
      repository,
      broadcaster: new FailingBroadcaster('pearld rejected transaction'),
      attempt: {
        ...attempt,
        attempt: 2,
        idempotencyKey: `${attempt.idempotencyKey}:retry`,
      },
      now: new Date('2026-05-18T14:02:00.000Z'),
      nextRetryAt: '2026-05-18T14:07:00.000Z',
    }),
    /pearld rejected transaction/,
  );

  const attempts = await repository.listBroadcastAttempts();
  assert.equal(attempts.find((row) => row.attempt === 1)?.status, 'submitted');
  assert.equal(attempts.find((row) => row.attempt === 2)?.status, 'failed');
  assert.equal(attempts.find((row) => row.attempt === 2)?.nextRetryAt, '2026-05-18T14:07:00.000Z');
});

function workerDependencies(input: {
  trade: OtcTrade;
  base: BaseEscrowEventState;
  stores: Awaited<ReturnType<typeof createStores>>;
  signerClient: FakeSignerClient;
}) {
  const signerBoundary = new PearlSignerBoundary({
    policy: {
      policyVersion: 'pearl-otc-signer-v1',
      releaseFeeCapGrains: '5000',
      refundFeeCapGrains: '5000',
      signerKeyId: 'otc-pearl-simnet-1',
      allowedSignerKeyIds: ['otc-pearl-simnet-1'],
      derivationPath: 'm/0/7',
    },
    requestRepository: new JsonFilePearlSignerRequestRepository(input.stores.signerRequestsPath),
    auditRepository: new JsonlPearlSignerAuditRepository(input.stores.signerAuditPath),
    signerClient: input.signerClient,
  });
  const trades = new InMemorySettlementWorkerTradeSource([input.trade]);
  return {
    trades,
    pearl: new StaticSettlementPearlProofSource(
      new Map([
        [
          input.trade.tradeId,
          {
            status: 'confirmed' as const,
            sourceEventId: `pearl:funding:${FUNDING_OUTPOINT}`,
            txid: FUNDING_TXID,
            outpoint: FUNDING_OUTPOINT,
            confirmations: 6,
            observedAt: '2026-05-18T13:00:00.000Z',
          },
        ],
      ]),
    ),
    base: {
      async getBaseEscrowState() {
        return input.base;
      },
    },
    decisions: new JsonFileSettlementDecisionRepository(input.stores.decisionsPath),
    signer: new PearlEscrowSettlementSignerAdapter({
      signerBoundary,
      broadcastAttempts: new JsonFilePearlEscrowBroadcastAttemptRepository(input.stores.broadcastAttemptsPath),
      releaseFeeGrains: '1000',
      refundFeeGrains: '2000',
      now: () => NOW,
    }),
    broadcaster: new InMemorySettlementBroadcasterAdapter(),
  };
}

async function createStores() {
  const dir = await mkdtemp(join(tmpdir(), 'settlement-worker-prl-'));
  return {
    decisionsPath: join(dir, 'decisions.json'),
    signerRequestsPath: join(dir, 'signer-requests.json'),
    signerAuditPath: join(dir, 'signer-audit.jsonl'),
    broadcastAttemptsPath: join(dir, 'broadcast-attempts.json'),
  };
}

function createTrade(overrides: Partial<Pick<OtcTrade, 'state'>> = {}): OtcTrade {
  const escrow = createSimnetEscrow();
  const fundingMatch = matchPearlEscrowFundingOutput(escrow, {
    txid: FUNDING_TXID,
    vout: 1,
    amountGrains: '50000000000',
    scriptPubKeyHex: EXPECTED_ESCROW_SCRIPT,
    blockHeight: 25,
    confirmations: 6,
  });
  assert.equal(fundingMatch.status, 'matched');

  return {
    tradeId: 'trade-prl-infra-1',
    quoteId: 'quote-prl-infra-1',
    state: overrides.state ?? 'usdc_escrow_confirmed',
    side: 'buy_prl',
    amountPrl: '500.00000000',
    amountUsdc: '85.000000',
    feePrl: '0.00000000',
    feeUsdc: '0.000000',
    buyerPearlAddress: BUYER_RELEASE_ADDRESS,
    buyerUsdcAddress: '0x1111111111111111111111111111111111111111',
    sellerPearlRefundAddress: SELLER_REFUND_ADDRESS,
    sellerUsdcReceiveAddress: '0x2222222222222222222222222222222222222222',
    pearlEscrow: {
      network: escrow.network,
      address: escrow.escrowAddress,
      expectedAmountGrains: escrow.expectedAmountGrains,
      requiredConfirmations: escrow.requiredConfirmations,
      escrowScriptType: escrow.escrowScriptType,
      internalPubkeyHex: escrow.keys.internalPubkeyHex,
      taprootOutputScriptHex: escrow.keys.taprootOutputScriptHex,
      fundingOutpoint: fundingMatch.outpoint,
      refundEligibleAfterHeight: escrow.refundEligibleAfterHeight,
      releaseTemplate: escrow.releaseTemplate,
      refundTemplate: escrow.refundTemplate,
      simnetVerified: escrow.verification.simnetVerified,
    },
    usdcEscrow: {
      network: 'base',
      chainId: 84532,
      contract: '0x3333333333333333333333333333333333333333',
      usdcToken: '0x4444444444444444444444444444444444444444',
      tradeKey: BASE_TRADE_KEY,
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
    createdAt: escrow.createdAt,
    updatedAt: '2026-05-18T13:45:00.000Z',
  };
}

function createSimnetEscrow(): PearlEscrowPackage {
  return createPearlEscrowPackage({
    tradeId: 'trade-prl-infra-1',
    network: 'simnet',
    internalPubkey: INTERNAL_PUBKEY,
    expectedAmountGrains: '50000000000',
    requiredConfirmations: 6,
    releaseAddress: BUYER_RELEASE_ADDRESS,
    refundAddress: SELLER_REFUND_ADDRESS,
    fundingOutpoint: FUNDING_OUTPOINT,
    refundEligibleAfterHeight: 144,
    createdAt: '2026-05-18T11:30:00.000Z',
  });
}

function baseState(overrides: Partial<BaseEscrowEventState>): BaseEscrowEventState {
  return {
    status: 'deposited',
    sourceEventId: 'base:deposit:0xabc',
    txHash: '0xabc',
    confirmations: 12,
    observedAt: '2026-05-18T13:30:00.000Z',
    ...overrides,
  };
}

async function jsonRows(filePath: string): Promise<Record<string, any>[]> {
  return JSON.parse(await readFile(filePath, 'utf8')) as Record<string, any>[];
}

async function jsonlRows(filePath: string): Promise<Record<string, any>[]> {
  return (await readFile(filePath, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, any>);
}

class FakeSignerClient {
  readonly requests: PearlEscrowSignerRequest[] = [];

  async sign(request: PearlEscrowSignerRequest): Promise<PearlEscrowSignerResponse> {
    this.requests.push(request);
    return {
      tradeId: request.tradeId,
      action: request.action,
      idempotencyKey: request.idempotencyKey,
      signedTxHex: '020000000001',
      signedTxid: '33'.repeat(32),
      signerKeyId: request.signerKeyId ?? 'otc-pearl-simnet-1',
      signedAt: '2026-05-18T14:00:01.000Z',
    };
  }
}

class FakeBroadcaster implements PearlTransactionBroadcaster {
  private readonly txid: string;

  constructor(txid: string) {
    this.txid = txid;
  }

  async sendRawTransaction(): Promise<string> {
    return this.txid;
  }
}

class FailingBroadcaster implements PearlTransactionBroadcaster {
  private readonly message: string;

  constructor(message: string) {
    this.message = message;
  }

  async sendRawTransaction(): Promise<string> {
    throw new Error(this.message);
  }
}
