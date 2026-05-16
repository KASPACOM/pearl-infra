export type PearlIndexerSourceKind = 'pearld_rpc' | 'blockbook';
export type PearlIndexerSourceRole = 'primary' | 'fallback' | 'cross_check';

export interface PearlIndexerSource {
  kind: PearlIndexerSourceKind;
  role: PearlIndexerSourceRole;
  url: string;
  user?: string;
  pass?: string;
}

export interface PearlIndexerConfig {
  network: 'mainnet' | 'testnet' | 'testnet2' | 'simnet' | 'regtest';
  requiredConfirmations: number;
  maxTipLagBlocks: number;
  sources: PearlIndexerSource[];
}

export function createOtcMvpIndexerConfig(env: NodeJS.ProcessEnv = process.env): PearlIndexerConfig {
  return {
    network: (env.PEARL_NETWORK as PearlIndexerConfig['network'] | undefined) ?? 'mainnet',
    requiredConfirmations: Number(env.PEARL_REQUIRED_CONFIRMATIONS ?? 3),
    maxTipLagBlocks: Number(env.PEARL_MAX_TIP_LAG_BLOCKS ?? 2),
    sources: [
      {
        kind: 'pearld_rpc',
        role: 'primary',
        url: env.PEARLD_RPC_URL ?? 'http://127.0.0.1:44107',
        user: env.PEARLD_RPC_USER,
        pass: env.PEARLD_RPC_PASS,
      },
      {
        kind: 'blockbook',
        role: 'fallback',
        url: env.PEARL_BLOCKBOOK_URL ?? 'https://blockbook.pearlresearch.ai',
      },
    ],
  };
}

export function getPrimaryIndexerSource(config: PearlIndexerConfig): PearlIndexerSource {
  const primary = config.sources.find((source) => source.role === 'primary');
  if (!primary) {
    throw new Error('missing primary Pearl indexer source');
  }
  return primary;
}

export function assertNodeBackedIndexer(config: PearlIndexerConfig): void {
  const primary = getPrimaryIndexerSource(config);
  if (primary.kind !== 'pearld_rpc') {
    throw new Error('OTC indexer primary source must be pearld_rpc');
  }
}
