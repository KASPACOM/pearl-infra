import type { OtcApiConfig, OtcApiRuntimeConfig } from './types.js';

export function readOtcApiConfig(env: NodeJS.ProcessEnv = process.env): OtcApiConfig {
  return {
    pearlNetwork: (env.PEARL_NETWORK as OtcApiConfig['pearlNetwork'] | undefined) ?? 'testnet2',
    pearlEscrowAllocator: (env.PEARL_ESCROW_ALLOCATOR as OtcApiConfig['pearlEscrowAllocator'] | undefined) ?? 'mock',
    pearlEscrowXpub: env.PEARL_ESCROW_XPUB,
    pearlEscrowArbiterPubkey: env.PEARL_ESCROW_ARBITER_PUBKEY,
    pearlEscrowDerivationPrefix: env.PEARL_ESCROW_DERIVATION_PREFIX ?? '0',
    allowMainnetPearlEscrow: env.PEARL_ESCROW_ALLOW_MAINNET === 'true',
    quoteTtlMs: Number(env.OTC_QUOTE_TTL_MS ?? 5 * 60 * 1000),
    pearlFundingTtlMs: Number(env.OTC_PEARL_FUNDING_TTL_MS ?? 15 * 60 * 1000),
    usdcDepositTtlMs: Number(env.OTC_USDC_DEPOSIT_TTL_MS ?? 15 * 60 * 1000),
    settlementTtlMs: Number(env.OTC_SETTLEMENT_TTL_MS ?? 30 * 60 * 1000),
    priceUsdcPerPrl: env.OTC_PRICE_USDC_PER_PRL ?? '0.170000',
    feeBps: Number(env.OTC_FEE_BPS ?? 0),
    pearlEscrowConfirmations: Number(env.PEARL_ESCROW_CONFIRMATIONS ?? 3),
    pearlReleaseFeeGrains: env.PEARL_RELEASE_FEE_GRAINS ?? '0',
    baseEscrowContract: env.BASE_USDC_ESCROW_CONTRACT ?? '0x0000000000000000000000000000000000000000',
    baseNetwork: (env.BASE_USDC_ESCROW_NETWORK as OtcApiConfig['baseNetwork'] | undefined) ?? 'base_sepolia',
    databaseUrl: env.OTC_API_DATABASE_URL,
    baseRpcUrl: env.BASE_RPC_URL,
    pearlIndexerWatchUrl: env.PEARL_INDEXER_WATCH_URL,
    pearlIndexerWatchTimeoutMs: Number(env.PEARL_INDEXER_WATCH_TIMEOUT_MS ?? 5_000),
    adminApiToken: env.OTC_ADMIN_API_TOKEN,
    adminApiTokens: env.OTC_ADMIN_API_TOKENS,
    supportAlertWebhookUrl: env.OTC_ALERT_WEBHOOK_URL,
    supportAlertTelegramBotToken: env.OTC_ALERT_TELEGRAM_BOT_TOKEN,
    supportAlertTelegramChatId: env.OTC_ALERT_TELEGRAM_CHAT_ID,
    supportAlertTelegramMessageThreadId: env.OTC_ALERT_TELEGRAM_MESSAGE_THREAD_ID,
    supportAlertRateLimitWindowMs: Number(env.OTC_SUPPORT_ALERT_RATE_LIMIT_WINDOW_MS ?? 10 * 60 * 1000),
    supportAlertRateLimitMax: Number(env.OTC_SUPPORT_ALERT_RATE_LIMIT_MAX ?? 5),
    notificationEmailWebhookUrl: env.OTC_NOTIFICATION_EMAIL_WEBHOOK_URL,
    notificationEmailWebhookToken: env.OTC_NOTIFICATION_EMAIL_WEBHOOK_TOKEN,
    notificationWorkerEnabled: env.OTC_NOTIFICATION_WORKER_ENABLED === 'true',
    notificationWorkerIntervalMs: Number(env.OTC_NOTIFICATION_WORKER_INTERVAL_MS ?? 60_000),
    notificationWorkerBatchSize: Number(env.OTC_NOTIFICATION_WORKER_BATCH_SIZE ?? 50),
    notificationWorkerMaxAttempts: Number(env.OTC_NOTIFICATION_WORKER_MAX_ATTEMPTS ?? 5),
    notificationRetryBaseMs: Number(env.OTC_NOTIFICATION_RETRY_BASE_MS ?? 60_000),
    notificationDeadlineWarningWindowMs: Number(env.OTC_NOTIFICATION_DEADLINE_WARNING_WINDOW_MS ?? 15 * 60 * 1000),
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
  if (!['p2tr_xpub', 'p2tr_multisig'].includes(config.pearlEscrowAllocator)) {
    missing.push('PEARL_ESCROW_ALLOCATOR=p2tr_xpub or p2tr_multisig');
  }
  if (config.pearlEscrowAllocator === 'p2tr_xpub' && !config.pearlEscrowXpub) missing.push('PEARL_ESCROW_XPUB');
  if (config.pearlEscrowAllocator === 'p2tr_multisig' && !config.pearlEscrowArbiterPubkey) {
    missing.push('PEARL_ESCROW_ARBITER_PUBKEY');
  }
  if (!config.pearlIndexerWatchUrl) missing.push('PEARL_INDEXER_WATCH_URL');
  if (!config.adminApiToken && !config.adminApiTokens) missing.push('OTC_ADMIN_API_TOKEN or OTC_ADMIN_API_TOKENS');
  const hasTelegramAlerts = Boolean(config.supportAlertTelegramBotToken && config.supportAlertTelegramChatId);
  if (!config.supportAlertWebhookUrl && !hasTelegramAlerts) {
    missing.push('OTC_ALERT_WEBHOOK_URL or OTC_ALERT_TELEGRAM_BOT_TOKEN+OTC_ALERT_TELEGRAM_CHAT_ID');
  }
  if (config.supportAlertTelegramBotToken && !config.supportAlertTelegramChatId) {
    missing.push('OTC_ALERT_TELEGRAM_CHAT_ID');
  }
  if (config.supportAlertTelegramChatId && !config.supportAlertTelegramBotToken) {
    missing.push('OTC_ALERT_TELEGRAM_BOT_TOKEN');
  }
  if (config.baseEscrowContract === '0x0000000000000000000000000000000000000000') {
    missing.push('BASE_USDC_ESCROW_CONTRACT');
  }
  if (config.notificationWorkerEnabled && !config.notificationEmailWebhookUrl) {
    missing.push('OTC_NOTIFICATION_EMAIL_WEBHOOK_URL');
  }

  if (missing.length > 0) {
    throw new Error(`OTC API production config is incomplete: ${missing.join(', ')}`);
  }
}
