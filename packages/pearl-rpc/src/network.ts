export type PearlNetworkName = 'mainnet' | 'testnet' | 'testnet2' | 'simnet' | 'regtest';

export interface PearlRpcConfig {
  url: string;
  user?: string;
  pass?: string;
}

export interface PearlNetworkConfig {
  name: PearlNetworkName;
  bech32: string;
  rpc: PearlRpcConfig;
  requiredConfirmations: number;
}

export const PEARL_MAINNET: PearlNetworkConfig = {
  name: 'mainnet',
  bech32: 'prl',
  rpc: {
    url: process.env.PEARL_RPC_URL ?? 'http://127.0.0.1:44107',
    user: process.env.PEARL_RPC_USER,
    pass: process.env.PEARL_RPC_PASS,
  },
  requiredConfirmations: 3,
};

export const PEARL_SIMNET: PearlNetworkConfig = {
  name: 'simnet',
  bech32: process.env.PEARL_SIMNET_BECH32 ?? 'prlsim',
  rpc: {
    url: process.env.PEARL_SIMNET_RPC_URL ?? 'http://127.0.0.1:44107',
    user: process.env.PEARL_SIMNET_RPC_USER,
    pass: process.env.PEARL_SIMNET_RPC_PASS,
  },
  requiredConfirmations: 1,
};
