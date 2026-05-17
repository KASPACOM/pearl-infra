import type {
  OtcQuoteSide,
  OtcTrade,
  PublicTradeProof,
  SettlementAsset,
  SettlementNetwork,
} from '@kaspacom/pearl-sdk';

export type { PublicTradeProof };

export type QuoteRequestStatus = 'pending' | 'created';

export interface CreateQuoteRequest {
  side: OtcQuoteSide;
  amountPrl: string;
  settlementAsset: SettlementAsset;
  settlementNetwork: SettlementNetwork;
  buyerPearlAddress: string;
  usdcRefundAddress: string;
  clientRequestId: string;
}

export interface AcceptQuoteRequest {
  buyerPearlAddress: string;
  buyerUsdcAddress: string;
  sellerPearlRefundAddress: string;
  sellerUsdcReceiveAddress: string;
  clientRequestId: string;
}

export interface OtcApiConfig {
  pearlNetwork: OtcTrade['pearlEscrow']['network'];
  quoteTtlMs: number;
  priceUsdcPerPrl: string;
  feeBps: number;
  pearlEscrowConfirmations: number;
  baseEscrowContract: string;
  baseNetwork: 'base' | 'base_sepolia';
}
