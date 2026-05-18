import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryBlockSink, type PearlBlockSummary } from '../src/block-poller.ts';
import { FundingScannerSink, classifySpend } from '../src/funding-scanner.ts';
import { MemoryWatchedAddressRepository } from '../src/watched-address-repository.ts';
import type { WatchedAddress } from '../src/watched-address-types.ts';

function watch(metadata: Record<string, unknown>): WatchedAddress {
  return {
    watchId: 'trade_1',
    purpose: 'otc_escrow',
    network: 'testnet2',
    address: 'tprl1pescrow',
    requiredConfirmations: 3,
    status: 'active',
    metadata,
    createdAt: '2026-05-18T00:00:00.000Z',
    updatedAt: '2026-05-18T00:00:00.000Z',
  };
}

function block(overrides: Partial<PearlBlockSummary>): PearlBlockSummary {
  return {
    hash: 'b2',
    height: 101,
    previousHash: 'b1',
    txids: ['spend1'],
    inputs: [],
    outputs: [],
    timestamp: '2026-05-18T00:01:00.000Z',
    ...overrides,
  };
}

test('classifySpend marks release when the spend matches the release template output', () => {
  const result = classifySpend({
    watch: watch({
      releaseTemplate: {
        outputs: [{ address: 'tprl1pbuyer', amountGrains: '12499999000' }],
      },
      refundTemplate: {
        outputs: [{ address: 'tprl1psellerrefund', amountGrains: '12499999000' }],
      },
    }),
    spendTxid: 'spend1',
    spentOutpoint: 'funding:0',
    spendingOutputs: [
      {
        txid: 'spend1',
        vout: 0,
        amountGrains: '12499999000',
        scriptPubKey: { hex: '51', address: 'tprl1pbuyer' },
      },
    ],
  });

  assert.equal(result.classification, 'release');
  assert.equal(result.classificationData.matchedBy, 'release_template');
});

test('classifySpend marks refund when the spend txid is predeclared', () => {
  const result = classifySpend({
    watch: watch({ refund_txid: 'refund1' }),
    spendTxid: 'refund1',
    spentOutpoint: 'funding:0',
    spendingOutputs: [],
  });

  assert.equal(result.classification, 'refund');
  assert.equal(result.classificationData.matchedBy, 'refund_txid');
});

test('classifySpend marks unknown_spend when no release or refund policy matches', () => {
  const result = classifySpend({
    watch: watch({
      release_address: 'tprl1pbuyer',
      refund_address: 'tprl1psellerrefund',
    }),
    spendTxid: 'spend1',
    spentOutpoint: 'funding:0',
    spendingOutputs: [
      {
        txid: 'spend1',
        vout: 0,
        amountGrains: '12499999000',
        scriptPubKey: { hex: '51', address: 'tprl1punknown' },
      },
    ],
  });

  assert.equal(result.classification, 'unknown_spend');
  assert.equal(result.classificationData.reason, 'no_release_or_refund_template_match');
});

test('FundingScannerSink records spends for watched escrow outpoints', async () => {
  const repo = new MemoryWatchedAddressRepository();
  await repo.register({
    watchId: 'trade_1',
    purpose: 'otc_escrow',
    network: 'testnet2',
    address: 'tprl1pescrow',
    requiredConfirmations: 1,
    metadata: {
      releaseTemplate: {
        outputs: [{ address: 'tprl1pbuyer', amountGrains: '99999000' }],
      },
    },
  });
  await repo.recordObservation({
    outpoint: 'funding:0',
    watchId: 'trade_1',
    blockHash: 'b1',
    height: 100,
    amountGrains: '100000000',
    classification: 'on_time',
  });
  const sink = new FundingScannerSink({
    inner: new MemoryBlockSink(),
    repo,
    network: 'testnet2',
    logger: () => undefined,
  });

  await sink.saveBlock(block({
    inputs: [{ txid: 'spend1', vin: 0, spentOutpoint: 'funding:0' }],
    outputs: [
      {
        txid: 'spend1',
        vout: 0,
        amountGrains: '99999000',
        scriptPubKey: { hex: '51', address: 'tprl1pbuyer' },
      },
    ],
  }));
  const history = await repo.get('trade_1');

  assert.ok(history);
  assert.equal(history.observations[0].matchStatus, 'spent');
  assert.equal(history.spends.length, 1);
  assert.equal(history.spends[0].classification, 'release');
});

test('FundingScannerSink catches same-block funding and spend', async () => {
  const repo = new MemoryWatchedAddressRepository();
  await repo.register({
    watchId: 'trade_1',
    purpose: 'otc_escrow',
    network: 'testnet2',
    address: 'tprl1pescrow',
    requiredConfirmations: 1,
    metadata: {
      refund_address: 'tprl1psellerrefund',
      expected_amount_grains: '100000000',
      pearl_funding_deadline_height: 200,
    },
  });
  const sink = new FundingScannerSink({
    inner: new MemoryBlockSink(),
    repo,
    network: 'testnet2',
    logger: () => undefined,
  });

  await sink.saveBlock(block({
    txids: ['funding1', 'refund1'],
    inputs: [{ txid: 'refund1', vin: 0, spentOutpoint: 'funding1:0' }],
    outputs: [
      {
        txid: 'funding1',
        vout: 0,
        amountGrains: '100000000',
        scriptPubKey: { hex: '51', address: 'tprl1pescrow' },
      },
      {
        txid: 'refund1',
        vout: 0,
        amountGrains: '99999000',
        scriptPubKey: { hex: '51', address: 'tprl1psellerrefund' },
      },
    ],
  }));
  const history = await repo.get('trade_1');

  assert.ok(history);
  assert.equal(history.observations[0].outpoint, 'funding1:0');
  assert.equal(history.observations[0].matchStatus, 'spent');
  assert.equal(history.spends[0].classification, 'refund');
});
