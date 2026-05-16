import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatGrainsToPrl,
  formatMicrosToUsdc,
  parsePrlToGrains,
  parseUsdcToMicros,
} from '../src/amounts.ts';

test('parses and formats PRL grain amounts', () => {
  assert.equal(parsePrlToGrains('1'), 100000000n);
  assert.equal(parsePrlToGrains('1.23456789'), 123456789n);
  assert.equal(formatGrainsToPrl(123456789n), '1.23456789');
});

test('rejects PRL amounts with too many decimals', () => {
  assert.throws(() => parsePrlToGrains('1.000000001'), /invalid PRL amount/);
});

test('parses and formats USDC micro amounts', () => {
  assert.equal(parseUsdcToMicros('170'), 170000000n);
  assert.equal(parseUsdcToMicros('170.123456'), 170123456n);
  assert.equal(formatMicrosToUsdc(170123456n), '170.123456');
});
