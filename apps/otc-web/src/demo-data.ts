import type { OtcQuote, OtcTrade, PublicTradeProof, TradeEvent } from '@kaspacom/pearl-sdk';

export const DEMO_NOW = new Date('2026-05-18T12:00:00.000Z');
export const DEMO_TRADE_KEY = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

export const demoQuote: OtcQuote = {
  quoteId: 'quote_demo_1',
  side: 'buy_prl',
  amountPrl: '12500.00000000',
  amountUsdc: '8237.500000',
  feePrl: '12.50000000',
  feeUsdc: '8.235000',
  priceUsdcPerPrl: '0.659000',
  settlementAsset: 'USDC',
  settlementNetwork: 'base',
  expiresAt: '2026-05-18T12:05:00.000Z',
  status: 'active',
};

export const demoTrade: OtcTrade = {
  tradeId: 'trade_demo_1',
  quoteId: demoQuote.quoteId,
  state: 'usdc_escrow_pending',
  side: 'buy_prl',
  amountPrl: demoQuote.amountPrl,
  amountUsdc: demoQuote.amountUsdc,
  feePrl: demoQuote.feePrl,
  feeUsdc: demoQuote.feeUsdc,
  buyerPearlAddress: 'tprl1pbuyer01',
  buyerUsdcAddress: '0x3333333333333333333333333333333333333333',
  sellerPearlRefundAddress: 'tprl1pseller01',
  sellerUsdcReceiveAddress: '0x4444444444444444444444444444444444444444',
  pearlEscrow: {
    network: 'testnet2',
    address: 'tprl1pescrow01',
    expectedAmountGrains: '1250000000000',
    requiredConfirmations: 6,
    fundingOutpoint: 'f3c1a9b2d4e5:0',
  },
  usdcEscrow: {
    network: 'base',
    chainId: 84532,
    contract: '0x1111111111111111111111111111111111111111',
    usdcToken: '0x2222222222222222222222222222222222222222',
    tradeKey: DEMO_TRADE_KEY,
    expectedAmountMicros: '8237500000',
    requiredConfirmations: 12,
    expiresAt: '2026-05-18T12:15:00.000Z',
  },
  deadlines: {
    quoteExpiresAt: '2026-05-18T12:05:00.000Z',
    pearlFundingDeadline: '2026-05-18T12:10:00.000Z',
    usdcDepositDeadline: '2026-05-18T12:15:00.000Z',
    settlementDeadline: '2026-05-18T12:30:00.000Z',
    refundAvailableAt: '2026-05-18T12:35:00.000Z',
  },
  createdAt: '2026-05-18T11:55:00.000Z',
  updatedAt: '2026-05-18T12:00:00.000Z',
};

export const demoEvents: TradeEvent[] = [
  {
    tradeId: demoTrade.tradeId,
    fromState: 'quoted',
    toState: 'pearl_escrow_pending',
    source: 'system',
    sourceEventId: 'demo:accepted',
    observedAt: '2026-05-18T11:56:00.000Z',
  },
  {
    tradeId: demoTrade.tradeId,
    fromState: 'pearl_escrow_pending',
    toState: 'pearl_escrow_confirmed',
    source: 'pearl_indexer',
    sourceEventId: 'demo:pearl',
    outpoint: 'f3c1a9b2d4e5:0',
    confirmations: 6,
    observedAt: '2026-05-18T11:58:00.000Z',
  },
  {
    tradeId: demoTrade.tradeId,
    fromState: 'pearl_escrow_confirmed',
    toState: 'usdc_escrow_pending',
    source: 'evm_indexer',
    sourceEventId: 'demo:base',
    txHash: '0xc4d5e6f7a8b9',
    confirmations: 4,
    observedAt: '2026-05-18T11:59:00.000Z',
  },
];

export const demoProof: PublicTradeProof = {
  tradeId: demoTrade.tradeId,
  status: demoTrade.state,
  deadlines: demoTrade.deadlines,
  quote: {
    side: demoTrade.side,
    amountPrl: demoTrade.amountPrl,
    amountUsdc: demoTrade.amountUsdc,
    feePrl: demoTrade.feePrl,
    feeUsdc: demoTrade.feeUsdc,
    priceUsdcPerPrl: demoQuote.priceUsdcPerPrl,
  },
  pearl: {
    escrowAddress: demoTrade.pearlEscrow.address,
    escrowOutpoint: demoTrade.pearlEscrow.fundingOutpoint,
    escrowConfirmations: 6,
  },
  base: {
    chainId: demoTrade.usdcEscrow.chainId,
    contract: demoTrade.usdcEscrow.contract,
    usdcToken: demoTrade.usdcEscrow.usdcToken,
    tradeKey: demoTrade.usdcEscrow.tradeKey,
    depositTxHash: '0xc4d5e6f7a8b9',
    requiredConfirmations: demoTrade.usdcEscrow.requiredConfirmations,
  },
  events: demoEvents,
  observedAt: '2026-05-18T12:00:00.000Z',
};
