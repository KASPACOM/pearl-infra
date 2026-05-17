export interface PearlIndexerServiceConfig {
  network: 'mainnet' | 'testnet' | 'testnet2' | 'simnet' | 'regtest';
  rpcUrl: string;
  rpcUser?: string;
  rpcPass?: string;
  pollIntervalMs: number;
  startHeight: number;
  databaseUrl?: string;
}

export function readPearlIndexerServiceConfig(env: NodeJS.ProcessEnv = process.env): PearlIndexerServiceConfig {
  return {
    network: (env.PEARL_NETWORK as PearlIndexerServiceConfig['network'] | undefined) ?? 'testnet2',
    rpcUrl: env.PEARLD_RPC_URL ?? 'http://127.0.0.1:44111',
    rpcUser: env.PEARLD_RPC_USER,
    rpcPass: env.PEARLD_RPC_PASS,
    pollIntervalMs: Number(env.PEARL_INDEXER_POLL_INTERVAL_MS ?? 10_000),
    startHeight: Number(env.PEARL_INDEXER_START_HEIGHT ?? 0),
    databaseUrl: env.PEARL_INDEXER_DATABASE_URL,
  };
}
