import { createHash } from 'node:crypto';

export function createStableId(prefix: string, parts: readonly string[]): string {
  const hash = createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 24);
  return `${prefix}_${hash}`;
}

export function createTradeKey(tradeId: string): string {
  return `0x${createHash('sha256').update(tradeId).digest('hex')}`;
}
