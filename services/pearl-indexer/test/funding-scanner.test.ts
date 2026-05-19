import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryBlockSink, type PearlBlockSink, type PearlBlockSummary, type SaveBlockResult } from '../src/block-poller.ts';
import { FundingScannerSink, classifyFunding, classifySpend } from '../src/funding-scanner.ts';
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

function bridgeReserveWatch(metadata: Record<string, unknown> = {}): WatchedAddress {
  return {
    watchId: 'reserve_1',
    purpose: 'bridge_reserve',
    network: 'testnet2',
    address: 'tprl1preserve',
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

function fundingOutput(amountGrains = '100000000', txid = 'funding1') {
  return {
    txid,
    vout: 0,
    amountGrains,
    scriptPubKey: { hex: '51', address: 'tprl1pescrow' },
  };
}

test('classifyFunding uses OTC watch metadata for on-time and amount verdicts', () => {
  const baseWatch = watch({
    expected_amount_grains: '100000000',
    pearl_funding_deadline: '2026-05-18T00:02:00.000Z',
  });
  const currentBlock = block({
    height: 101,
    timestamp: '2026-05-18T00:01:00.000Z',
  });

  assert.equal(classifyFunding(fundingOutput('100000000'), currentBlock, baseWatch), 'on_time');
  assert.equal(classifyFunding(fundingOutput('99999999'), currentBlock, baseWatch), 'underpaid');
  assert.equal(classifyFunding(fundingOutput('100000001'), currentBlock, baseWatch), 'overpaid');
  assert.equal(
    classifyFunding(
      fundingOutput('100000000'),
      block({ timestamp: '2026-05-18T00:03:00.000Z' }),
      baseWatch,
    ),
    'late',
  );
  assert.equal(classifyFunding(fundingOutput('100000000'), currentBlock, watch({})), 'unknown_funding');
});

test('classifyFunding supports height deadlines from watch metadata', () => {
  const heightWatch = watch({
    expected_amount_grains: '100000000',
    pearl_funding_deadline_height: 100,
  });

  assert.equal(classifyFunding(fundingOutput(), block({ height: 100 }), heightWatch), 'on_time');
  assert.equal(classifyFunding(fundingOutput(), block({ height: 101 }), heightWatch), 'late');
});

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

test('classifySpend marks bridge reserve spend as exit_release with matcher metadata', () => {
  const result = classifySpend({
    watch: bridgeReserveWatch({ reserve_change_address: 'tprl1preservechange' }),
    spendTxid: 'release1',
    spentOutpoint: 'reserve-funding:0',
    spendingOutputs: [
      {
        txid: 'release1',
        vout: 0,
        amountGrains: '100',
        scriptPubKey: { hex: '51', address: 'tprl1pexitrecipient' },
      },
      {
        txid: 'release1',
        vout: 1,
        amountGrains: '900',
        scriptPubKey: { hex: '51', address: 'tprl1preservechange' },
      },
    ],
  });

  assert.equal(result.classification, 'exit_release');
  assert.equal(result.classificationData.amount_grains, '100');
  assert.equal(result.classificationData.pearl_recipient, 'tprl1pexitrecipient');
});

test('classifySpend keeps ambiguous bridge reserve spends as unknown_spend', () => {
  const result = classifySpend({
    watch: bridgeReserveWatch(),
    spendTxid: 'ambiguous-release',
    spentOutpoint: 'reserve-funding:0',
    spendingOutputs: [
      {
        txid: 'ambiguous-release',
        vout: 0,
        amountGrains: '100',
        scriptPubKey: { hex: '51', address: 'tprl1pfirst' },
      },
      {
        txid: 'ambiguous-release',
        vout: 1,
        amountGrains: '200',
        scriptPubKey: { hex: '51', address: 'tprl1psecond' },
      },
    ],
  });

  assert.equal(result.classification, 'unknown_spend');
  assert.equal(result.classificationData.reason, 'ambiguous_external_release_outputs');
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

test('FundingScannerSink classifies second live funding output for one escrow as duplicate', async () => {
  const repo = new MemoryWatchedAddressRepository();
  await repo.register({
    watchId: 'trade_1',
    purpose: 'otc_escrow',
    network: 'testnet2',
    address: 'tprl1pescrow',
    requiredConfirmations: 1,
    metadata: {
      expected_amount_grains: '100000000',
      pearl_funding_deadline: '2026-05-18T00:10:00.000Z',
    },
  });
  const sink = new FundingScannerSink({
    inner: new MemoryBlockSink(),
    repo,
    network: 'testnet2',
    logger: () => undefined,
  });

  await sink.saveBlock(block({
    hash: 'b1',
    height: 100,
    txids: ['funding1'],
    outputs: [fundingOutput('100000000', 'funding1')],
  }));
  await sink.saveBlock(block({
    hash: 'b2',
    height: 101,
    previousHash: 'b1',
    txids: ['funding2'],
    outputs: [fundingOutput('100000000', 'funding2')],
  }));
  const history = await repo.get('trade_1');

  assert.ok(history);
  assert.deepEqual(
    history.observations.map((observation) => observation.classification),
    ['on_time', 'duplicate'],
  );
});

test('FundingScannerSink detaches stale funding and replays replacement funding after reorg', async () => {
  const repo = new MemoryWatchedAddressRepository();
  await repo.register({
    watchId: 'trade_1',
    purpose: 'otc_escrow',
    network: 'testnet2',
    address: 'tprl1pescrow',
    requiredConfirmations: 1,
    metadata: {
      expected_amount_grains: '100000000',
      pearl_funding_deadline_height: 200,
    },
  });
  const sink = new FundingScannerSink({
    inner: new ScriptedSink([
      { kind: 'saved' },
      { kind: 'reorg', detachedFromHeight: 100, indexedHash: 'stale-100', newPreviousHash: 'canonical-99' },
      { kind: 'saved' },
    ]),
    repo,
    network: 'testnet2',
    logger: () => undefined,
  });

  await sink.saveBlock(block({
    hash: 'stale-100',
    height: 100,
    previousHash: 'stale-99',
    txids: ['stale-funding'],
    outputs: [fundingOutput('100000000', 'stale-funding')],
  }));
  const reorgResult = await sink.saveBlock(block({
    hash: 'canonical-101',
    height: 101,
    previousHash: 'canonical-100',
  }));
  await sink.saveBlock(block({
    hash: 'canonical-100',
    height: 100,
    previousHash: 'canonical-99',
    txids: ['replacement-funding'],
    outputs: [fundingOutput('100000000', 'replacement-funding')],
  }));
  const history = await repo.get('trade_1');

  assert.equal(reorgResult.kind, 'reorg');
  assert.ok(history);
  assert.deepEqual(
    history.observations.map((observation) => ({
      outpoint: observation.outpoint,
      matchStatus: observation.matchStatus,
      classification: observation.classification,
    })),
    [
      { outpoint: 'stale-funding:0', matchStatus: 'detached', classification: 'reorged' },
      { outpoint: 'replacement-funding:0', matchStatus: 'confirmed', classification: 'on_time' },
    ],
  );
});

class ScriptedSink implements PearlBlockSink {
  private readonly results: SaveBlockResult[];

  constructor(results: SaveBlockResult[]) {
    this.results = results;
  }

  async saveBlock(): Promise<SaveBlockResult> {
    const result = this.results.shift();
    if (!result) throw new Error('no scripted sink result');
    return result;
  }
}
