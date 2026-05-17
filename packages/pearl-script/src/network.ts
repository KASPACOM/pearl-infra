import type { Network } from 'bitcoinjs-lib';

export type PearlScriptNetworkName = 'mainnet' | 'testnet' | 'testnet2' | 'simnet' | 'regtest';

export const PEARL_MAINNET_SCRIPT_NETWORK: Network = {
  messagePrefix: '\x18Pearl Signed Message:\n',
  bech32: 'prl',
  bip32: {
    public: 0x0488b21e,
    private: 0x0488ade4,
  },
  pubKeyHash: 0x00,
  scriptHash: 0x05,
  wif: 0x80,
};

export const PEARL_TESTNET_SCRIPT_NETWORK: Network = {
  messagePrefix: '\x18Pearl Testnet Signed Message:\n',
  bech32: 'tprl',
  bip32: {
    public: 0x043587cf,
    private: 0x04358394,
  },
  pubKeyHash: 0x6f,
  scriptHash: 0xc4,
  wif: 0xef,
};

export const PEARL_SIMNET_SCRIPT_NETWORK: Network = {
  messagePrefix: '\x18Pearl Simnet Signed Message:\n',
  bech32: 'rprl',
  bip32: {
    public: 0x0420bd3a,
    private: 0x0420b900,
  },
  pubKeyHash: 0x3f,
  scriptHash: 0x7b,
  wif: 0x64,
};

export const PEARL_SCRIPT_NETWORKS: Readonly<Record<PearlScriptNetworkName, Network>> = {
  mainnet: PEARL_MAINNET_SCRIPT_NETWORK,
  testnet: PEARL_TESTNET_SCRIPT_NETWORK,
  testnet2: PEARL_TESTNET_SCRIPT_NETWORK,
  simnet: PEARL_SIMNET_SCRIPT_NETWORK,
  regtest: PEARL_SIMNET_SCRIPT_NETWORK,
};

export function getPearlScriptNetwork(network: PearlScriptNetworkName): Network {
  return PEARL_SCRIPT_NETWORKS[network];
}
