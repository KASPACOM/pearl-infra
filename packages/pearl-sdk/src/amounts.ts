const GRAINS_PER_PRL = 100_000_000n;

export function parsePrlToGrains(amountPrl: string): bigint {
  return parseDecimalToUnits(amountPrl, 8, 'PRL');
}

export function formatGrainsToPrl(grains: bigint): string {
  return formatUnitsToDecimal(grains, 8);
}

export function parseUsdcToMicros(amountUsdc: string): bigint {
  return parseDecimalToUnits(amountUsdc, 6, 'USDC');
}

export function formatMicrosToUsdc(micros: bigint): string {
  return formatUnitsToDecimal(micros, 6);
}

export function parseDecimalToUnits(amount: string, decimals: number, symbol = 'amount'): bigint {
  const normalized = amount.trim();
  const [wholePart, fractionalPart = ''] = normalized.split('.');
  if (
    !normalized ||
    normalized.split('.').length > 2 ||
    !/^\d+$/.test(wholePart) ||
    !/^\d*$/.test(fractionalPart) ||
    fractionalPart.length > decimals
  ) {
    throw new Error(`invalid ${symbol} amount: ${amount}`);
  }

  const base = 10n ** BigInt(decimals);
  const whole = BigInt(wholePart) * base;
  const fractional = BigInt(fractionalPart.padEnd(decimals, '0') || '0');
  return whole + fractional;
}

export function formatUnitsToDecimal(units: bigint, decimals: number): string {
  if (units < 0n) {
    throw new Error('cannot format negative amount');
  }

  const base = 10n ** BigInt(decimals);
  const whole = units / base;
  const fractional = units % base;
  return `${whole}.${fractional.toString().padStart(decimals, '0')}`;
}

export { GRAINS_PER_PRL };
