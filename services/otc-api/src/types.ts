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
  pearlEscrowAllocator: 'mock' | 'p2tr_xpub';
  pearlEscrowXpub?: string;
  pearlEscrowDerivationPrefix: string;
  allowMainnetPearlEscrow: boolean;
  quoteTtlMs: number;
  pearlFundingTtlMs: number;
  usdcDepositTtlMs: number;
  settlementTtlMs: number;
  priceUsdcPerPrl: string;
  feeBps: number;
  pearlEscrowConfirmations: number;
  baseEscrowContract: string;
  baseNetwork: 'base' | 'base_sepolia';
  databaseUrl?: string;
  baseRpcUrl?: string;
}

export type OtcSideEffectType =
  | 'usdc_create_trade'
  | 'usdc_deposit_observed'
  | 'usdc_release'
  | 'usdc_refund'
  | 'pearl_release'
  | 'pearl_refund';

export type OtcSideEffectStatus = 'prepared' | 'submitted' | 'confirmed' | 'failed';

export interface OtcSideEffect {
  idempotencyKey: string;
  tradeId: string;
  effectType: OtcSideEffectType;
  status: OtcSideEffectStatus;
  actor: string;
  sourceEventId?: string;
  txHash?: string;
  outpoint?: string;
  blockNumber?: number;
  blockHash?: string;
  chainId?: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PrepareUsdcCreateTradeRequest {
  idempotencyKey: string;
  actor: string;
}

export interface UsdcCreateTradeIntent {
  tradeId: string;
  contract: string;
  chainId: number;
  tradeKey: string;
  buyer: string;
  seller: string;
  amountMicros: string;
  feeMicros: string;
  expiryUnixSeconds: number;
  sideEffect: OtcSideEffect;
}

export interface RecordSideEffectRequest {
  idempotencyKey: string;
  effectType: OtcSideEffectType;
  status: OtcSideEffectStatus;
  actor: string;
  sourceEventId?: string;
  txHash?: string;
  outpoint?: string;
  blockNumber?: number;
  blockHash?: string;
  chainId?: number;
  metadata?: Record<string, unknown>;
}

export interface UsdcEscrowOnChainTrade {
  buyer: string;
  seller: string;
  amountMicros: string;
  feeMicros: string;
  expiryUnixSeconds: number;
  status: 'none' | 'created' | 'deposited' | 'released' | 'refunded' | 'cancelled';
}

export interface UsdcEscrowVerification {
  tradeId: string;
  verified: boolean;
  depositAllowed: boolean;
  mismatches: string[];
  expected: {
    contract: string;
    chainId: number;
    tradeKey: string;
    buyer: string;
    seller: string;
    amountMicros: string;
    feeMicros: string;
    expiryUnixSeconds: number;
    usdcToken: string;
  };
  onChain?: UsdcEscrowOnChainTrade;
}
