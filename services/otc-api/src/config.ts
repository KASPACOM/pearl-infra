import type { OtcApiConfig, OtcApiRuntimeConfig } from './types.js';

export function readOtcApiConfig(env: NodeJS.ProcessEnv = process.env): OtcApiConfig {
  return {
    pearlNetwork: (env.PEARL_NETWORK as OtcApiConfig['pearlNetwork'] | undefined) ?? 'testnet2',
    pearlEscrowAllocator: (env.PEARL_ESCROW_ALLOCATOR as OtcApiConfig['pearlEscrowAllocator'] | undefined) ?? 'mock',
    pearlEscrowXpub: env.PEARL_ESCROW_XPUB,
    pearlEscrowDerivationPrefix: env.PEARL_ESCROW_DERIVATION_PREFIX ?? '0',
    allowMainnetPearlEscrow: env.PEARL_ESCROW_ALLOW_MAINNET === 'true',
    quoteTtlMs: Number(env.OTC_QUOTE_TTL_MS ?? 5 * 60 * 1000),
    pearlFundingTtlMs: Number(env.OTC_PEARL_FUNDING_TTL_MS ?? 15 * 60 * 1000),
    usdcDepositTtlMs: Number(env.OTC_USDC_DEPOSIT_TTL_MS ?? 15 * 60 * 1000),
    settlementTtlMs: Number(env.OTC_SETTLEMENT_TTL_MS ?? 30 * 60 * 1000),
    priceUsdcPerPrl: env.OTC_PRICE_USDC_PER_PRL ?? '0.170000',
    feeBps: Number(env.OTC_FEE_BPS ?? 0),
    pearlEscrowConfirmations: Number(env.PEARL_ESCROW_CONFIRMATIONS ?? 3),
    baseEscrowContract: env.BASE_USDC_ESCROW_CONTRACT ?? '0x0000000000000000000000000000000000000000',
    baseNetwork: (env.BASE_USDC_ESCROW_NETWORK as OtcApiConfig['baseNetwork'] | undefined) ?? 'base_sepolia',
    databaseUrl: env.OTC_API_DATABASE_URL,
    baseRpcUrl: env.BASE_RPC_URL,
    pearlIndexerWatchUrl: env.PEARL_INDEXER_WATCH_URL,
    pearlIndexerWatchTimeoutMs: Number(env.PEARL_INDEXER_WATCH_TIMEOUT_MS ?? 5_000),
  };
}

export function readOtcApiRuntimeConfig(env: NodeJS.ProcessEnv = process.env): OtcApiRuntimeConfig {
  return {
    production: env.OTC_API_REQUIRE_PRODUCTION_CONFIG === 'true' || env.NODE_ENV === 'production',
  };
}

export function assertOtcApiStartupConfig(config: OtcApiConfig, runtime: OtcApiRuntimeConfig): void {
  if (!runtime.production) {
    return;
  }

  const missing: string[] = [];
  if (!config.databaseUrl) missing.push('OTC_API_DATABASE_URL');
  if (!config.baseRpcUrl) missing.push('BASE_RPC_URL');
  if (config.pearlEscrowAllocator !== 'p2tr_xpub') missing.push('PEARL_ESCROW_ALLOCATOR=p2tr_xpub');
  if (!config.pearlEscrowXpub) missing.push('PEARL_ESCROW_XPUB');
  if (!config.pearlIndexerWatchUrl) missing.push('PEARL_INDEXER_WATCH_URL');
  if (config.baseEscrowContract === '0x0000000000000000000000000000000000000000') {
    missing.push('BASE_USDC_ESCROW_CONTRACT');
  }

  if (missing.length > 0) {
    throw new Error(`OTC API production config is incomplete: ${missing.join(', ')}`);
  }
}
