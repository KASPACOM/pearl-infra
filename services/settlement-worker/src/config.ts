export interface SettlementWorkerRuntimeConfig {
  databaseUrl: string;
  pearlRpcUrl: string;
  pearlRpcUser?: string;
  pearlRpcPass?: string;
  pearlIndexerWatchUrl: string;
  pearlIndexerWatchTimeoutMs?: number;
  baseRpcUrl: string;
  baseEscrowContract: string;
  arbiterPrivkeyHex: string;
  arbiterSignerKeyId: string;
  baseOperatorPrivkeyHex?: string;
  broadcastAttemptsPath: string;
  loopIntervalMs: number;
  requireProductionConfig: boolean;
}

export function readSettlementWorkerRuntimeConfig(env: NodeJS.ProcessEnv = process.env): SettlementWorkerRuntimeConfig {
  return {
    databaseUrl: required(env.OTC_API_DATABASE_URL, 'OTC_API_DATABASE_URL'),
    pearlRpcUrl: required(env.PEARL_RPC_URL, 'PEARL_RPC_URL'),
    pearlRpcUser: env.PEARL_RPC_USER,
    pearlRpcPass: env.PEARL_RPC_PASS,
    pearlIndexerWatchUrl: required(env.PEARL_INDEXER_WATCH_URL, 'PEARL_INDEXER_WATCH_URL'),
    pearlIndexerWatchTimeoutMs: env.PEARL_INDEXER_WATCH_TIMEOUT_MS ? Number(env.PEARL_INDEXER_WATCH_TIMEOUT_MS) : 10_000,
    baseRpcUrl: required(env.BASE_RPC_URL, 'BASE_RPC_URL'),
    baseEscrowContract: required(env.BASE_USDC_ESCROW_CONTRACT, 'BASE_USDC_ESCROW_CONTRACT'),
    arbiterPrivkeyHex: required(env.OYSTER_WORKER_ARBITER_PRIVKEY_HEX, 'OYSTER_WORKER_ARBITER_PRIVKEY_HEX'),
    arbiterSignerKeyId: env.OYSTER_WORKER_SIGNER_KEY_ID ?? 'oyster-dev-arbiter',
    // Optional: when set, the worker drives Base createTrade + release via this hot key.
    // When unset, the worker emits deferred actions and an operator drives Base manually.
    baseOperatorPrivkeyHex: env.OYSTER_WORKER_BASE_OPERATOR_PRIVKEY_HEX,
    broadcastAttemptsPath: env.SETTLEMENT_WORKER_BROADCAST_ATTEMPTS_PATH ?? '/data/pearl-broadcast-attempts.json',
    loopIntervalMs: env.SETTLEMENT_WORKER_INTERVAL_MS ? Number(env.SETTLEMENT_WORKER_INTERVAL_MS) : 30_000,
    requireProductionConfig: env.SETTLEMENT_WORKER_REQUIRE_PRODUCTION_CONFIG === 'true',
  };
}

function required(value: string | undefined, name: string): string {
  if (!value || value.trim() === '') {
    throw new Error(`${name} is required for settlement worker runtime`);
  }
  return value;
}
