import {
  formatGrainsToPrl,
  formatMicrosToUsdc,
  parsePrlToGrains,
  parseUsdcToMicros,
} from '@kaspacom/pearl-sdk';

export interface QuoteAmounts {
  amountPrl: string;
  amountUsdc: string;
  feePrl: string;
  feeUsdc: string;
  priceUsdcPerPrl: string;
}

export function calculateQuoteAmounts(amountPrl: string, priceUsdcPerPrl: string, feeBps: number): QuoteAmounts {
  const amountGrains = parsePrlToGrains(amountPrl);
  const priceMicros = parseUsdcToMicros(priceUsdcPerPrl);
  const amountUsdcMicros = (amountGrains * priceMicros) / 100_000_000n;
  const feeUsdcMicros = (amountUsdcMicros * BigInt(feeBps)) / 10_000n;

  return {
    amountPrl: formatGrainsToPrl(amountGrains),
    amountUsdc: formatMicrosToUsdc(amountUsdcMicros),
    feePrl: '0.00000000',
    feeUsdc: formatMicrosToUsdc(feeUsdcMicros),
    priceUsdcPerPrl,
  };
}
