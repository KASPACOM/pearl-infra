import assert from 'node:assert/strict';
import test from 'node:test';

import type { OtcQuote, OtcTrade, TradeEvent } from '@kaspacom/pearl-sdk';

import type { PgTransactionalClient } from '../src/postgres.ts';
import { InMemoryOtcRepository, PearlEscrowDerivationCollisionError, PgOtcRepository } from '../src/repository.ts';
import type { OtcSideEffect } from '../src/types.ts';

interface QueryCall {
  text: string;
  params?: unknown[];
}

type Row = Record<string, unknown>;

class FakePg implements PgTransactionalClient {
  readonly calls: QueryCall[] = [];
  private readonly fixtures: Array<{ match: RegExp; handler: (params?: unknown[]) => Row[] }> = [];

  setFixture(matcher: RegExp, rows: Row[] | ((params?: unknown[]) => Row[])): void {
    const handler = typeof rows === 'function' ? rows : () => rows;
    this.fixtures.push({ match: matcher, handler });
  }

  async query(text: string, params?: unknown[]) {
    this.calls.push({ text, params });
    for (const fixture of this.fixtures) {
      if (fixture.match.test(text)) {
        const rows = fixture.handler(params);
        return { rows: rows as never, rowCount: rows.length };
      }
    }
    return { rows: [] as never, rowCount: 0 };
  }

  async withTransaction<T>(fn: (tx: PgTransactionalClient) => Promise<T>): Promise<T> {
    this.calls.push({ text: 'BEGIN' });
    try {
      const result = await fn(this);
      this.calls.push({ text: 'COMMIT' });
      return result;
    } catch (err) {
      this.calls.push({ text: 'ROLLBACK' });
      throw err;
    }
  }
}

const quote: OtcQuote = {
  quoteId: 'quote-1',
  side: 'buy_prl',
  amountPrl: '1000.00000000',
  amountUsdc: '170.000000',
  feePrl: '0.00000000',
  feeUsdc: '1.700000',
  priceUsdcPerPrl: '0.170000',
  settlementAsset: 'USDC',
  settlementNetwork: 'base',
  expiresAt: '2026-05-16T12:05:00.000Z',
  status: 'active',
};

const trade: OtcTrade = {
  tradeId: 'trade-1',
  quoteId: quote.quoteId,
  state: 'pearl_escrow_pending',
  side: 'buy_prl',
  amountPrl: quote.amountPrl,
  amountUsdc: quote.amountUsdc,
  feePrl: quote.feePrl,
  feeUsdc: quote.feeUsdc,
  buyerPearlAddress: 'tprl1pbuyer',
  buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
  sellerPearlRefundAddress: 'tprl1psellerrefund',
  sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
  pearlEscrow: {
    network: 'testnet2',
    address: 'tprl1pescrow',
    expectedAmountGrains: '100000000000',
    requiredConfirmations: 3,
  },
  usdcEscrow: {
    network: 'base',
    chainId: 84532,
    contract: '0x1111111111111111111111111111111111111111',
    usdcToken: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    tradeKey: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    expectedAmountMicros: '171700000',
    requiredConfirmations: 6,
    expiresAt: '2026-05-16T12:15:00.000Z',
  },
  deadlines: {
    quoteExpiresAt: '2026-05-16T12:05:00.000Z',
    pearlFundingDeadline: '2026-05-16T12:10:00.000Z',
    usdcDepositDeadline: '2026-05-16T12:15:00.000Z',
    settlementDeadline: '2026-05-16T12:30:00.000Z',
    refundAvailableAt: '2026-05-16T12:15:00.000Z',
  },
  createdAt: '2026-05-16T12:00:00.000Z',
  updatedAt: '2026-05-16T12:00:00.000Z',
};

const sideEffect: OtcSideEffect = {
  idempotencyKey: 'effect-1',
  requestHash: 'sha256:effect',
  tradeId: trade.tradeId,
  effectType: 'usdc_create_trade',
  status: 'submitted',
  actor: 'settlement-worker',
  sourceEventId: 'event-1',
  txHash: '0xabc',
  chainId: 84532,
  metadata: { trade_key: trade.usdcEscrow.tradeKey },
  createdAt: '2026-05-16T12:00:00.000Z',
  updatedAt: '2026-05-16T12:00:00.000Z',
};

const fixedAt = new Date('2026-05-16T12:00:00.000Z');
const pearlEscrowAllocation = {
  tradeId: trade.tradeId,
  allocatorKey: 'p2tr_xpub:testnet2:abc',
  derivationPrefix: 'm/0',
  derivationIndex: 123,
  derivationPath: 'm/0/123',
  escrowAddress: 'tprl1pescrowallocation',
  internalPubkeyHex: '11'.repeat(32),
  taprootOutputScriptHex: `5120${'22'.repeat(32)}`,
};

test('PgOtcRepository saves and reads quotes/trades as JSON payloads', async () => {
  const pg = new FakePg();
  pg.setFixture(/INSERT INTO otc_quotes/, [{}]);
  pg.setFixture(/INSERT INTO otc_trades/, [{}]);
  pg.setFixture(/SELECT quote FROM otc_quotes WHERE quote_id/, [{ quote }]);
  pg.setFixture(/SELECT trade FROM otc_trades WHERE trade_id/, [{ trade }]);
  const repo = new PgOtcRepository(pg);

  await repo.saveQuote(quote, 'quote-client-1', 'sha256:quote');
  await repo.saveTrade(trade, 'trade-client-1', 'sha256:trade');

  assert.equal((await repo.findQuoteById(quote.quoteId))?.quoteId, quote.quoteId);
  assert.equal((await repo.findTradeById(trade.tradeId))?.tradeId, trade.tradeId);
  assert.ok(pg.calls.some((call) => /INSERT INTO otc_quotes/.test(call.text)));
  assert.ok(pg.calls.some((call) => /INSERT INTO otc_trades/.test(call.text)));
  assert.ok(pg.calls.some((call) => call.params?.includes('sha256:quote')));
  assert.ok(pg.calls.some((call) => call.params?.includes('sha256:trade')));
});

test('PgOtcRepository appends trade events idempotently', async () => {
  const pg = new FakePg();
  const event: TradeEvent = {
    tradeId: trade.tradeId,
    fromState: 'quoted',
    toState: 'pearl_escrow_pending',
    source: 'system',
    sourceEventId: 'event-accept',
    observedAt: '2026-05-16T12:00:00.000Z',
  };
  pg.setFixture(/SELECT event\s+FROM otc_trade_events/s, [{ event }]);
  const repo = new PgOtcRepository(pg);

  await repo.appendEvent(event);
  const events = await repo.listEvents(trade.tradeId);

  assert.equal(events.length, 1);
  assert.equal(events[0].sourceEventId, 'event-accept');
  assert.ok(pg.calls.some((call) => /ON CONFLICT \(trade_id, source_event_id\) DO NOTHING/.test(call.text)));
});

test('PgOtcRepository persists side effects with idempotency keys', async () => {
  const pg = new FakePg();
  pg.setFixture(/INSERT INTO otc_side_effects/, [
    {
      idempotency_key: sideEffect.idempotencyKey,
      request_hash: sideEffect.requestHash,
      trade_id: sideEffect.tradeId,
      effect_type: sideEffect.effectType,
      status: sideEffect.status,
      actor: sideEffect.actor,
      source_event_id: sideEffect.sourceEventId,
      tx_hash: sideEffect.txHash,
      outpoint: null,
      block_number: null,
      block_hash: null,
      chain_id: sideEffect.chainId,
      metadata: sideEffect.metadata,
      created_at: fixedAt,
      updated_at: fixedAt,
    },
  ]);
  const repo = new PgOtcRepository(pg);

  const result = await repo.saveSideEffect(sideEffect);

  assert.equal(result.created, true);
  assert.equal(result.sideEffect.idempotencyKey, sideEffect.idempotencyKey);
  assert.equal(result.sideEffect.requestHash, sideEffect.requestHash);
  assert.equal(result.sideEffect.chainId, 84532);
});

test('InMemoryOtcRepository reserves Pearl escrow allocations idempotently and rejects derivation collisions', async () => {
  const repo = new InMemoryOtcRepository();

  const first = await repo.reservePearlEscrowAllocation(pearlEscrowAllocation);
  const second = await repo.reservePearlEscrowAllocation(pearlEscrowAllocation);

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.allocation.derivationPath, pearlEscrowAllocation.derivationPath);
  await assert.rejects(
    () =>
      repo.reservePearlEscrowAllocation({
        ...pearlEscrowAllocation,
        tradeId: 'trade-2',
      }),
    PearlEscrowDerivationCollisionError,
  );
});

test('PgOtcRepository persists Pearl escrow allocations with derivation uniqueness', async () => {
  const pg = new FakePg();
  pg.setFixture(/SELECT trade_id, allocator_key, derivation_prefix, derivation_index,\s+derivation_path/s, []);
  pg.setFixture(/INSERT INTO pearl_escrow_allocations/, [
    {
      trade_id: pearlEscrowAllocation.tradeId,
      allocator_key: pearlEscrowAllocation.allocatorKey,
      derivation_prefix: pearlEscrowAllocation.derivationPrefix,
      derivation_index: pearlEscrowAllocation.derivationIndex,
      derivation_path: pearlEscrowAllocation.derivationPath,
      escrow_address: pearlEscrowAllocation.escrowAddress,
      internal_pubkey_hex: pearlEscrowAllocation.internalPubkeyHex,
      taproot_output_script_hex: pearlEscrowAllocation.taprootOutputScriptHex,
      created_at: fixedAt,
    },
  ]);
  const repo = new PgOtcRepository(pg);

  const result = await repo.reservePearlEscrowAllocation(pearlEscrowAllocation);

  assert.equal(result.created, true);
  assert.equal(result.allocation.tradeId, pearlEscrowAllocation.tradeId);
  assert.equal(result.allocation.derivationIndex, pearlEscrowAllocation.derivationIndex);
  assert.ok(pg.calls.some((call) => /allocator_key = \$1/.test(call.text)));
});
