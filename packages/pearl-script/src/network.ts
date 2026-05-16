import type { Network } from 'bitcoinjs-lib';

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
