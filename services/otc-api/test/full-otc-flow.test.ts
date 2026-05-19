import assert from 'node:assert/strict';
import test from 'node:test';

import { InMemoryUsdcEscrowEventRepository, type UsdcEscrowTradeEventState } from '@kaspacom/usdc-escrow-client';
import { parsePrlToGrains, type OtcTrade, type TradeEvent, type TradeState } from '@kaspacom/pearl-sdk';

import type { PearlIndexedProof, PearlProofReader } from '../src/pearl-proof-reader.ts';
import { InMemoryOtcRepository, type OtcRepository } from '../src/repository.ts';
import { OtcTradeService, type PearlEscrowAllocator, type PearlEscrowWatchRegistrar } from '../src/trade-service.ts';
import type { OtcApiConfig } from '../src/types.ts';

import {
  baseEscrowEventStateFromUsdcTradeState,
  InMemorySettlementBroadcasterAdapter,
  InMemorySettlementDecisionRepository,
  InMemorySettlementSignerAdapter,
  runSettlementWorkerIteration,
  type PearlProofState,
  type SettlementBaseEscrowSource,
  type SettlementDecisionRecord,
  type SettlementPearlProofSource,
  type SettlementWorkerTradeSource,
} from '../../settlement-worker/dist/index.js';

const NOW = new Date('2026-05-19T10:00:00.000Z');
const BUYER_PRL_ADDRESS = 'rprl1pxqu6hcrs6xzg2n60pjf2yruzr637p73zaettvsyzzzu27zvzhvxqt4xql0';
const SELLER_REFUND_ADDRESS = 'rprl1pxsnlfuungl0kztjj2rmknxjxanhg5jvweuplxzxnuye6p3dj9g5sw0pp8q';
const ESCROW_ADDRESS = 'rprl1p6j5eqtndefwp2vhp7fpz5cd5eypv9q8jzkk2z2qxwd78h877u5kqm80pw9';
const FUNDING_TXID = '70fa6854784b7d58e90679416c65b251fd9aa63ba7857431779e6137d42e8436';
const FUNDING_OUTPOINT = `${FUNDING_TXID}:1`;
const RELEASE_TXID = 'bfa470eef67c237364650c8bc8a55f8be97574d980ece0758d0f60b967548cf8';
const REFUND_TXID = '2f1e17b5400a2ed7f4dddc1bc3d59c1450e83b482a5b48955da84f9e65a0023b';
const BASE_CONTRACT = '0x1111111111111111111111111111111111111111';
const BUYER_USDC = '0x3333333333333333333333333333333333333333';
const SELLER_USDC = '0x4444444444444444444444444444444444444444';

const config: OtcApiConfig = {
  pearlNetwork: 'simnet',
  pearlEscrowAllocator: 'p2tr_xpub',
  pearlEscrowDerivationPrefix: 'simnet-e2e',
  allowMainnetPearlEscrow: false,
  quoteTtlMs: 5 * 60 * 1000,
  pearlFundingTtlMs: 10 * 60 * 1000,
  usdcDepositTtlMs: 15 * 60 * 1000,
  settlementTtlMs: 30 * 60 * 1000,
  priceUsdcPerPrl: '0.170000',
  feeBps: 100,
  pearlEscrowConfirmations: 1,
  baseEscrowContract: BASE_CONTRACT,
  baseNetwork: 'base_sepolia',
  supportAlertRateLimitWindowMs: 10 * 60 * 1000,
  supportAlertRateLimitMax: 5,
};

class StaticSimnetEscrowAllocator implements PearlEscrowAllocator {
  async allocateEscrow(input: Parameters<PearlEscrowAllocator['allocateEscrow']>[0]): Promise<OtcTrade['pearlEscrow']> {
    return {
      network: 'simnet',
      address: `${ESCROW_ADDRESS}${input.tradeId.slice(-4)}`,
      expectedAmountGrains: parsePrlToGrains(input.quote.amountPrl).toString(),
      requiredConfirmations: input.config.pearlEscrowConfirmations,
      fundingOutpoint: FUNDING_OUTPOINT,
    };
  }
}

class RecordingWatchRegistrar implements PearlEscrowWatchRegistrar {
  readonly registrations: string[] = [];

  async registerPearlEscrowWatch(trade: OtcTrade) {
    const watchId = `otc:${trade.tradeId}:pearl-escrow`;
    this.registrations.push(watchId);
    return {
      watchId,
      address: trade.pearlEscrow.address,
      network: trade.pearlEscrow.network,
      requiredConfirmations: trade.pearlEscrow.requiredConfirmations,
      metadata: {
        trade_id: trade.tradeId,
        expected_amount_grains: trade.pearlEscrow.expectedAmountGrains,
      },
    };
  }
}

type MutablePearlProof = PearlProofState & {
  releaseTxid?: string;
  refundTxid?: string;
};

class MutablePearlProofs implements PearlProofReader, SettlementPearlProofSource {
  private readonly states = new Map<string, MutablePearlProof>();

  set(tradeId: string, state: MutablePearlProof): void {
    this.states.set(tradeId, state);
  }

  async getPearlProofState(trade: OtcTrade): Promise<PearlProofState> {
    return this.states.get(trade.tradeId) ?? {
      status: 'missing',
      sourceEventId: `pearl:missing:${trade.tradeId}`,
      confirmations: 0,
      observedAt: new Date(0).toISOString(),
    };
  }

  async getPearlIndexedProof(trade: OtcTrade): Promise<PearlIndexedProof> {
    const state = this.states.get(trade.tradeId);
    if (!state || state.status === 'missing') {
      return { escrowConfirmations: 0, events: [] };
    }

    return {
      ...(state.outpoint ? { escrowOutpoint: state.outpoint } : {}),
      escrowConfirmations: state.confirmations,
      ...(state.releaseTxid ? { releaseTxid: state.releaseTxid } : {}),
      ...(state.refundTxid ? { refundTxid: state.refundTxid } : {}),
      events: createPearlProofEvents(trade, state),
    };
  }
}

class RepositorySettlementTradeSource implements SettlementWorkerTradeSource {
  private readonly repository: OtcRepository;

  constructor(repository: OtcRepository) {
    this.repository = repository;
  }

  async listOpenTrades(): Promise<readonly OtcTrade[]> {
    return this.repository.listTrades();
  }

  async applyTradeState(tradeId: string, state: TradeState, decision: SettlementDecisionRecord): Promise<void> {
    const trade = await this.requireTrade(tradeId);
    await this.repository.updateTrade({ ...trade, state, updatedAt: decision.createdAt });
    await this.repository.appendEvent({
      tradeId,
      fromState: trade.state,
      toState: state,
      source: 'settlement_worker',
      sourceEventId: decision.decisionId,
      observedAt: decision.createdAt,
      metadata: { reason: decision.reason },
    });
  }

  async flagManualReview(tradeId: string, reason: string, decision: SettlementDecisionRecord): Promise<void> {
    const trade = await this.requireTrade(tradeId);
    await this.repository.updateTrade({ ...trade, state: 'failed_manual_review', updatedAt: decision.createdAt });
    await this.repository.appendEvent({
      tradeId,
      fromState: trade.state,
      toState: 'failed_manual_review',
      source: 'settlement_worker',
      sourceEventId: decision.decisionId,
      observedAt: decision.createdAt,
      metadata: { reason },
    });
  }

  private async requireTrade(tradeId: string): Promise<OtcTrade> {
    const trade = await this.repository.findTradeById(tradeId);
    if (!trade) throw new Error(`trade not found: ${tradeId}`);
    return trade;
  }
}

class UsdcEventStateSource implements SettlementBaseEscrowSource {
  private readonly events: InMemoryUsdcEscrowEventRepository;

  constructor(events: InMemoryUsdcEscrowEventRepository) {
    this.events = events;
  }

  async getBaseEscrowState(trade: OtcTrade) {
    return baseEscrowEventStateFromUsdcTradeState(await this.events.getTradeState(trade.usdcEscrow.tradeKey));
  }
}

test('full happy path covers quote, accept, wallet-funded PRL proof, Base deposit, worker release, and public proof', async () => {
  const flow = createFlow('release');
  const { service, repository, registrar, pearl, baseEvents } = flow;

  const trade = await createAcceptedTrade(service, 'release');
  assert.equal(registrar.registrations.length, 1);
  assert.match(trade.pearlEscrow.address, /^rprl1/);

  const createIntent = await service.prepareUsdcCreateTrade(trade.tradeId, {
    idempotencyKey: 'create-base-trade-release',
    actor: 'settlement-worker',
  });
  pearl.set(trade.tradeId, {
    status: 'confirmed',
    sourceEventId: `pearl-observation:${FUNDING_OUTPOINT}:confirmed`,
    txid: FUNDING_TXID,
    outpoint: FUNDING_OUTPOINT,
    confirmations: 3,
    observedAt: '2026-05-19T10:03:00.000Z',
  });
  await service.transitionTrade(trade.tradeId, 'pearl_escrow_seen', `pearl-seen:${FUNDING_OUTPOINT}`);
  await service.transitionTrade(trade.tradeId, 'pearl_escrow_confirmed', `pearl-confirmed:${FUNDING_OUTPOINT}`);
  await service.transitionTrade(trade.tradeId, 'usdc_escrow_pending', 'base:create:0xcreate');

  await baseEvents.ingestEvents([
    {
      network: 'base_sepolia',
      chainId: 84532,
      contractAddress: BASE_CONTRACT,
      tradeKey: createIntent.tradeKey,
      eventName: 'TradeCreated',
      txHash: '0xcreate',
      logIndex: 0,
      blockNumber: 100,
      blockHash: '0xblockcreate',
      confirmations: 12,
      observedAt: '2026-05-19T10:04:00.000Z',
      buyer: createIntent.buyer,
      seller: createIntent.seller,
      amountMicros: createIntent.amountMicros,
      feeMicros: createIntent.feeMicros,
      expiryUnixSeconds: createIntent.expiryUnixSeconds,
    },
    {
      network: 'base_sepolia',
      chainId: 84532,
      contractAddress: BASE_CONTRACT,
      tradeKey: createIntent.tradeKey,
      eventName: 'Deposited',
      txHash: '0xdeposit',
      logIndex: 1,
      blockNumber: 101,
      blockHash: '0xblockdeposit',
      confirmations: 12,
      observedAt: '2026-05-19T10:05:00.000Z',
      payer: BUYER_USDC,
      amountMicros: trade.usdcEscrow.expectedAmountMicros,
    },
  ]);
  await projectBaseStateToTrade(repository, trade.tradeId, await baseEvents.getTradeState(createIntent.tradeKey));
  await service.transitionTrade(trade.tradeId, 'usdc_escrow_confirmed', 'base:deposit:0xdeposit');

  const signer = new InMemorySettlementSignerAdapter();
  const broadcaster = new InMemorySettlementBroadcasterAdapter();
  const first = await runSettlementWorkerIteration(createWorker(flow, signer, broadcaster), new Date('2026-05-19T10:06:00.000Z'));
  assert.equal(first.decisions[0]?.action, 'prepare_prl_release');
  assert.equal(first.preparedActions[0]?.metadata?.adapter, 'signer');

  pearl.set(trade.tradeId, {
    status: 'released',
    sourceEventId: `pearl-spend:${RELEASE_TXID}:${FUNDING_OUTPOINT}`,
    txid: RELEASE_TXID,
    outpoint: FUNDING_OUTPOINT,
    releaseTxid: RELEASE_TXID,
    confirmations: 2,
    observedAt: '2026-05-19T10:08:00.000Z',
  });
  const second = await runSettlementWorkerIteration(createWorker(flow, signer, broadcaster), new Date('2026-05-19T10:09:00.000Z'));
  assert.equal(second.decisions[0]?.action, 'prepare_usdc_release');
  assert.equal(second.preparedActions[0]?.metadata?.adapter, 'broadcaster');

  await baseEvents.ingestEvents([
    {
      network: 'base_sepolia',
      chainId: 84532,
      contractAddress: BASE_CONTRACT,
      tradeKey: createIntent.tradeKey,
      eventName: 'Released',
      txHash: '0xrelease',
      logIndex: 2,
      blockNumber: 102,
      blockHash: '0xblockrelease',
      confirmations: 12,
      observedAt: '2026-05-19T10:10:00.000Z',
      seller: SELLER_USDC,
      sellerAmountMicros: createIntent.amountMicros,
      feeAmountMicros: createIntent.feeMicros,
    },
  ]);
  await projectBaseStateToTrade(repository, trade.tradeId, await baseEvents.getTradeState(createIntent.tradeKey));
  const third = await runSettlementWorkerIteration(createWorker(flow, signer, broadcaster), new Date('2026-05-19T10:11:00.000Z'));
  assert.equal(third.decisions[0]?.action, 'mark_released');
  assert.equal((await service.getTrade(trade.tradeId)).state, 'released');

  const proof = await service.getPublicProof(trade.tradeId);
  assert.equal(proof.status, 'released');
  assert.equal(proof.pearl.escrowOutpoint, FUNDING_OUTPOINT);
  assert.equal(proof.pearl.releaseTxid, RELEASE_TXID);
  assert.equal(proof.base.depositTxHash, '0xdeposit');
  assert.equal(proof.base.releaseTxHash, '0xrelease');
  assert.equal(proof.events.some((event) => event.source === 'settlement_worker' && event.toState === 'release_pending'), true);
  assert.equal(proof.events.some((event) => event.source === 'pearl_indexer' && event.txHash === RELEASE_TXID), true);
});

test('refund path covers accepted quote, wallet-funded PRL, missing Base deposit, worker refund, and public proof', async () => {
  const flow = createFlow('refund');
  const { service, repository, pearl, baseEvents } = flow;
  const trade = await createAcceptedTrade(service, 'refund');
  const createIntent = await service.prepareUsdcCreateTrade(trade.tradeId, {
    idempotencyKey: 'create-base-trade-refund',
    actor: 'settlement-worker',
  });

  pearl.set(trade.tradeId, {
    status: 'confirmed',
    sourceEventId: `pearl-observation:${FUNDING_OUTPOINT}:confirmed:refund`,
    txid: FUNDING_TXID,
    outpoint: FUNDING_OUTPOINT,
    confirmations: 3,
    observedAt: '2026-05-19T10:03:00.000Z',
  });
  await service.transitionTrade(trade.tradeId, 'pearl_escrow_seen', `pearl-seen-refund:${FUNDING_OUTPOINT}`);
  await service.transitionTrade(trade.tradeId, 'pearl_escrow_confirmed', `pearl-confirmed-refund:${FUNDING_OUTPOINT}`);
  await service.transitionTrade(trade.tradeId, 'usdc_escrow_pending', 'base:create-refund:0xcreate');
  await baseEvents.ingestEvents([
    {
      network: 'base_sepolia',
      chainId: 84532,
      contractAddress: BASE_CONTRACT,
      tradeKey: createIntent.tradeKey,
      eventName: 'TradeCreated',
      txHash: '0xcreate-refund',
      logIndex: 0,
      blockNumber: 200,
      blockHash: '0xblockcreaterefund',
      confirmations: 12,
      observedAt: '2026-05-19T10:04:00.000Z',
      buyer: createIntent.buyer,
      seller: createIntent.seller,
      amountMicros: createIntent.amountMicros,
      feeMicros: createIntent.feeMicros,
      expiryUnixSeconds: createIntent.expiryUnixSeconds,
    },
  ]);
  await projectBaseStateToTrade(repository, trade.tradeId, await baseEvents.getTradeState(createIntent.tradeKey));

  const signer = new InMemorySettlementSignerAdapter();
  const first = await runSettlementWorkerIteration(
    createWorker(flow, signer, new InMemorySettlementBroadcasterAdapter()),
    new Date('2026-05-19T10:20:00.000Z'),
  );
  assert.equal(first.decisions[0]?.action, 'prepare_prl_refund');
  assert.equal(first.preparedActions[0]?.metadata?.adapter, 'signer');

  pearl.set(trade.tradeId, {
    status: 'refunded',
    sourceEventId: `pearl-spend:${REFUND_TXID}:${FUNDING_OUTPOINT}`,
    txid: REFUND_TXID,
    outpoint: FUNDING_OUTPOINT,
    refundTxid: REFUND_TXID,
    confirmations: 2,
    observedAt: '2026-05-19T10:22:00.000Z',
  });
  const second = await runSettlementWorkerIteration(
    createWorker(flow, signer, new InMemorySettlementBroadcasterAdapter()),
    new Date('2026-05-19T10:23:00.000Z'),
  );
  assert.equal(second.decisions[0]?.action, 'mark_refunded');
  assert.equal((await service.getTrade(trade.tradeId)).state, 'refunded');

  const proof = await service.getPublicProof(trade.tradeId);
  assert.equal(proof.status, 'refunded');
  assert.equal(proof.pearl.refundTxid, REFUND_TXID);
  assert.equal(proof.base.depositTxHash, undefined);
  assert.equal(proof.events.some((event) => event.source === 'settlement_worker' && event.toState === 'refund_pending'), true);
});

function createFlow(suffix: string): {
  service: OtcTradeService;
  repository: InMemoryOtcRepository;
  registrar: RecordingWatchRegistrar;
  pearl: MutablePearlProofs;
  baseEvents: InMemoryUsdcEscrowEventRepository;
  decisions: InMemorySettlementDecisionRepository;
} {
  const repository = new InMemoryOtcRepository();
  const registrar = new RecordingWatchRegistrar();
  const pearl = new MutablePearlProofs();
  const baseEvents = new InMemoryUsdcEscrowEventRepository();
  const decisions = new InMemorySettlementDecisionRepository();
  const service = new OtcTradeService(
    repository,
    { ...config, pearlEscrowDerivationPrefix: `simnet-e2e-${suffix}` },
    new StaticSimnetEscrowAllocator(),
    undefined,
    () => NOW,
    registrar,
    pearl,
  );
  return { service, repository, registrar, pearl, baseEvents, decisions };
}

async function createAcceptedTrade(service: OtcTradeService, suffix: string): Promise<OtcTrade> {
  const quote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '1.25000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: BUYER_PRL_ADDRESS,
    usdcRefundAddress: BUYER_USDC,
    clientRequestId: `quote-${suffix}`,
  });

  return service.acceptQuote(quote.quoteId, {
    buyerPearlAddress: BUYER_PRL_ADDRESS,
    buyerUsdcAddress: BUYER_USDC,
    sellerPearlRefundAddress: SELLER_REFUND_ADDRESS,
    sellerUsdcReceiveAddress: SELLER_USDC,
    clientRequestId: `accept-${suffix}`,
  });
}

function createWorker(
  flow: {
    repository: OtcRepository;
    pearl: SettlementPearlProofSource;
    baseEvents: InMemoryUsdcEscrowEventRepository;
    decisions: InMemorySettlementDecisionRepository;
  },
  signer: InMemorySettlementSignerAdapter,
  broadcaster: InMemorySettlementBroadcasterAdapter,
) {
  return {
    trades: new RepositorySettlementTradeSource(flow.repository),
    pearl: flow.pearl,
    base: new UsdcEventStateSource(flow.baseEvents),
    decisions: flow.decisions,
    signer,
    broadcaster,
  };
}

async function projectBaseStateToTrade(
  repository: OtcRepository,
  tradeId: string,
  baseState: UsdcEscrowTradeEventState | undefined,
): Promise<void> {
  if (!baseState) return;
  const trade = await repository.findTradeById(tradeId);
  if (!trade) throw new Error(`trade not found: ${tradeId}`);
  await repository.updateTrade({
    ...trade,
    usdcEscrow: {
      ...trade.usdcEscrow,
      ...(baseState.depositTxHash ? { depositTxHash: baseState.depositTxHash } : {}),
      ...(baseState.releaseTxHash ? { releaseTxHash: baseState.releaseTxHash } : {}),
      ...(baseState.refundTxHash ? { refundTxHash: baseState.refundTxHash } : {}),
    },
    updatedAt: baseState.observedAt,
  });
  await repository.appendEvent({
    tradeId,
    fromState: trade.state,
    toState: trade.state,
    source: 'evm_indexer',
    sourceEventId: baseState.sourceEventId,
    txHash: baseState.txHash,
    confirmations: baseState.confirmations,
    observedAt: baseState.observedAt,
    metadata: {
      status: baseState.status,
      block_number: baseState.blockNumber,
    },
  });
}

function createPearlProofEvents(trade: OtcTrade, state: MutablePearlProof): TradeEvent[] {
  const events: TradeEvent[] = [];
  if (state.outpoint && ['seen', 'confirmed', 'released', 'refunded'].includes(state.status)) {
    events.push({
      tradeId: trade.tradeId,
      fromState: trade.state,
      toState: state.status === 'seen' ? 'pearl_escrow_seen' : 'pearl_escrow_confirmed',
      source: 'pearl_indexer',
      sourceEventId: `pearl-observation:${state.outpoint}:${state.status}`,
      txHash: FUNDING_TXID,
      outpoint: state.outpoint,
      confirmations: state.confirmations,
      observedAt: '2026-05-19T10:03:00.000Z',
      metadata: {
        match_status: state.status === 'released' || state.status === 'refunded' ? 'spent' : state.status,
      },
    });
  }
  if (state.status === 'released' && state.releaseTxid) {
    events.push(createPearlSpendEvent(trade, state, state.releaseTxid, 'release_pending', 'release'));
  }
  if (state.status === 'refunded' && state.refundTxid) {
    events.push(createPearlSpendEvent(trade, state, state.refundTxid, 'refund_pending', 'refund'));
  }
  return events;
}

function createPearlSpendEvent(
  trade: OtcTrade,
  state: MutablePearlProof,
  txHash: string,
  toState: TradeState,
  classification: string,
): TradeEvent {
  return {
    tradeId: trade.tradeId,
    fromState: trade.state,
    toState,
    source: 'pearl_indexer',
    sourceEventId: `pearl-spend:${txHash}:${state.outpoint ?? FUNDING_OUTPOINT}`,
    txHash,
    outpoint: state.outpoint,
    confirmations: state.confirmations,
    observedAt: state.observedAt,
    metadata: { classification },
  };
}
