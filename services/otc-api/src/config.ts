import type { OtcApiConfig } from './types.js';

export function readOtcApiConfig(env: NodeJS.ProcessEnv = process.env): OtcApiConfig {
  return {
    pearlNetwork: (env.PEARL_NETWORK as OtcApiConfig['pearlNetwork'] | undefined) ?? 'testnet2',
    quoteTtlMs: Number(env.OTC_QUOTE_TTL_MS ?? 5 * 60 * 1000),
    priceUsdcPerPrl: env.OTC_PRICE_USDC_PER_PRL ?? '0.170000',
    feeBps: Number(env.OTC_FEE_BPS ?? 0),
    pearlEscrowConfirmations: Number(env.PEARL_ESCROW_CONFIRMATIONS ?? 3),
    baseEscrowContract: env.BASE_USDC_ESCROW_CONTRACT ?? '0x0000000000000000000000000000000000000000',
    baseNetwork: (env.BASE_USDC_ESCROW_NETWORK as OtcApiConfig['baseNetwork'] | undefined) ?? 'base_sepolia',
  };
}
