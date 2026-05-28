import assert from 'node:assert/strict';
import test from 'node:test';

import { getPearlScriptNetwork } from '@kaspacom/pearl-script';
import { validatePearlAddress, type OtcTrade, type TradeState } from '@kaspacom/pearl-sdk';
import {
  InMemoryUsdcEscrowEventRepository,
  type UsdcEscrowTradeEvent,
  type UsdcEscrowTradeEventState,
} from '@kaspacom/usdc-escrow-client';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';

import { createConfiguredPearlEscrowAllocator } from '../src/pearl-escrow-allocator.ts';
import { projectPearlIndexedProof, type PearlIndexedProof, type PearlProofReader } from '../src/pearl-proof-reader.ts';
import { InMemoryOtcRepository, type OtcRepository } from '../src/repository.ts';
import { OtcTradeService, type PearlEscrowWatchRegistrar } from '../src/trade-service.ts';
import type { OtcApiConfig, UsdcEscrowOnChainTrade } from '../src/types.ts';
import type { UsdcEscrowReader } from '../src/usdc-escrow-reader.ts';

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

const bip32 = BIP32Factory(ecc);
const NOW = new Date('2026-05-19T10:00:00.000Z');
const BUYER_PRL_ADDRESS = 'rprl1pxqu6hcrs6xzg2n60pjf2yruzr637p73zaettvsyzzzu27zvzhvxqt4xql0';
const SELLER_REFUND_ADDRESS = 'rprl1pxsnlfuungl0kztjj2rmknxjxanhg5jvweuplxzxnuye6p3dj9g5sw0pp8q';
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
  pearlEscrowXpub: bip32
    .fromSeed(Buffer.alloc(32, 19), getPearlScriptNetwork('simnet'))
    .neutered()
    .toBase58(),
  pearlEscrowDerivationPrefix: '0',
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

class RecordingWatchRegistrar implements PearlEscrowWatchRegistrar {
  readonly registrations: {
    watchId: string;
    address: string;
    expectedAmountGrains: string;
  }[] = [];

  async registerPearlEscrowWatch(trade: OtcTrade) {
    const watchId = `otc:${trade.tradeId}:pearl-escrow`;
    this.registrations.push({
      watchId,
      address: trade.pearlEscrow.address,
      expectedAmountGrains: trade.pearlEscrow.expectedAmountGrains,
    });
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

interface MutablePearlWatchHistory {
  observations: MutablePearlObservation[];
  spends: MutablePearlSpend[];
}

interface MutablePearlObservation {
  outpoint: string;
  blockHash: string;
  height: number;
  amountGrains: string;
  confirmations: number;
  matchStatus: 'confirmed' | 'spent';
  observedAt: string;
}

interface MutablePearlSpend {
  spendTxid: string;
  spentOutpoint: string;
  blockHash: string;
  height: number;
  classification: 'release' | 'refund';
  observedAt: string;
}

class MutableIndexerBackedPearlProofs implements PearlProofReader, SettlementPearlProofSource {
  private readonly histories = new Map<string, MutablePearlWatchHistory>();

  setConfirmedFunding(trade: OtcTrade): void {
    this.histories.set(trade.tradeId, {
      observations: [createFundingObservation(trade, 'confirmed')],
      spends: [],
    });
  }

  setReleaseSpend(trade: OtcTrade): void {
    this.histories.set(trade.tradeId, {
      observations: [createFundingObservation(trade, 'spent')],
      spends: [createSpend('release')],
    });
  }

  setRefundSpend(trade: OtcTrade): void {
    this.histories.set(trade.tradeId, {
      observations: [createFundingObservation(trade, 'spent')],
      spends: [createSpend('refund')],
    });
  }

  async getPearlProofState(trade: OtcTrade): Promise<PearlProofState> {
    const history = this.histories.get(trade.tradeId);
    if (!history) {
      return {
        status: 'missing',
        sourceEventId: `pearl:missing:${trade.tradeId}`,
        confirmations: 0,
        observedAt: new Date(0).toISOString(),
      };
    }
    const releaseSpend = history.spends.find((spend) => spend.classification === 'release');
    if (releaseSpend) {
      return {
        status: 'released',
        sourceEventId: `pearl-spend:${releaseSpend.spendTxid}:${releaseSpend.spentOutpoint}`,
        txid: releaseSpend.spendTxid,
        outpoint: releaseSpend.spentOutpoint,
        confirmations: 2,
        observedAt: releaseSpend.observedAt,
      };
    }
    const refundSpend = history.spends.find((spend) => spend.classification === 'refund');
    if (refundSpend) {
      return {
        status: 'refunded',
        sourceEventId: `pearl-spend:${refundSpend.spendTxid}:${refundSpend.spentOutpoint}`,
        txid: refundSpend.spendTxid,
        outpoint: refundSpend.spentOutpoint,
        confirmations: 2,
        observedAt: refundSpend.observedAt,
      };
    }
    const funding = history.observations.find((observation) => observation.matchStatus === 'confirmed' || observation.matchStatus === 'spent');
    if (!funding) {
      return {
        status: 'missing',
        sourceEventId: `pearl:missing:${trade.tradeId}`,
        confirmations: 0,
        observedAt: new Date(0).toISOString(),
      };
    }
    return {
      status: 'confirmed',
      sourceEventId: `pearl-observation:${funding.outpoint}:${funding.matchStatus}`,
      txid: FUNDING_TXID,
      outpoint: funding.outpoint,
      confirmations: funding.confirmations,
      observedAt: funding.observedAt,
    };
  }

  async getPearlIndexedProof(trade: OtcTrade): Promise<PearlIndexedProof> {
    return projectPearlIndexedProof(trade, this.histories.get(trade.tradeId) ?? { observations: [], spends: [] });
  }
}

class BaseEventBackedUsdcReader implements UsdcEscrowReader {
  private readonly events: InMemoryUsdcEscrowEventRepository;

  constructor(events: InMemoryUsdcEscrowEventRepository) {
    this.events = events;
  }

  async getTrade(tradeKey: string): Promise<UsdcEscrowOnChainTrade> {
    const state = await this.events.getTradeState(tradeKey);
    if (!state) {
      return {
        buyer: '0x0000000000000000000000000000000000000000',
        seller: '0x0000000000000000000000000000000000000000',
        amountMicros: '0',
        feeMicros: '0',
        expiryUnixSeconds: 0,
        status: 'none',
      };
    }
    return {
      buyer: state.buyer ?? '0x0000000000000000000000000000000000000000',
      seller: state.seller ?? '0x0000000000000000000000000000000000000000',
      amountMicros: state.amountMicros ?? '0',
      feeMicros: state.feeMicros ?? '0',
      expiryUnixSeconds: state.expiryUnixSeconds ?? 0,
      status: state.status,
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
    return baseEscrowEventStateFromUsdcTradeState(await this.events.getTradeState(trade.usdcEscrow.tradeKey), trade);
  }
}

test('allocates valid unique simnet P2TR escrow addresses per accepted trade', async () => {
  const { service, registrar } = createFlow('unique-addresses');
  const first = await createAcceptedTrade(service, 'unique-addresses-1');
  const second = await createAcceptedTrade(service, 'unique-addresses-2');

  assert.notEqual(first.tradeId, second.tradeId);
  assert.notEqual(first.pearlEscrow.address, second.pearlEscrow.address);
  assert.equal(validatePearlAddress(first.pearlEscrow.address).valid, true);
  assert.equal(validatePearlAddress(first.pearlEscrow.address).network, 'simnet');
  assert.equal(validatePearlAddress(second.pearlEscrow.address).valid, true);
  assert.equal(validatePearlAddress(second.pearlEscrow.address).network, 'simnet');
  assert.deepEqual(
    registrar.registrations.map((registration) => registration.address),
    [first.pearlEscrow.address, second.pearlEscrow.address],
  );
});

test('full happy path covers quote, accept, wallet-funded PRL proof, Base deposit, worker release, and public proof', async () => {
  const flow = createFlow('release');
  const { service, repository, registrar, pearl, baseEvents } = flow;

  const trade = await createAcceptedTrade(service, 'release');
  assert.equal(registrar.registrations.length, 1);
  assert.equal(validatePearlAddress(trade.pearlEscrow.address).valid, true);
  assert.equal(registrar.registrations[0]?.address, trade.pearlEscrow.address);

  const createIntent = await service.prepareUsdcCreateTrade(trade.tradeId, {
    idempotencyKey: 'create-base-trade-release',
    actor: 'settlement-worker',
  });
  pearl.setConfirmedFunding(trade);
  await service.transitionTrade(trade.tradeId, 'pearl_escrow_seen', `pearl-seen:${FUNDING_OUTPOINT}`);
  await service.transitionTrade(trade.tradeId, 'pearl_escrow_confirmed', `pearl-confirmed:${FUNDING_OUTPOINT}`);
  await service.transitionTrade(trade.tradeId, 'usdc_escrow_pending', 'base:create:0xcreate');

  await baseEvents.ingestEvents([createBaseTradeCreatedEvent(createIntent)]);
  const verification = await service.verifyUsdcEscrowTerms(trade.tradeId);
  assert.equal(verification.verified, true);
  assert.equal(verification.depositAllowed, true);
  assert.deepEqual(verification.mismatches, []);
  await baseEvents.ingestEvents([
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

  pearl.setReleaseSpend(trade);
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

  pearl.setConfirmedFunding(trade);
  await service.transitionTrade(trade.tradeId, 'pearl_escrow_seen', `pearl-seen-refund:${FUNDING_OUTPOINT}`);
  await service.transitionTrade(trade.tradeId, 'pearl_escrow_confirmed', `pearl-confirmed-refund:${FUNDING_OUTPOINT}`);
  await service.transitionTrade(trade.tradeId, 'usdc_escrow_pending', 'base:create-refund:0xcreate');
  await baseEvents.ingestEvents([
    createBaseTradeCreatedEvent(createIntent, {
      txHash: '0xcreate-refund',
      blockNumber: 200,
      blockHash: '0xblockcreaterefund',
    }),
  ]);
  const verification = await service.verifyUsdcEscrowTerms(trade.tradeId);
  assert.equal(verification.verified, true);
  assert.equal(verification.depositAllowed, true);
  await projectBaseStateToTrade(repository, trade.tradeId, await baseEvents.getTradeState(createIntent.tradeKey));

  const signer = new InMemorySettlementSignerAdapter();
  const first = await runSettlementWorkerIteration(
    createWorker(flow, signer, new InMemorySettlementBroadcasterAdapter()),
    new Date('2026-05-19T10:20:00.000Z'),
  );
  assert.equal(first.decisions[0]?.action, 'prepare_prl_refund');
  assert.equal(first.preparedActions[0]?.metadata?.adapter, 'signer');

  pearl.setRefundSpend(trade);
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
  pearl: MutableIndexerBackedPearlProofs;
  baseEvents: InMemoryUsdcEscrowEventRepository;
  decisions: InMemorySettlementDecisionRepository;
} {
  const repository = new InMemoryOtcRepository();
  const registrar = new RecordingWatchRegistrar();
  const pearl = new MutableIndexerBackedPearlProofs();
  const baseEvents = new InMemoryUsdcEscrowEventRepository();
  const decisions = new InMemorySettlementDecisionRepository();
  const flowConfig = { ...config, pearlEscrowDerivationPrefix: '0' };
  const service = new OtcTradeService(
    repository,
    flowConfig,
    createConfiguredPearlEscrowAllocator(flowConfig, repository),
    new BaseEventBackedUsdcReader(baseEvents),
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

function createBaseTradeCreatedEvent(
  intent: {
    tradeKey: string;
    buyer: string;
    seller: string;
    amountMicros: string;
    feeMicros: string;
    expiryUnixSeconds: number;
  },
  overrides: Partial<UsdcEscrowTradeEvent> = {},
): UsdcEscrowTradeEvent {
  return {
    network: 'base_sepolia',
    chainId: 84532,
    contractAddress: BASE_CONTRACT,
    tradeKey: intent.tradeKey,
    eventName: 'TradeCreated',
    txHash: '0xcreate',
    logIndex: 0,
    blockNumber: 100,
    blockHash: '0xblockcreate',
    confirmations: 12,
    observedAt: '2026-05-19T10:04:00.000Z',
    buyer: intent.buyer,
    seller: intent.seller,
    amountMicros: intent.amountMicros,
    feeMicros: intent.feeMicros,
    expiryUnixSeconds: intent.expiryUnixSeconds,
    ...overrides,
  } as UsdcEscrowTradeEvent;
}

function createFundingObservation(trade: OtcTrade, matchStatus: MutablePearlObservation['matchStatus']): MutablePearlObservation {
  return {
    outpoint: FUNDING_OUTPOINT,
    blockHash: '08ab482659c15c3a06414a0050e21be0927e40aad6725ea52b91bd87bf1c4a80',
    height: 186,
    amountGrains: trade.pearlEscrow.expectedAmountGrains,
    confirmations: 3,
    matchStatus,
    observedAt: '2026-05-19T10:03:00.000Z',
  };
}

function createSpend(classification: MutablePearlSpend['classification']): MutablePearlSpend {
  const release = classification === 'release';
  return {
    spendTxid: release ? RELEASE_TXID : REFUND_TXID,
    spentOutpoint: FUNDING_OUTPOINT,
    blockHash: release
      ? '853f5db63398cef269ecac553d4c768e09e0941384a8e3bb7e524a23c56f979f'
      : 'refundblockhash',
    height: release ? 188 : 189,
    classification,
    observedAt: release ? '2026-05-19T10:08:00.000Z' : '2026-05-19T10:22:00.000Z',
  };
}
