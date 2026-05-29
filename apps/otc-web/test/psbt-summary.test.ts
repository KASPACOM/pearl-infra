import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPsbtSummary, formatGrains } from '../src/wallet/psbt-summary.ts';

test('classifies a 1-output contract as a refund', () => {
  const s = buildPsbtSummary({
    expectedInputOutpoint: 'aa'.repeat(32) + ':0',
    expectedInputAmountGrains: 100_000_000,
    expectedOutputs: [{ address: 'tprl1pmaker', amountGrains: 99_990_000 }],
    feeCapGrains: 50_000,
  });
  assert.equal(s.kind, 'refund');
  assert.equal(s.feeGrains, 10_000);
});

test('classifies a 2-output contract as a sweep', () => {
  const s = buildPsbtSummary({
    expectedInputOutpoint: 'aa'.repeat(32) + ':0',
    expectedInputAmountGrains: 100_000_000,
    expectedOutputs: [
      { address: 'tprl1ptradeescrow', amountGrains: 60_000_000 },
      { address: 'tprl1pprefund', amountGrains: 39_990_000 },
    ],
    feeCapGrains: 50_000,
  });
  assert.equal(s.kind, 'sweep');
  assert.equal(s.feeGrains, 10_000);
});

test('classifies anything else as unknown so the UI flags it', () => {
  const s = buildPsbtSummary({
    expectedInputOutpoint: 'aa'.repeat(32) + ':0',
    expectedInputAmountGrains: 100_000_000,
    expectedOutputs: [
      { address: 'tprl1pa', amountGrains: 50_000_000 },
      { address: 'tprl1pb', amountGrains: 30_000_000 },
      { address: 'tprl1pc', amountGrains: 19_990_000 },
    ],
    feeCapGrains: 50_000,
  });
  assert.equal(s.kind, 'unknown');
});

test('lines render in the order outputs were declared', () => {
  const s = buildPsbtSummary({
    expectedInputOutpoint: 'aa'.repeat(32) + ':0',
    expectedInputAmountGrains: 100_000_000,
    expectedOutputs: [
      { address: 'tprl1pfirst', amountGrains: 60_000_000 },
      { address: 'tprl1psecond', amountGrains: 39_990_000 },
    ],
    feeCapGrains: 50_000,
  });
  const output1Line = s.lines.find((l) => l.label === 'Output 1: pays');
  const output2Line = s.lines.find((l) => l.label === 'Output 2: pays');
  assert.ok(output1Line?.value.includes('tprl1pfirst'));
  assert.ok(output2Line?.value.includes('tprl1psecond'));
});

test('formatGrains renders 1.5 PRL not 1.50000000 PRL', () => {
  assert.equal(formatGrains(150_000_000), '1.5 PRL');
});

test('formatGrains renders whole numbers with one decimal', () => {
  assert.equal(formatGrains(100_000_000), '1.0 PRL');
  assert.equal(formatGrains(0), '0.0 PRL');
});

test('formatGrains renders sub-grain precision', () => {
  assert.equal(formatGrains(1), '0.00000001 PRL');
});

test('formatGrains renders negative grains with leading minus', () => {
  assert.equal(formatGrains(-100), '-0.000001 PRL');
});

test('long addresses get truncated for display', () => {
  const longAddr = 'tprl1p' + 'a'.repeat(60);
  const s = buildPsbtSummary({
    expectedInputOutpoint: 'aa'.repeat(32) + ':0',
    expectedInputAmountGrains: 100,
    expectedOutputs: [{ address: longAddr, amountGrains: 90 }],
    feeCapGrains: 20,
  });
  const outputLine = s.lines.find((l) => l.label === 'Output 1: pays');
  assert.ok(outputLine?.value.includes('…'), 'long address should be truncated');
  // Truncation must preserve a recognisable prefix + suffix.
  assert.ok(outputLine?.value.includes('tprl1paaaaaaaa'));
  assert.ok(outputLine?.value.includes(longAddr.slice(-8)));
});

test('long outpoints get truncated for display', () => {
  const longTxid = 'a'.repeat(64);
  const s = buildPsbtSummary({
    expectedInputOutpoint: `${longTxid}:7`,
    expectedInputAmountGrains: 100,
    expectedOutputs: [{ address: 'tprl1pmaker', amountGrains: 90 }],
    feeCapGrains: 20,
  });
  const inputLine = s.lines.find((l) => l.label === 'From outpoint');
  assert.ok(inputLine?.value.includes('…'));
  assert.ok(inputLine?.value.endsWith(':7'));
});

test('fee = input − Σoutputs is exposed in the summary', () => {
  const s = buildPsbtSummary({
    expectedInputOutpoint: 'aa'.repeat(32) + ':0',
    expectedInputAmountGrains: 100_000_000,
    expectedOutputs: [
      { address: 'tprl1pa', amountGrains: 60_000_000 },
      { address: 'tprl1pb', amountGrains: 39_990_000 },
    ],
    feeCapGrains: 50_000,
  });
  assert.equal(s.feeGrains, 10_000);
  const feeLine = s.lines.find((l) => l.label === 'Network fee');
  assert.equal(feeLine?.value, '0.0001 PRL');
});
