import type { UsdcEscrowNetwork, UsdcEscrowNetworkConfig } from './types.js';

export const BASE_MAINNET_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

export const USDC_ESCROW_NETWORKS: Readonly<Record<UsdcEscrowNetwork, UsdcEscrowNetworkConfig>> = {
  base: {
    network: 'base',
    chainId: 8453,
    usdcToken: BASE_MAINNET_USDC,
    requiredConfirmations: 6,
    blockExplorerUrl: 'https://basescan.org',
  },
  base_sepolia: {
    network: 'base_sepolia',
    chainId: 84532,
    usdcToken: BASE_SEPOLIA_USDC,
    requiredConfirmations: 6,
    blockExplorerUrl: 'https://sepolia.basescan.org',
  },
} as const;

export function getUsdcEscrowNetworkConfig(network: UsdcEscrowNetwork): UsdcEscrowNetworkConfig {
  return USDC_ESCROW_NETWORKS[network];
}
