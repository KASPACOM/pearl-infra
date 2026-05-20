import { Contract, Interface, isAddress, type ContractRunner, type TransactionRequest } from 'ethers';

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
  tradeKey: string,
  input: FrontendEscrowCallConfigInput = 'base_sepolia',
): PreparedContractCall {
  assertBytes32(tradeKey, 'tradeKey');
  const config = resolveEscrowCallConfig(input);
  return {
    chainId: config.chainId,
    to: config.escrowContract,
    data: createEscrowInterface().encodeFunctionData('deposit', [tradeKey]),
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
