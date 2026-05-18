import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertOtcApiStartupConfig,
  readOtcApiConfig,
  readOtcApiRuntimeConfig,
} from '../src/config.ts';

test('allows relaxed local OTC API config outside production mode', () => {
  const config = readOtcApiConfig({});
  const runtime = readOtcApiRuntimeConfig({});

  assert.equal(runtime.production, false);
  assert.doesNotThrow(() => assertOtcApiStartupConfig(config, runtime));
});

test('fails production startup when persistence, RPC, real Pearl escrow, or contract config is missing', () => {
  const config = readOtcApiConfig({
    NODE_ENV: 'production',
  });
  const runtime = readOtcApiRuntimeConfig({ NODE_ENV: 'production' });

  assert.throws(
    () => assertOtcApiStartupConfig(config, runtime),
    /OTC_API_DATABASE_URL.*BASE_RPC_URL.*PEARL_ESCROW_ALLOCATOR=p2tr_xpub.*PEARL_ESCROW_XPUB.*PEARL_INDEXER_WATCH_URL.*OTC_ADMIN_API_TOKEN.*OTC_ALERT_WEBHOOK_URL.*BASE_USDC_ESCROW_CONTRACT/,
  );
});

test('accepts complete production startup config', () => {
  const config = readOtcApiConfig({
    OTC_API_REQUIRE_PRODUCTION_CONFIG: 'true',
    OTC_API_DATABASE_URL: 'postgres://user:pass@db/otc',
    BASE_RPC_URL: 'https://base-sepolia.example',
    PEARL_ESCROW_ALLOCATOR: 'p2tr_xpub',
    PEARL_ESCROW_XPUB: 'tpubD6NzVbkrYhZ4Xfake',
    PEARL_INDEXER_WATCH_URL: 'http://pearl-indexer:8080',
    BASE_USDC_ESCROW_CONTRACT: '0x1111111111111111111111111111111111111111',
    OTC_ADMIN_API_TOKEN: 'test-admin-token',
    OTC_ALERT_WEBHOOK_URL: 'https://alerts.example.test/otc',
  });
  const runtime = readOtcApiRuntimeConfig({ OTC_API_REQUIRE_PRODUCTION_CONFIG: 'true' });

  assert.doesNotThrow(() => assertOtcApiStartupConfig(config, runtime));
});
