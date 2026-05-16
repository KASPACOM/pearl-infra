import type { UsdcEscrowEventName, UsdcEscrowObservation } from './types.js';

export const USDC_ESCROW_EVENT_NAMES: readonly UsdcEscrowEventName[] = [
  'TradeCreated',
  'Deposited',
  'Released',
  'Refunded',
  'Cancelled',
  'Paused',
  'Unpaused',
] as const;

export function isUsdcEscrowEventName(value: string): value is UsdcEscrowEventName {
  return USDC_ESCROW_EVENT_NAMES.includes(value as UsdcEscrowEventName);
}

export function usdcEscrowObservationIsConfirmed(
  observation: Pick<UsdcEscrowObservation, 'confirmations'>,
  requiredConfirmations: number,
): boolean {
  return observation.confirmations >= requiredConfirmations;
}
