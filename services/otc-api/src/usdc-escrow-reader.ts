import { Contract, JsonRpcProvider } from 'ethers';

import { PRL_USDC_ESCROW_ABI } from '@kaspacom/usdc-escrow-client';

import type { UsdcEscrowOnChainTrade } from './types.js';

export interface UsdcEscrowReader {
  getTrade(tradeKey: string): Promise<UsdcEscrowOnChainTrade>;
}

const STATUS_BY_INDEX: readonly UsdcEscrowOnChainTrade['status'][] = [
  'none',
  'created',
  'deposited',
  'released',
  'refunded',
  'cancelled',
];

export class EthersUsdcEscrowReader implements UsdcEscrowReader {
  private readonly contract: Contract;

  constructor(rpcUrl: string, contractAddress: string) {
    this.contract = new Contract(contractAddress, PRL_USDC_ESCROW_ABI, new JsonRpcProvider(rpcUrl));
  }

  async getTrade(tradeKey: string): Promise<UsdcEscrowOnChainTrade> {
    const result = await this.contract.trades(tradeKey);
    const statusIndex = Number(result.status ?? result[5]);
    return {
      buyer: String(result.buyer ?? result[0]),
      seller: String(result.seller ?? result[1]),
      amountMicros: (result.amount ?? result[2]).toString(),
      feeMicros: (result.fee ?? result[3]).toString(),
      expiryUnixSeconds: Number(result.expiry ?? result[4]),
      status: STATUS_BY_INDEX[statusIndex] ?? 'none',
    };
  }
}
