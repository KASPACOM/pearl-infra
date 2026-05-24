import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { canTransitionTrade, createPearlSignerProofMessage, type PearlReleaseSigningMode, type PearlSignerProofRole } from '@kaspacom/pearl-sdk';
import { Transaction } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';

import { createConfiguredPearlEscrowAllocator } from '../src/pearl-escrow-allocator.ts';
import type { PearlProofReader } from '../src/pearl-proof-reader.ts';
import { InMemoryOtcRepository } from '../src/repository.ts';
import type { SupportAlertNotification, SupportAlertNotifier } from '../src/support-alert-notifier.ts';
import { OtcTradeService, type PearlEscrowAllocator, type PearlEscrowWatchRegistrar, type PearlSignedTransactionBroadcaster } from '../src/trade-service.ts';
import type { OtcApiConfig } from '../src/types.ts';
import type { UsdcEscrowReader } from '../src/usdc-escrow-reader.ts';

const config: OtcApiConfig = {
  pearlNetwork: 'testnet2',
  pearlEscrowAllocator: 'mock',
  pearlEscrowDerivationPrefix: '0',
  allowMainnetPearlEscrow: false,
  quoteTtlMs: 5 * 60 * 1000,
  pearlFundingTtlMs: 10 * 60 * 1000,
  usdcDepositTtlMs: 15 * 60 * 1000,
  settlementTtlMs: 30 * 60 * 1000,
  priceUsdcPerPrl: '0.170000',
  feeBps: 100,
  pearlEscrowConfirmations: 3,
  baseEscrowContract: '0x1111111111111111111111111111111111111111',
  baseNetwork: 'base_sepolia',
  supportAlertRateLimitWindowMs: 10 * 60 * 1000,
  supportAlertRateLimitMax: 5,
};
const BUYER_TESTNET_ADDRESS = 'tprl1pet7ep3czdu9k4wvdlz2fp5p8x2yp7t6ttyqg2c6cmh0lgeuu9lasga5cef';
const SELLER_TESTNET_REFUND_ADDRESS = 'tprl1pgxxyvcmdncdxs06cudd5yvmwwahaesaj6n3eu7st7x4sw9hrchaqpcq7p3';
const INDEXED_PEARL_FUNDING_OUTPOINT = `${'aa'.repeat(32)}:0`;

const escrowAllocator: PearlEscrowAllocator = {
  async allocateEscrow({ tradeId, config: allocatorConfig }) {
    return {
      network: allocatorConfig.pearlNetwork,
      address: `tprl1p${tradeId.slice(-12)}`,
      expectedAmountGrains: '100000000000',
      requiredConfirmations: allocatorConfig.pearlEscrowConfirmations,
      refundEligibleAfterHeight: 100,
    };
  },
};

class RecordingWatchRegistrar implements PearlEscrowWatchRegistrar {
  readonly trades: string[] = [];

  async registerPearlEscrowWatch(trade: Awaited<ReturnType<OtcTradeService['acceptQuote']>>) {
    this.trades.push(trade.tradeId);
    return {
      watchId: `otc:${trade.tradeId}:pearl-escrow`,
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

class StaticPearlProofReader implements PearlProofReader {
  async getPearlIndexedProof(trade: Awaited<ReturnType<OtcTradeService['acceptQuote']>>) {
    return {
      escrowOutpoint: 'funding_tx:0',
      escrowConfirmations: 7,
      releaseTxid: 'release_tx',
      events: [
        {
          tradeId: trade.tradeId,
          fromState: trade.state,
          toState: 'pearl_escrow_confirmed' as const,
          source: 'pearl_indexer' as const,
          sourceEventId: 'pearl-observation:funding_tx:0:confirmed',
          outpoint: 'funding_tx:0',
          confirmations: 7,
          observedAt: '2026-05-16T12:03:00.000Z',
        },
        {
          tradeId: trade.tradeId,
          fromState: trade.state,
          toState: 'release_pending' as const,
          source: 'pearl_indexer' as const,
          sourceEventId: 'pearl-spend:release_tx:funding_tx:0',
          txHash: 'release_tx',
          outpoint: 'funding_tx:0',
          observedAt: '2026-05-16T12:20:00.000Z',
        },
      ],
    };
  }
}

class EmptyPearlProofReader implements PearlProofReader {
  async getPearlIndexedProof() {
    return {
      escrowConfirmations: 0,
      events: [],
    };
  }
}

class StaticPearlFundingProofReader implements PearlProofReader {
  async getPearlIndexedProof(trade: Awaited<ReturnType<OtcTradeService['acceptQuote']>>) {
    return {
      escrowOutpoint: INDEXED_PEARL_FUNDING_OUTPOINT,
      escrowConfirmations: 7,
      events: [
        {
          tradeId: trade.tradeId,
          fromState: trade.state,
          toState: 'pearl_escrow_confirmed' as const,
          source: 'pearl_indexer' as const,
          sourceEventId: 'pearl-observation:indexed-funding:confirmed',
          outpoint: INDEXED_PEARL_FUNDING_OUTPOINT,
          confirmations: 7,
          observedAt: '2026-05-16T12:03:00.000Z',
        },
      ],
    };
  }
}

class RecordingSupportAlertNotifier implements SupportAlertNotifier {
  readonly notifications: SupportAlertNotification[] = [];
  private readonly fail: boolean;

  constructor(fail = false) {
    this.fail = fail;
  }

  async notifySupportAlert(notification: SupportAlertNotification): Promise<void> {
    if (this.fail) {
      throw new Error('operator alert webhook unavailable');
    }
    this.notifications.push(notification);
  }
}

class RecordingPearlBroadcaster implements PearlSignedTransactionBroadcaster {
  readonly signedTxHexes: string[] = [];

  async sendRawTransaction(signedTxHex: string): Promise<string> {
    this.signedTxHexes.push(signedTxHex);
    return Transaction.fromHex(signedTxHex).getId();
  }
}

function createService(now = new Date('2026-05-16T12:00:00.000Z')): OtcTradeService {
  return new OtcTradeService(new InMemoryOtcRepository(), config, escrowAllocator, () => now);
}

function createServiceWithUsdcReader(reader: UsdcEscrowReader, now = new Date('2026-05-16T12:00:00.000Z')): OtcTradeService {
  return new OtcTradeService(new InMemoryOtcRepository(), config, escrowAllocator, reader, () => now);
}

function createServiceWithSupportAlertNotifier(
  notifier: SupportAlertNotifier,
  now = new Date('2026-05-16T12:00:00.000Z'),
): OtcTradeService {
  return new OtcTradeService(new InMemoryOtcRepository(), config, escrowAllocator, undefined, () => now, undefined, undefined, notifier);
}

function xOnlyPublicKey(seed: string): string {
  const privateKey = Buffer.from(seed.padStart(64, '0'), 'hex');
  const publicKey = ecc.pointFromScalar(privateKey, true);
  if (!publicKey) throw new Error(`invalid private key fixture: ${seed}`);
  return Buffer.from(publicKey).subarray(1).toString('hex');
}

function signSignerProof(input: {
  quoteId: string;
  role: PearlSignerProofRole;
  pearlAddress: string;
  usdcAddress: string;
  pearlPubkey: string;
  releaseSigningMode: PearlReleaseSigningMode;
  privateKeySeed: string;
}): string {
  const privateKey = Buffer.from(input.privateKeySeed.padStart(64, '0'), 'hex');
  const messageHash = createHash('sha256').update(createPearlSignerProofMessage(input)).digest();
  return Buffer.from(ecc.signSchnorr(messageHash, privateKey)).toString('hex');
}

function addDummyWitness(unsignedTxHex: string): string {
  const tx = Transaction.fromHex(unsignedTxHex);
  tx.setWitness(0, [Buffer.from('11'.repeat(64), 'hex')]);
  return tx.toHex();
}

test('creates an idempotent Base USDC quote', async () => {
  const service = createService();
  const request = {
    side: 'buy_prl' as const,
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC' as const,
    settlementNetwork: 'base' as const,
    buyerPearlAddress: 'tprl1pbuyer',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-1',
  };

  const first = await service.createQuote(request);
  const second = await service.createQuote(request);

  assert.equal(first.quoteId, second.quoteId);
  assert.equal(first.amountUsdc, '170.000000');
  assert.equal(first.feeUsdc, '1.700000');
  assert.equal(first.settlementNetwork, 'base');
  assert.equal(first.expiresAt, '2026-05-16T12:05:00.000Z');
});

test('rejects quote idempotency key reuse with a different payload', async () => {
  const service = createService();
  const request = {
    side: 'buy_prl' as const,
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC' as const,
    settlementNetwork: 'base' as const,
    buyerPearlAddress: 'tprl1pbuyer',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-reused-key',
  };

  await service.createQuote(request);

  await assert.rejects(
    () => service.createQuote({ ...request, amountPrl: '2000.00000000' }),
    /quote idempotency key reuse with different payload/,
  );
});

test('rejects invalid quote inputs before persistence', async () => {
  const service = createService();

  await assert.rejects(
    () =>
      service.createQuote({
        side: 'buy_prl',
        amountPrl: '0.00000000',
        settlementAsset: 'USDC',
        settlementNetwork: 'base',
        buyerPearlAddress: 'tprl1pbuyer',
        usdcRefundAddress: '0x2222222222222222222222222222222222222222',
        clientRequestId: 'quote-invalid-zero',
      }),
    /amountPrl must be greater than zero/,
  );

  await assert.rejects(
    () =>
      service.createQuote({
        side: 'buy_prl',
        amountPrl: '1.00000000',
        settlementAsset: 'USDC',
        settlementNetwork: 'base',
        buyerPearlAddress: 'not-pearl',
        usdcRefundAddress: '0x2222222222222222222222222222222222222222',
        clientRequestId: 'quote-invalid-pearl',
      }),
    /buyerPearlAddress must be a Pearl/,
  );

  await assert.rejects(
    () =>
      service.createQuote({
        side: 'buy_prl',
        amountPrl: '1.00000000',
        settlementAsset: 'USDC',
        settlementNetwork: 'base',
        buyerPearlAddress: 'tprl1pbuyer',
        usdcRefundAddress: '0x123',
        clientRequestId: 'quote-invalid-evm',
      }),
    /usdcRefundAddress must be a valid EVM address/,
  );
});

test('accepts a quote into pearl escrow pending state', async () => {
  const service = createService();
  const quote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: 'tprl1pbuyer',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-2',
  });

  const trade = await service.acceptQuote(quote.quoteId, {
    buyerPearlAddress: 'tprl1pbuyer',
    buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
    sellerPearlRefundAddress: 'tprl1psellerrefund',
    sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
    clientRequestId: 'accept-request-2',
  });

  assert.equal(trade.state, 'pearl_escrow_pending');
  assert.equal(trade.usdcEscrow.chainId, 84532);
  assert.equal(trade.usdcEscrow.contract, config.baseEscrowContract);
  assert.equal(trade.usdcEscrow.expectedAmountMicros, '171700000');
  assert.equal(trade.usdcEscrow.expiresAt, '2026-05-16T12:15:00.000Z');
  assert.equal(trade.pearlEscrow.requiredConfirmations, 3);
  assert.deepEqual(trade.deadlines, {
    quoteExpiresAt: quote.expiresAt,
    pearlFundingDeadline: '2026-05-16T12:10:00.000Z',
    usdcDepositDeadline: '2026-05-16T12:15:00.000Z',
    settlementDeadline: '2026-05-16T12:30:00.000Z',
    refundAvailableAt: '2026-05-16T12:15:00.000Z',
  });
  assert.match(trade.usdcEscrow.tradeKey, /^0x[0-9a-f]{64}$/);
});

test('registers real Pearl escrows with the indexer before returning accepted trade', async () => {
  const repository = new InMemoryOtcRepository();
  const registrar = new RecordingWatchRegistrar();
  const service = new OtcTradeService(
    repository,
    { ...config, pearlEscrowAllocator: 'p2tr_xpub' },
    escrowAllocator,
    undefined,
    () => new Date('2026-05-16T12:00:00.000Z'),
    registrar,
  );
  const quote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: 'tprl1pbuyer',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-watch',
  });

  const trade = await service.acceptQuote(quote.quoteId, {
    buyerPearlAddress: 'tprl1pbuyer',
    buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
    sellerPearlRefundAddress: 'tprl1psellerrefund',
    sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
    clientRequestId: 'accept-request-watch',
  });

  assert.deepEqual(registrar.trades, [trade.tradeId]);
  const sideEffects = await repository.listSideEffects(trade.tradeId);
  assert.equal(sideEffects.length, 1);
  assert.equal(sideEffects[0].effectType, 'pearl_watch_register');
  assert.equal(sideEffects[0].sourceEventId, `otc:${trade.tradeId}:pearl-escrow`);
});

test('requires an indexer watch registrar for real Pearl escrow allocation', async () => {
  const service = new OtcTradeService(
    new InMemoryOtcRepository(),
    { ...config, pearlEscrowAllocator: 'p2tr_xpub' },
    escrowAllocator,
    () => new Date('2026-05-16T12:00:00.000Z'),
  );
  const quote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: 'tprl1pbuyer',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-watch-required',
  });

  await assert.rejects(
    () =>
      service.acceptQuote(quote.quoteId, {
        buyerPearlAddress: 'tprl1pbuyer',
        buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
        sellerPearlRefundAddress: 'tprl1psellerrefund',
        sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
        clientRequestId: 'accept-request-watch-required',
      }),
    /Pearl indexer watch registrar is required/,
  );
});

test('rejects accept idempotency key reuse with a different payload', async () => {
  const service = createService();
  const quote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: 'tprl1pbuyer',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-idempotent-accept',
  });
  const request = {
    buyerPearlAddress: 'tprl1pbuyer',
    buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
    sellerPearlRefundAddress: 'tprl1psellerrefund',
    sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
    clientRequestId: 'accept-reused-key',
  };

  await service.acceptQuote(quote.quoteId, request);

  await assert.rejects(
    () =>
      service.acceptQuote(quote.quoteId, {
        ...request,
        sellerUsdcReceiveAddress: '0x5555555555555555555555555555555555555555',
      }),
    /trade idempotency key reuse with different payload/,
  );
});

test('rejects invalid accept addresses before escrow allocation', async () => {
  const service = createService();
  const quote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: 'tprl1pbuyer',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-invalid-accept',
  });

  await assert.rejects(
    () =>
      service.acceptQuote(quote.quoteId, {
        buyerPearlAddress: 'tprl1pbuyer',
        buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
        sellerPearlRefundAddress: 'not-pearl',
        sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
        clientRequestId: 'accept-invalid-pearl',
      }),
    /sellerPearlRefundAddress must be a Pearl/,
  );

  await assert.rejects(
    () =>
      service.acceptQuote(quote.quoteId, {
        buyerPearlAddress: 'tprl1pbuyer',
        buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
        sellerPearlRefundAddress: 'tprl1psellerrefund',
        sellerUsdcReceiveAddress: '0x123',
        clientRequestId: 'accept-invalid-evm',
      }),
    /sellerUsdcReceiveAddress must be a valid EVM address/,
  );

  await assert.rejects(
    () =>
      service.acceptQuote(quote.quoteId, {
        buyerPearlAddress: 'tprl1pbuyer',
        buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
        sellerPearlRefundAddress: 'tprl1pbuyer',
        sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
        clientRequestId: 'accept-ambiguous-pearl-destination',
      }),
    /buyerPearlAddress and sellerPearlRefundAddress must be distinct/,
  );
});

test('rejects expired quotes', async () => {
  const repository = new InMemoryOtcRepository();
  const quoteService = new OtcTradeService(repository, config, escrowAllocator, () => new Date('2026-05-16T12:00:00.000Z'));
  const quote = await quoteService.createQuote({
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: 'tprl1pbuyer',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-3',
  });

  const acceptService = new OtcTradeService(repository, config, escrowAllocator, () => new Date('2026-05-16T12:06:00.000Z'));
  await assert.rejects(
    () =>
      acceptService.acceptQuote(quote.quoteId, {
        buyerPearlAddress: 'tprl1pbuyer',
        buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
        sellerPearlRefundAddress: 'tprl1psellerrefund',
        sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
        clientRequestId: 'accept-request-3',
      }),
    /quote expired/,
  );
});

test('prepares createTrade intent only after quote acceptance and records side effect idempotently', async () => {
  const service = createService();
  const quote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: 'tprl1pbuyer',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-create-intent',
  });

  const trade = await service.acceptQuote(quote.quoteId, {
    buyerPearlAddress: 'tprl1pbuyer',
    buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
    sellerPearlRefundAddress: 'tprl1psellerrefund',
    sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
    clientRequestId: 'accept-request-create-intent',
  });

  const first = await service.prepareUsdcCreateTrade(trade.tradeId, {
    idempotencyKey: 'create-trade-1',
    actor: 'settlement-worker',
  });
  const second = await service.prepareUsdcCreateTrade(trade.tradeId, {
    idempotencyKey: 'create-trade-1',
    actor: 'settlement-worker',
  });

  assert.equal(first.tradeKey, trade.usdcEscrow.tradeKey);
  assert.equal(first.buyer, trade.buyerUsdcAddress);
  assert.equal(first.seller, trade.sellerUsdcReceiveAddress);
  assert.equal(first.amountMicros, '170000000');
  assert.equal(first.feeMicros, '1700000');
  assert.equal(first.expiryUnixSeconds, 1778933700);
  assert.equal(first.sideEffect.effectType, 'usdc_create_trade');
  assert.equal(first.sideEffect.status, 'prepared');
  assert.equal(second.sideEffect.createdAt, first.sideEffect.createdAt);
  assert.equal((await service.listSideEffects(trade.tradeId)).length, 1);

  await assert.rejects(
    () =>
      service.prepareUsdcCreateTrade('missing-trade', {
        idempotencyKey: 'create-trade-missing',
        actor: 'settlement-worker',
      }),
    /trade not found/,
  );
});

test('rejects side-effect idempotency key reuse with a different payload', async () => {
  const service = createService();
  const quote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: 'tprl1pbuyer',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-side-effect-idempotency',
  });
  const trade = await service.acceptQuote(quote.quoteId, {
    buyerPearlAddress: 'tprl1pbuyer',
    buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
    sellerPearlRefundAddress: 'tprl1psellerrefund',
    sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
    clientRequestId: 'accept-request-side-effect-idempotency',
  });

  await service.recordSideEffect(trade.tradeId, {
    idempotencyKey: 'manual-side-effect-1',
    effectType: 'usdc_deposit_observed',
    status: 'submitted',
    actor: 'operator',
    txHash: '0xabc',
  });

  await assert.rejects(
    () =>
      service.recordSideEffect(trade.tradeId, {
        idempotencyKey: 'manual-side-effect-1',
        effectType: 'usdc_deposit_observed',
        status: 'confirmed',
        actor: 'operator',
        txHash: '0xabc',
      }),
    /side effect idempotency key reuse with different payload/,
  );

  await assert.rejects(
    () =>
      service.recordSideEffect(trade.tradeId, {
        idempotencyKey: 'manual-live-proof-evidence-bypass',
        effectType: 'live_proof_evidence',
        status: 'confirmed',
        actor: 'operator',
        metadata: {
          expectedStatus: 'released',
          baseTxHashes: [`0x${'a'.repeat(64)}`, `0x${'b'.repeat(64)}`, `0x${'c'.repeat(64)}`],
        },
      }),
    /unsupported/,
  );
});

test('records durable live proof evidence for terminal OTC proof replay', async () => {
  const service = createService();
  const quote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: 'tprl1pbuyer',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-live-proof-evidence',
  });
  const trade = await service.acceptQuote(quote.quoteId, {
    buyerPearlAddress: 'tprl1pbuyer',
    buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
    sellerPearlRefundAddress: 'tprl1psellerrefund',
    sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
    clientRequestId: 'accept-request-live-proof-evidence',
  });
  await service.transitionTrade(trade.tradeId, 'pearl_escrow_seen', 'live-proof:pearl-seen');
  await service.transitionTrade(trade.tradeId, 'pearl_escrow_confirmed', 'live-proof:pearl-confirmed');
  await service.transitionTrade(trade.tradeId, 'usdc_escrow_pending', 'live-proof:usdc-pending');
  await service.transitionTrade(trade.tradeId, 'usdc_escrow_confirmed', 'live-proof:usdc-confirmed');
  await service.transitionTrade(trade.tradeId, 'release_pending', 'live-proof:release-pending');
  await service.transitionTrade(trade.tradeId, 'released', 'live-proof:released');

  const evidence = await service.recordLiveProofEvidence(
    trade.tradeId,
    {
      idempotencyKey: 'live-proof-evidence-1',
      expectedStatus: 'released',
      baseTxHashes: [
        `0x${'A'.repeat(64)}`,
        `0x${'b'.repeat(64)}`,
        `0x${'c'.repeat(64)}`,
      ],
      metadata: { runId: 'live-run-1' },
    },
    { actor: 'operator' },
  );
  const replayed = await service.getLiveProofEvidence(trade.tradeId);

  assert.equal(evidence.tradeId, trade.tradeId);
  assert.equal(evidence.expectedStatus, 'released');
  assert.deepEqual(evidence.baseTxHashes, [`0x${'a'.repeat(64)}`, `0x${'b'.repeat(64)}`, `0x${'c'.repeat(64)}`]);
  assert.equal(evidence.publicProofPath, `/otc/trades/${encodeURIComponent(trade.tradeId)}/proof`);
  assert.equal(evidence.proof.status, 'released');
  assert.equal(replayed.recordedAt, evidence.recordedAt);
  assert.deepEqual(replayed.baseTxHashes, evidence.baseTxHashes);

  await assert.rejects(
    () =>
      service.recordLiveProofEvidence(
        trade.tradeId,
        {
          idempotencyKey: 'live-proof-evidence-invalid',
          expectedStatus: 'released',
          baseTxHashes: [`0x${'d'.repeat(64)}`],
        },
        { actor: 'operator' },
      ),
    /baseTxHashes must include/,
  );
});

test('verifies on-chain USDC escrow terms before allowing buyer deposit', async () => {
  const service = createServiceWithUsdcReader({
    async getTrade() {
      return {
        buyer: '0x3333333333333333333333333333333333333333',
        seller: '0x4444444444444444444444444444444444444444',
        amountMicros: '170000000',
        feeMicros: '1700000',
        expiryUnixSeconds: 1778933700,
        status: 'created',
      };
    },
  });
  const quote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: 'tprl1pbuyer',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-verify',
  });
  const trade = await service.acceptQuote(quote.quoteId, {
    buyerPearlAddress: 'tprl1pbuyer',
    buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
    sellerPearlRefundAddress: 'tprl1psellerrefund',
    sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
    clientRequestId: 'accept-request-verify',
  });

  const verification = await service.verifyUsdcEscrowTerms(trade.tradeId);

  assert.equal(verification.verified, true);
  assert.equal(verification.depositAllowed, true);
  assert.deepEqual(verification.mismatches, []);
});

test('blocks buyer deposit when on-chain USDC escrow terms mismatch', async () => {
  const service = createServiceWithUsdcReader({
    async getTrade() {
      return {
        buyer: '0x9999999999999999999999999999999999999999',
        seller: '0x4444444444444444444444444444444444444444',
        amountMicros: '1',
        feeMicros: '1700000',
        expiryUnixSeconds: 1778933700,
        status: 'created',
      };
    },
  });
  const quote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: 'tprl1pbuyer',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-mismatch',
  });
  const trade = await service.acceptQuote(quote.quoteId, {
    buyerPearlAddress: 'tprl1pbuyer',
    buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
    sellerPearlRefundAddress: 'tprl1psellerrefund',
    sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
    clientRequestId: 'accept-request-mismatch',
  });

  const verification = await service.verifyUsdcEscrowTerms(trade.tradeId);

  assert.equal(verification.verified, false);
  assert.equal(verification.depositAllowed, false);
  assert.deepEqual(verification.mismatches.sort(), ['amount', 'buyer']);
});

test('projects public proof without private addresses', async () => {
  const service = createService();
  const quote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: 'tprl1pbuyer',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-4',
  });
  const trade = await service.acceptQuote(quote.quoteId, {
    buyerPearlAddress: 'tprl1pbuyer',
    buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
    sellerPearlRefundAddress: 'tprl1psellerrefund',
    sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
    clientRequestId: 'accept-request-4',
  });

  const proof = await service.getPublicProof(trade.tradeId);
  const serialized = JSON.stringify(proof);

  assert.equal(proof.tradeId, trade.tradeId);
  assert.equal(proof.base.chainId, 84532);
  assert.deepEqual(proof.deadlines, trade.deadlines);
  assert.equal(proof.events.length, 1);
  assert.equal(serialized.includes('buyerUsdcAddress'), false);
  assert.equal(serialized.includes('sellerUsdcReceiveAddress'), false);
});

test('projects public proof Pearl facts from indexed observations and spends', async () => {
  const repository = new InMemoryOtcRepository();
  const service = new OtcTradeService(
    repository,
    { ...config, pearlEscrowAllocator: 'p2tr_xpub' },
    escrowAllocator,
    undefined,
    () => new Date('2026-05-16T12:30:00.000Z'),
    new RecordingWatchRegistrar(),
    new StaticPearlProofReader(),
  );
  const quote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: 'tprl1pbuyer',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-proof-indexed',
  });
  const trade = await service.acceptQuote(quote.quoteId, {
    buyerPearlAddress: 'tprl1pbuyer',
    buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
    sellerPearlRefundAddress: 'tprl1psellerrefund',
    sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
    clientRequestId: 'accept-request-proof-indexed',
  });

  const proof = await service.getPublicProof(trade.tradeId);

  assert.equal(proof.pearl.escrowOutpoint, 'funding_tx:0');
  assert.equal(proof.pearl.escrowConfirmations, 7);
  assert.equal(proof.pearl.releaseTxid, 'release_tx');
  assert.equal(proof.pearl.refundTxid, undefined);
  assert.equal(proof.events.some((event) => event.source === 'pearl_indexer' && event.txHash === 'release_tx'), true);
});

test('requires a Pearl proof reader for real Pearl escrow public proof', async () => {
  const repository = new InMemoryOtcRepository();
  const service = new OtcTradeService(
    repository,
    { ...config, pearlEscrowAllocator: 'p2tr_xpub' },
    escrowAllocator,
    undefined,
    () => new Date('2026-05-16T12:00:00.000Z'),
    new RecordingWatchRegistrar(),
  );
  const quote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: 'tprl1pbuyer',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-proof-reader-required',
  });
  const trade = await service.acceptQuote(quote.quoteId, {
    buyerPearlAddress: 'tprl1pbuyer',
    buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
    sellerPearlRefundAddress: 'tprl1psellerrefund',
    sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
    clientRequestId: 'accept-request-proof-reader-required',
  });

  await assert.rejects(
    () => service.getPublicProof(trade.tradeId),
    /Pearl proof reader is required/,
  );
});

test('returns a not-ready Pearl release intent before multisig funding is indexed', async () => {
  const multisigConfig: OtcApiConfig = {
    ...config,
    pearlEscrowAllocator: 'p2tr_multisig',
    pearlEscrowArbiterPubkey: xOnlyPublicKey('04'),
  };
  const service = new OtcTradeService(
    new InMemoryOtcRepository(),
    multisigConfig,
    createConfiguredPearlEscrowAllocator(multisigConfig),
    undefined,
    () => new Date('2026-05-16T12:00:00.000Z'),
    new RecordingWatchRegistrar(),
    new EmptyPearlProofReader(),
  );
  const quote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: BUYER_TESTNET_ADDRESS,
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-release-intent-not-ready',
  });
  const buyerPearlPubkey = xOnlyPublicKey('02');
  const sellerPearlPubkey = xOnlyPublicKey('03');
  const pearlReleaseSigningMode = 'preauthorize_release' as const;
  const trade = await service.acceptQuote(quote.quoteId, {
    buyerPearlAddress: BUYER_TESTNET_ADDRESS,
    buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
    sellerPearlRefundAddress: SELLER_TESTNET_REFUND_ADDRESS,
    sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
    pearlEscrowMode: 'multisig',
    pearlReleaseSigningMode,
    buyerPearlPubkey,
    sellerPearlPubkey,
    buyerPearlPubkeyProof: signSignerProof({
      quoteId: quote.quoteId,
      role: 'buyer',
      pearlAddress: BUYER_TESTNET_ADDRESS,
      usdcAddress: '0x3333333333333333333333333333333333333333',
      pearlPubkey: buyerPearlPubkey,
      releaseSigningMode: pearlReleaseSigningMode,
      privateKeySeed: '02',
    }),
    sellerPearlPubkeyProof: signSignerProof({
      quoteId: quote.quoteId,
      role: 'seller',
      pearlAddress: SELLER_TESTNET_REFUND_ADDRESS,
      usdcAddress: '0x4444444444444444444444444444444444444444',
      pearlPubkey: sellerPearlPubkey,
      releaseSigningMode: pearlReleaseSigningMode,
      privateKeySeed: '03',
    }),
    clientRequestId: 'accept-request-release-intent-not-ready',
  });

  const intent = await service.getPearlReleaseSigningIntent(trade.tradeId);

  assert.equal(intent.status, 'not_ready');
  assert.match(intent.reason ?? '', /funding outpoint/);
  assert.deepEqual(intent.signerSets, [
    ['buyer', 'seller'],
    ['buyer', 'arbiter'],
    ['seller', 'arbiter'],
  ]);
  assert.equal(intent.workerCanFinishWithArbiter, true);
});

test('rejects multisig quote acceptance without signer key ownership proofs', async () => {
  const multisigConfig: OtcApiConfig = {
    ...config,
    pearlEscrowAllocator: 'p2tr_multisig',
    pearlEscrowArbiterPubkey: xOnlyPublicKey('04'),
  };
  const service = new OtcTradeService(
    new InMemoryOtcRepository(),
    multisigConfig,
    createConfiguredPearlEscrowAllocator(multisigConfig),
    undefined,
    () => new Date('2026-05-16T12:00:00.000Z'),
    new RecordingWatchRegistrar(),
    new EmptyPearlProofReader(),
  );
  const quote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: BUYER_TESTNET_ADDRESS,
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-release-intent-no-proof',
  });

  await assert.rejects(
    () => service.acceptQuote(quote.quoteId, {
      buyerPearlAddress: BUYER_TESTNET_ADDRESS,
      buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
      sellerPearlRefundAddress: SELLER_TESTNET_REFUND_ADDRESS,
      sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
      pearlEscrowMode: 'multisig',
      pearlReleaseSigningMode: 'preauthorize_release',
      buyerPearlPubkey: xOnlyPublicKey('02'),
      sellerPearlPubkey: xOnlyPublicKey('03'),
      clientRequestId: 'accept-request-release-intent-no-proof',
    }),
    /buyerPearlPubkeyProof/,
  );
});

test('rejects multisig signer proofs bound to different accept terms', async () => {
  const multisigConfig: OtcApiConfig = {
    ...config,
    pearlEscrowAllocator: 'p2tr_multisig',
    pearlEscrowArbiterPubkey: xOnlyPublicKey('04'),
  };
  const service = new OtcTradeService(
    new InMemoryOtcRepository(),
    multisigConfig,
    createConfiguredPearlEscrowAllocator(multisigConfig),
    undefined,
    () => new Date('2026-05-16T12:00:00.000Z'),
    new RecordingWatchRegistrar(),
    new EmptyPearlProofReader(),
  );
  const quote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: BUYER_TESTNET_ADDRESS,
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-release-intent-wrong-proof-terms',
  });
  const buyerPearlPubkey = xOnlyPublicKey('02');
  const sellerPearlPubkey = xOnlyPublicKey('03');
  const pearlReleaseSigningMode = 'preauthorize_release' as const;

  await assert.rejects(
    () => service.acceptQuote(quote.quoteId, {
      buyerPearlAddress: BUYER_TESTNET_ADDRESS,
      buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
      sellerPearlRefundAddress: SELLER_TESTNET_REFUND_ADDRESS,
      sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
      pearlEscrowMode: 'multisig',
      pearlReleaseSigningMode,
      buyerPearlPubkey,
      sellerPearlPubkey,
      buyerPearlPubkeyProof: signSignerProof({
        quoteId: quote.quoteId,
        role: 'buyer',
        pearlAddress: BUYER_TESTNET_ADDRESS,
        usdcAddress: '0x3333333333333333333333333333333333333333',
        pearlPubkey: buyerPearlPubkey,
        releaseSigningMode: pearlReleaseSigningMode,
        privateKeySeed: '02',
      }),
      sellerPearlPubkeyProof: signSignerProof({
        quoteId: quote.quoteId,
        role: 'seller',
        pearlAddress: SELLER_TESTNET_REFUND_ADDRESS,
        usdcAddress: '0x5555555555555555555555555555555555555555',
        pearlPubkey: sellerPearlPubkey,
        releaseSigningMode: pearlReleaseSigningMode,
        privateKeySeed: '03',
      }),
      clientRequestId: 'accept-request-release-intent-wrong-proof-terms',
    }),
    /sellerPearlPubkeyProof does not verify/,
  );
});

test('builds a Pearl multisig release intent from indexed funding proof', async () => {
  const multisigConfig: OtcApiConfig = {
    ...config,
    pearlEscrowAllocator: 'p2tr_multisig',
    pearlEscrowArbiterPubkey: xOnlyPublicKey('04'),
    pearlReleaseFeeGrains: '1000',
  };
  const broadcaster = new RecordingPearlBroadcaster();
  const service = new OtcTradeService(
    new InMemoryOtcRepository(),
    multisigConfig,
    createConfiguredPearlEscrowAllocator(multisigConfig),
    undefined,
    () => new Date('2026-05-16T12:00:00.000Z'),
    new RecordingWatchRegistrar(),
    new StaticPearlFundingProofReader(),
    undefined,
    broadcaster,
  );
  const quote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: BUYER_TESTNET_ADDRESS,
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-release-intent-ready',
  });
  const buyerPearlPubkey = xOnlyPublicKey('02');
  const sellerPearlPubkey = xOnlyPublicKey('03');
  const pearlReleaseSigningMode = 'preauthorize_release' as const;
  const trade = await service.acceptQuote(quote.quoteId, {
    buyerPearlAddress: BUYER_TESTNET_ADDRESS,
    buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
    sellerPearlRefundAddress: SELLER_TESTNET_REFUND_ADDRESS,
    sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
    pearlEscrowMode: 'multisig',
    pearlReleaseSigningMode,
    buyerPearlPubkey,
    sellerPearlPubkey,
    buyerPearlPubkeyProof: signSignerProof({
      quoteId: quote.quoteId,
      role: 'buyer',
      pearlAddress: BUYER_TESTNET_ADDRESS,
      usdcAddress: '0x3333333333333333333333333333333333333333',
      pearlPubkey: buyerPearlPubkey,
      releaseSigningMode: pearlReleaseSigningMode,
      privateKeySeed: '02',
    }),
    sellerPearlPubkeyProof: signSignerProof({
      quoteId: quote.quoteId,
      role: 'seller',
      pearlAddress: SELLER_TESTNET_REFUND_ADDRESS,
      usdcAddress: '0x4444444444444444444444444444444444444444',
      pearlPubkey: sellerPearlPubkey,
      releaseSigningMode: pearlReleaseSigningMode,
      privateKeySeed: '03',
    }),
    clientRequestId: 'accept-request-release-intent-ready',
  });

  const intent = await service.getPearlReleaseSigningIntent(trade.tradeId);

  assert.equal(intent.status, 'ready');
  assert.equal(intent.signingMode, 'preauthorize_release');
  assert.equal(intent.inputOutpoint, INDEXED_PEARL_FUNDING_OUTPOINT);
  assert.equal(intent.inputAmountGrains, '100000000000');
  assert.equal(intent.outputAmountGrains, '99999999000');
  assert.equal(intent.feeGrains, '1000');
  assert.equal(intent.destinationAddress, BUYER_TESTNET_ADDRESS);
  assert.match(intent.unsignedTxHex ?? '', /^[0-9a-f]+$/);
  assert.match(intent.txTemplateHash ?? '', /^sha256:[0-9a-f]{64}$/);

  await service.transitionTrade(trade.tradeId, 'pearl_escrow_seen', 'test:pearl-seen');
  await service.transitionTrade(trade.tradeId, 'pearl_escrow_confirmed', 'test:pearl-confirmed');
  await service.transitionTrade(trade.tradeId, 'usdc_escrow_pending', 'test:usdc-pending');
  await service.transitionTrade(trade.tradeId, 'usdc_escrow_confirmed', 'test:usdc-confirmed');
  await service.transitionTrade(trade.tradeId, 'release_pending', 'test:release-pending');

  const signedTxHex = addDummyWitness(intent.unsignedTxHex ?? '');
  const submitted = await service.submitPearlSignedTransaction(trade.tradeId, 'release', {
    idempotencyKey: 'pearl-release-submit-test-1',
    signedTxHex,
  });

  assert.equal(submitted.action, 'release');
  assert.equal(submitted.txTemplateHash, intent.txTemplateHash);
  assert.equal(submitted.broadcastTxid, Transaction.fromHex(signedTxHex).getId());
  assert.equal(submitted.sideEffect.effectType, 'pearl_release');
  assert.equal(submitted.sideEffect.status, 'submitted');
  assert.equal(submitted.sideEffect.actor, 'user');
  assert.equal(broadcaster.signedTxHexes.length, 1);

  const retried = await service.submitPearlSignedTransaction(trade.tradeId, 'release', {
    idempotencyKey: 'pearl-release-submit-test-1',
    signedTxHex,
  });
  assert.equal(retried.broadcastTxid, submitted.broadcastTxid);
  assert.equal(retried.sideEffect.idempotencyKey, submitted.sideEffect.idempotencyKey);
  assert.equal(broadcaster.signedTxHexes.length, 1);

  await assert.rejects(
    () => service.submitPearlSignedTransaction(trade.tradeId, 'release', {
      idempotencyKey: 'pearl-release-submit-test-missing-witness',
      signedTxHex: intent.unsignedTxHex ?? '',
    }),
    /missing witness signatures/,
  );
  assert.equal(broadcaster.signedTxHexes.length, 1);

  const tampered = Transaction.fromHex(signedTxHex);
  tampered.outs[0].value -= 1;
  await assert.rejects(
    () => service.submitPearlSignedTransaction(trade.tradeId, 'release', {
      idempotencyKey: 'pearl-release-submit-test-tampered',
      signedTxHex: tampered.toHex(),
    }),
    /output does not match server template/,
  );
  assert.equal(broadcaster.signedTxHexes.length, 1);
});

test('builds admin trade diagnostics and records support alerts', async () => {
  const service = createService(new Date('2026-05-16T12:20:00.000Z'));
  const quote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: 'tprl1pbuyer',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-admin',
  });
  const trade = await service.acceptQuote(quote.quoteId, {
    buyerPearlAddress: 'tprl1pbuyer',
    buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
    sellerPearlRefundAddress: 'tprl1psellerrefund',
    sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
    clientRequestId: 'accept-request-admin',
  });

  const alert = await service.recordSupportAlert(trade.tradeId, {
    idempotencyKey: 'support-alert-1',
    actor: 'support',
    severity: 'critical',
    message: 'User reports deposit button failed',
    contact: 'user@example.com',
    source: 'user',
    metadata: { severity: 'info' },
  });
  await assert.rejects(
    () =>
      service.recordSupportAlert(trade.tradeId, {
        idempotencyKey: 'support-alert-invalid',
        actor: 'support',
        severity: 'urgent' as any,
        message: 'Invalid severity should fail',
      }),
    /severity is invalid/,
  );
  const summaries = await service.listAdminTrades({ search: trade.buyerUsdcAddress.slice(0, 12) });
  const detail = await service.getAdminTradeDebug(trade.tradeId);

  assert.equal(alert.effectType, 'support_alert');
  assert.equal(alert.status, 'failed');
  assert.equal(alert.metadata.severity, 'critical');
  assert.equal(summaries.total, 1);
  assert.equal(summaries.items[0].tradeId, trade.tradeId);
  assert.equal(summaries.items[0].alertCount, 1);
  assert.equal(summaries.items[0].failedSideEffectCount, 1);
  assert.equal(summaries.items[0].latestAlertSeverity, 'critical');
  assert.equal(summaries.items[0].safeActions.includes('record_support_alert'), true);
  assert.equal(detail.sideEffects.length, 1);
  assert.equal(detail.supportSummary.publicProofPath, `/otc/trades/${trade.tradeId}/proof`);
  assert.equal(detail.currentBlockers.includes('failed_side_effect:support_alert'), true);
});

test('filters and paginates admin trade summaries', async () => {
  let now = new Date('2026-05-16T12:00:00.000Z');
  const service = new OtcTradeService(new InMemoryOtcRepository(), config, escrowAllocator, undefined, () => now);
  const firstQuote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: 'tprl1pbuyer',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-admin-filter-1',
  });
  const firstTrade = await service.acceptQuote(firstQuote.quoteId, {
    buyerPearlAddress: 'tprl1pbuyer',
    buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
    sellerPearlRefundAddress: 'tprl1psellerrefund',
    sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
    clientRequestId: 'accept-request-admin-filter-1',
  });
  const secondQuote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '2000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: 'tprl1psecond',
    usdcRefundAddress: '0x5555555555555555555555555555555555555555',
    clientRequestId: 'quote-request-admin-filter-2',
  });
  await service.acceptQuote(secondQuote.quoteId, {
    buyerPearlAddress: 'tprl1psecond',
    buyerUsdcAddress: '0x6666666666666666666666666666666666666666',
    sellerPearlRefundAddress: 'tprl1psellerrefund2',
    sellerUsdcReceiveAddress: '0x7777777777777777777777777777777777777777',
    clientRequestId: 'accept-request-admin-filter-2',
  });
  await service.recordSupportAlert(firstTrade.tradeId, {
    idempotencyKey: 'support-alert-filter-1',
    actor: 'support',
    severity: 'warning',
    message: 'Filter me',
    source: 'user',
  });
  now = new Date('2026-05-16T12:20:00.000Z');

  const page = await service.listAdminTrades({ limit: 1 });
  const secondPage = await service.listAdminTrades({ limit: 1, cursor: page.nextCursor });
  const warning = await service.listAdminTrades({ severity: 'warning' });
  const failedOnly = await service.listAdminTrades({ failedSideEffectOnly: true });
  const deadlineBreached = await service.listAdminTrades({ deadlineBreachedOnly: true });

  assert.equal(page.items.length, 1);
  assert.equal(typeof page.nextCursor, 'string');
  assert.equal(secondPage.items.length, 1);
  assert.equal(warning.total, 1);
  assert.equal(warning.items[0].tradeId, firstTrade.tradeId);
  assert.equal(failedOnly.total, 0);
  assert.equal(deadlineBreached.total, 2);
});

test('delivers support alerts to the operator notifier and audits delivery result', async () => {
  const notifier = new RecordingSupportAlertNotifier();
  const service = createServiceWithSupportAlertNotifier(notifier);
  const quote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: 'tprl1pbuyer',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-alert-delivery',
  });
  const trade = await service.acceptQuote(quote.quoteId, {
    buyerPearlAddress: 'tprl1pbuyer',
    buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
    sellerPearlRefundAddress: 'tprl1psellerrefund',
    sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
    clientRequestId: 'accept-request-alert-delivery',
  });

  await service.recordSupportAlert(trade.tradeId, {
    idempotencyKey: 'support-alert-delivery-1',
    actor: 'support',
    severity: 'warning',
    message: 'User needs operator help',
    source: 'user',
  });
  await service.recordSupportAlert(trade.tradeId, {
    idempotencyKey: 'support-alert-delivery-1',
    actor: 'support',
    severity: 'warning',
    message: 'User needs operator help',
    source: 'user',
  });

  const sideEffects = await service.listSideEffects(trade.tradeId);
  assert.equal(notifier.notifications.length, 1);
  assert.equal(notifier.notifications[0].supportSummary.publicProofPath, `/otc/trades/${trade.tradeId}/proof`);
  assert.equal(sideEffects.some((effect) => effect.effectType === 'support_alert_delivery' && effect.status === 'confirmed'), true);
});

test('audits failed support alert delivery without losing the user alert', async () => {
  const notifier = new RecordingSupportAlertNotifier(true);
  const service = createServiceWithSupportAlertNotifier(notifier);
  const quote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: 'tprl1pbuyer',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-alert-delivery-failed',
  });
  const trade = await service.acceptQuote(quote.quoteId, {
    buyerPearlAddress: 'tprl1pbuyer',
    buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
    sellerPearlRefundAddress: 'tprl1psellerrefund',
    sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
    clientRequestId: 'accept-request-alert-delivery-failed',
  });

  const alert = await service.recordSupportAlert(trade.tradeId, {
    idempotencyKey: 'support-alert-delivery-failed-1',
    actor: 'support',
    severity: 'critical',
    message: 'Critical operator alert should be persisted',
    source: 'user',
  });

  const sideEffects = await service.listSideEffects(trade.tradeId);
  assert.equal(alert.effectType, 'support_alert');
  assert.equal(sideEffects.some((effect) => effect.effectType === 'support_alert_delivery' && effect.status === 'failed'), true);
});

test('replays support alert delivery with an audited operator actor', async () => {
  const notifier = new RecordingSupportAlertNotifier();
  const service = createServiceWithSupportAlertNotifier(notifier);
  const quote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: 'tprl1pbuyer',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-alert-replay',
  });
  const trade = await service.acceptQuote(quote.quoteId, {
    buyerPearlAddress: 'tprl1pbuyer',
    buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
    sellerPearlRefundAddress: 'tprl1psellerrefund',
    sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
    clientRequestId: 'accept-request-alert-replay',
  });
  await service.recordSupportAlert(trade.tradeId, {
    idempotencyKey: 'support-alert-replay-source',
    actor: 'support',
    severity: 'warning',
    message: 'Replay me',
    source: 'user',
  });

  const replay = await service.replaySupportAlertDelivery(
    trade.tradeId,
    'support-alert-replay-source',
    { idempotencyKey: 'support-alert-replay-1' },
    { actor: 'operator-user' },
  );

  assert.equal(notifier.notifications.length, 2);
  assert.equal(replay.effectType, 'support_alert_delivery');
  assert.equal(replay.status, 'confirmed');
  assert.equal(replay.actor, 'operator-user');
  assert.equal(replay.metadata.replay, true);
});

test('marks a trade for manual review with an audited admin note', async () => {
  const service = createService();
  const quote = await service.createQuote({
    side: 'buy_prl',
    amountPrl: '1000.00000000',
    settlementAsset: 'USDC',
    settlementNetwork: 'base',
    buyerPearlAddress: 'tprl1pbuyer',
    usdcRefundAddress: '0x2222222222222222222222222222222222222222',
    clientRequestId: 'quote-request-manual-review',
  });
  const trade = await service.acceptQuote(quote.quoteId, {
    buyerPearlAddress: 'tprl1pbuyer',
    buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
    sellerPearlRefundAddress: 'tprl1psellerrefund',
    sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
    clientRequestId: 'accept-request-manual-review',
  });

  const detail = await service.markManualReview(trade.tradeId, {
    idempotencyKey: 'manual-review-note-1',
    actor: 'operator',
    reason: 'Customer supplied screenshots; hold settlement while checking Base event',
  });
  const manualReviewTrades = await service.listAdminTrades({ manualReviewOnly: true });

  assert.equal(detail.trade.state, 'failed_manual_review');
  assert.equal(detail.events.some((event) => event.source === 'admin' && event.toState === 'failed_manual_review'), true);
  assert.equal(detail.sideEffects.some((effect) => effect.effectType === 'manual_review_note'), true);
  assert.equal(manualReviewTrades.total, 1);
  assert.equal(manualReviewTrades.items[0].manualReview, true);
});

test('models edge states as manual-review paths instead of release paths', () => {
  assert.equal(canTransitionTrade('pearl_escrow_pending', 'late_prl_funding'), true);
  assert.equal(canTransitionTrade('late_prl_funding', 'release_pending'), false);
  assert.equal(canTransitionTrade('late_prl_funding', 'disputed'), false);
  assert.equal(canTransitionTrade('late_prl_funding', 'failed_manual_review'), true);
  assert.equal(canTransitionTrade('usdc_escrow_confirmed', 'usdc_refunded'), true);
  assert.equal(canTransitionTrade('usdc_refunded', 'release_pending'), false);
  assert.equal(canTransitionTrade('usdc_refunded', 'disputed'), false);
  assert.equal(canTransitionTrade('release_pending', 'prl_release_failed'), true);
  assert.equal(canTransitionTrade('usdc_escrow_confirmed', 'amount_mismatch'), true);
  assert.equal(canTransitionTrade('pearl_escrow_seen', 'reorged'), true);
  assert.equal(canTransitionTrade('usdc_escrow_pending', 'stale_indexer'), true);
  assert.equal(canTransitionTrade('pearl_escrow_pending', 'unknown_spend'), true);
});
