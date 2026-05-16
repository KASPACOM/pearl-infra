import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertNodeBackedIndexer,
  createOtcMvpIndexerConfig,
  getPrimaryIndexerSource,
} from '../src/config.ts';

test('creates node-backed OTC MVP indexer config', () => {
  const config = createOtcMvpIndexerConfig({
    PEARLD_RPC_URL: 'http://127.0.0.1:44107',
    PEARL_BLOCKBOOK_URL: 'https://blockbook.pearlresearch.ai',
  });

  assert.equal(config.network, 'mainnet');
  assert.equal(getPrimaryIndexerSource(config).kind, 'pearld_rpc');
  assert.doesNotThrow(() => assertNodeBackedIndexer(config));
});

test('rejects a Blockbook-only primary source for OTC', () => {
  assert.throws(() => assertNodeBackedIndexer({
    network: 'mainnet',
    requiredConfirmations: 3,
    maxTipLagBlocks: 2,
    sources: [{
      kind: 'blockbook',
      role: 'primary',
      url: 'https://blockbook.pearlresearch.ai',
    }],
  }), /primary source must be pearld_rpc/);
});
