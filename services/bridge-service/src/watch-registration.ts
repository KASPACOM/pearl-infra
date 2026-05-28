import type {
  BridgeDepositWatchRequest,
  BridgeReserveWatchRequest,
  RegisterBridgeWatchInput,
} from './types.js';

const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function buildBridgeDepositWatch(input: BridgeDepositWatchRequest): RegisterBridgeWatchInput {
  assertNonEmpty(input.depositId, 'depositId');
  assertNonEmpty(input.depositAddress, 'depositAddress');
  assertEvmAddress(input.igraRecipient, 'igraRecipient');
  assertPositiveIntegerString(input.expectedAmountMinGrains, 'expectedAmountMinGrains');
  assertPositiveIntegerString(input.expectedAmountMaxGrains, 'expectedAmountMaxGrains');
  assertRange(input.expectedAmountMinGrains, input.expectedAmountMaxGrains);
  assertPositiveInteger(input.expiryHeight, 'expiryHeight');
  assertPositiveInteger(input.requiredConfirmations, 'requiredConfirmations');

  return {
    watchId: input.depositId,
    purpose: 'bridge_deposit',
    network: input.network,
    address: input.depositAddress,
    requiredConfirmations: input.requiredConfirmations,
    metadata: {
      igra_recipient: input.igraRecipient,
      expected_amount_min_grains: input.expectedAmountMinGrains,
      expected_amount_max_grains: input.expectedAmountMaxGrains,
      expiry_height: input.expiryHeight,
      ...(input.createdAt ? { created_at: input.createdAt } : {}),
    },
  };
}

export function buildBridgeReserveWatch(input: BridgeReserveWatchRequest): RegisterBridgeWatchInput {
  assertNonEmpty(input.reserveId, 'reserveId');
  assertNonEmpty(input.reserveAddress, 'reserveAddress');
  assertPositiveInteger(input.activeFromHeight, 'activeFromHeight');
  if (input.activeToHeight !== undefined && input.activeToHeight <= input.activeFromHeight) {
    throw new Error('activeToHeight must be greater than activeFromHeight');
  }
  assertPositiveInteger(input.requiredConfirmations, 'requiredConfirmations');

  return {
    watchId: input.reserveId,
    purpose: 'bridge_reserve',
    network: input.network,
    address: input.reserveAddress,
    requiredConfirmations: input.requiredConfirmations,
    metadata: {
      custody_tier: input.custodyTier,
      active_from_height: input.activeFromHeight,
      ...(input.activeToHeight === undefined ? {} : { active_to_height: input.activeToHeight }),
      ...(input.createdAt ? { created_at: input.createdAt } : {}),
    },
  };
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim() === '') {
    throw new Error(`${field} is required`);
  }
}

function assertEvmAddress(value: string, field: string): void {
  if (!EVM_ADDRESS_RE.test(value)) {
    throw new Error(`${field} must be an EVM address`);
  }
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
}

function assertPositiveIntegerString(value: string, field: string): void {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${field} must be a positive integer string`);
  }
}

function assertRange(min: string, max: string): void {
  if (BigInt(min) > BigInt(max)) {
    throw new Error('expectedAmountMinGrains must be <= expectedAmountMaxGrains');
  }
}
