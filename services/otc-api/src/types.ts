import type {
  OtcQuote,
  OtcQuoteSide,
  OtcTrade,
  SettlementAsset,
  SettlementNetwork,
  TradeEvent,
} from '@kaspacom/pearl-sdk';

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

export interface PublicTradeProof {
  tradeId: string;
  status: OtcTrade['state'];
  quote: Pick<OtcQuote, 'side' | 'amountPrl' | 'amountUsdc' | 'feePrl' | 'feeUsdc' | 'priceUsdcPerPrl'>;
  pearl: {
    escrowAddress: string;
    escrowOutpoint?: string;
    escrowConfirmations: number;
    releaseTxid?: string;
    refundTxid?: string;
  };
  base: {
    chainId: number;
    contract: string;
    usdcToken: string;
    tradeKey: string;
    depositTxHash?: string;
    releaseTxHash?: string;
    refundTxHash?: string;
    requiredConfirmations: number;
  };
  events: TradeEvent[];
  observedAt: string;
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
