import { Contract, Interface, isAddress, type ContractRunner, type TransactionRequest } from 'ethers';

import { parseUsdcToMicros, type OtcTrade } from '@kaspacom/pearl-sdk';
import {
  getUsdcEscrowNetworkConfig,
  PRL_USDC_ESCROW_ABI,
  type UsdcEscrowNetwork,
} from '@kaspacom/usdc-escrow-client';

const ERC20_APPROVAL_ABI = ['function approve(address spender, uint256 value) returns (bool)'] as const;

export interface FrontendEscrowNetworkConfig {
  network: UsdcEscrowNetwork;
  chainId: 8453 | 84532;
  usdcToken: string;
  escrowContract: string;
  requiredConfirmations: number;
  blockExplorerUrl: string;
}

export interface PreparedContractCall {
  chainId: number;
  to: string;
  data: string;
}

export interface FrontendEscrowCallConfig {
  chainId: number;
  usdcToken: string;
  escrowContract: string;
}

export type FrontendEscrowCallConfigInput = UsdcEscrowNetwork | FrontendEscrowCallConfig;

export function getBaseEscrowFrontendConfig(network: UsdcEscrowNetwork = 'base_sepolia'): FrontendEscrowNetworkConfig {
  const config = getUsdcEscrowNetworkConfig(network);
  if (!config.escrowContract) {
    throw new Error(`USDC escrow contract is not configured for ${network}`);
  }
  return {
    ...config,
    escrowContract: config.escrowContract,
  };
}

export function createEscrowInterface(): Interface {
  return new Interface(PRL_USDC_ESCROW_ABI);
}

export function createUsdcInterface(): Interface {
  return new Interface(ERC20_APPROVAL_ABI);
}

export function createEscrowContract(
  runner?: ContractRunner | null,
  network: UsdcEscrowNetwork = 'base_sepolia',
): Contract {
  const config = getBaseEscrowFrontendConfig(network);
  return new Contract(config.escrowContract, PRL_USDC_ESCROW_ABI, runner);
}

export function prepareUsdcApprovalCall(
  amountMicros: bigint | string,
  input: FrontendEscrowCallConfigInput = 'base_sepolia',
): PreparedContractCall {
  const config = resolveEscrowCallConfig(input);
  const amount = parseAmountMicros(amountMicros);
  return {
    chainId: config.chainId,
    to: config.usdcToken,
    data: createUsdcInterface().encodeFunctionData('approve', [config.escrowContract, amount]),
  };
}

export function prepareEscrowDepositCall(
  input: {
    tradeKey: string;
    expectedSeller: string;
    expectedAmountMicros: bigint | string;
    expectedFeeMicros: bigint | string;
  },
  configInput: FrontendEscrowCallConfigInput = 'base_sepolia',
): PreparedContractCall {
  assertBytes32(input.tradeKey, 'tradeKey');
  assertEvmAddress(input.expectedSeller, 'expectedSeller');
  const config = resolveEscrowCallConfig(configInput);
  const amount = typeof input.expectedAmountMicros === 'bigint' ? input.expectedAmountMicros : BigInt(input.expectedAmountMicros);
  const fee = typeof input.expectedFeeMicros === 'bigint' ? input.expectedFeeMicros : BigInt(input.expectedFeeMicros);
  return {
    chainId: config.chainId,
    to: config.escrowContract,
    data: createEscrowInterface().encodeFunctionData('deposit', [input.tradeKey, input.expectedSeller, amount, fee]),
  };
}

/**
 * Builds a deposit() call from the canonical OtcTrade. Centralises the
 * principal-vs-total accounting so the UI can't accidentally pass the wrong
 * value:
 *
 *   - approve() must spend the TOTAL (amountUsdc + feeUsdc) — that's what
 *     OtcTrade.usdcEscrow.expectedAmountMicros holds.
 *   - deposit(...) takes PRINCIPAL and FEE separately. The on-chain guard is
 *       require(trade.amount == expectedAmount && trade.fee == expectedFee)
 *     where trade.amount on-chain is the PRINCIPAL ONLY (see PrlUsdcEscrow.sol).
 *     Passing the total here reverts every nonzero-fee deposit with
 *     "amount mismatch". This helper picks the right source values.
 *
 * Regression covered by `buildEscrowDepositCallFromTrade encodes principal,
 * not principal+fee, into deposit args` in test/base-escrow-client.test.ts.
 */
export function buildEscrowDepositCallFromTrade(
  trade: OtcTrade,
  configInput: FrontendEscrowCallConfigInput = 'base_sepolia',
): PreparedContractCall {
  return prepareEscrowDepositCall(
    {
      tradeKey: trade.usdcEscrow.tradeKey,
      expectedSeller: trade.sellerUsdcReceiveAddress,
      expectedAmountMicros: parseUsdcToMicros(trade.amountUsdc),
      expectedFeeMicros: parseUsdcToMicros(trade.feeUsdc),
    },
    configInput,
  );
}

export function prepareEscrowCreateTradeCall(
  input: {
    tradeKey: string;
    buyer: string;
    seller: string;
    amountMicros: bigint | string;
    feeMicros: bigint | string;
    expiryUnixSeconds: number;
  },
  configInput: FrontendEscrowCallConfigInput = 'base_sepolia',
): PreparedContractCall {
  assertBytes32(input.tradeKey, 'tradeKey');
  assertEvmAddress(input.buyer, 'buyer');
  assertEvmAddress(input.seller, 'seller');
  assertUnixSeconds(input.expiryUnixSeconds, 'expiryUnixSeconds');
  const config = resolveEscrowCallConfig(configInput);
  return {
    chainId: config.chainId,
    to: config.escrowContract,
    data: createEscrowInterface().encodeFunctionData('createTrade', [
      input.tradeKey,
      input.buyer,
      input.seller,
      parseAmountMicros(input.amountMicros),
      parseAmountMicros(input.feeMicros),
      BigInt(input.expiryUnixSeconds),
    ]),
  };
}

export function toTransactionRequest(call: PreparedContractCall): TransactionRequest {
  return {
    chainId: call.chainId,
    to: call.to,
    data: call.data,
  };
}

function parseAmountMicros(amountMicros: bigint | string): bigint {
  if (typeof amountMicros === 'bigint') {
    if (amountMicros < 0n) {
      throw new Error('amountMicros must be non-negative');
    }
    return amountMicros;
  }

  if (!/^\d+$/.test(amountMicros)) {
    throw new Error('amountMicros must be a base-10 integer string');
  }
  return BigInt(amountMicros);
}

function resolveEscrowCallConfig(input: FrontendEscrowCallConfigInput): FrontendEscrowCallConfig {
  if (typeof input === 'string') {
    return getBaseEscrowFrontendConfig(input);
  }
  assertEvmAddress(input.usdcToken, 'usdcToken');
  assertEvmAddress(input.escrowContract, 'escrowContract');
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) {
    throw new Error('chainId must be a positive safe integer');
  }
  return input;
}

function assertBytes32(value: string, field: string): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${field} must be a 32-byte hex string`);
  }
}

export function assertEvmAddress(value: string, field: string): void {
  if (!isAddress(value)) {
    throw new Error(`${field} must be a valid EVM address`);
  }
}

function assertUnixSeconds(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }
}
