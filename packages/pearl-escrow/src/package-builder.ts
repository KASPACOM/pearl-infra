import { createPearlP2trMultisigEscrowPayment, createPearlP2trPayment } from '@kaspacom/pearl-script';
import { validatePearlAddress } from '@kaspacom/pearl-sdk';

import type {
  CreatePearlEscrowPackageInput,
  CreatePearlMultisigEscrowPackageInput,
  PearlEscrowPackage,
  PearlEscrowTxTemplate,
} from './types.js';

export function createPearlEscrowPackage(input: CreatePearlEscrowPackageInput): PearlEscrowPackage {
  assertMainnetGate(input);
  assertPositiveIntegerString(input.expectedAmountGrains, 'expectedAmountGrains');
  assertPositiveInteger(input.requiredConfirmations, 'requiredConfirmations');
  assertAddressForNetwork(input.releaseAddress, input.network, 'releaseAddress');
  assertAddressForNetwork(input.refundAddress, input.network, 'refundAddress');

  const payment = createPearlP2trPayment({
    network: input.network,
    internalPubkey: input.internalPubkey,
  });
  const releaseTemplate = createTemplate({
    kind: 'release',
    amountGrains: input.expectedAmountGrains,
    outpoint: input.fundingOutpoint,
    address: input.releaseAddress,
    role: 'buyer',
    requiredSigners: ['desk'],
  });
  const refundTemplate = createTemplate({
    kind: 'refund',
    amountGrains: input.expectedAmountGrains,
    outpoint: input.fundingOutpoint,
    address: input.refundAddress,
    role: 'refund',
    lockTime: input.refundEligibleAfterHeight ?? input.refundEligibleAfterUnixTime,
    requiredSigners: ['desk'],
    timelockSatisfied: false,
  });

  return {
    tradeId: input.tradeId,
    network: input.network,
    escrowAddress: payment.address,
    escrowScriptType: 'p2tr',
    expectedAmountGrains: input.expectedAmountGrains,
    requiredConfirmations: input.requiredConfirmations,
    ...(input.fundingOutpoint ? { fundingOutpoint: input.fundingOutpoint } : {}),
    ...(input.refundEligibleAfterHeight == null ? {} : { refundEligibleAfterHeight: input.refundEligibleAfterHeight }),
    ...(input.refundEligibleAfterUnixTime == null ? {} : { refundEligibleAfterUnixTime: input.refundEligibleAfterUnixTime }),
    releaseTemplate,
    refundTemplate,
    keys: {
      internalPubkeyHex: payment.internalPubkeyHex,
      taprootOutputScriptHex: payment.outputScriptHex,
      signerPubkeys: input.signerPubkeys ?? {},
    },
    createdAt: input.createdAt ?? new Date().toISOString(),
    verification: {
      simnetVerified: false,
    },
  };
}

export function createPearlMultisigEscrowPackage(input: CreatePearlMultisigEscrowPackageInput): PearlEscrowPackage {
  assertMainnetGate(input);
  assertPositiveIntegerString(input.expectedAmountGrains, 'expectedAmountGrains');
  assertPositiveInteger(input.requiredConfirmations, 'requiredConfirmations');
  assertAddressForNetwork(input.releaseAddress, input.network, 'releaseAddress');
  assertAddressForNetwork(input.refundAddress, input.network, 'refundAddress');

  const payment = createPearlP2trMultisigEscrowPayment({
    network: input.network,
    buyerPubkey: input.buyerPubkey,
    sellerPubkey: input.sellerPubkey,
    arbiterPubkey: input.arbiterPubkey,
    refundLockTime: input.refundEligibleAfterHeight ?? input.refundEligibleAfterUnixTime,
  });
  const releaseTemplate = createTemplate({
    kind: 'release',
    amountGrains: input.expectedAmountGrains,
    outpoint: input.fundingOutpoint,
    address: input.releaseAddress,
    role: 'buyer',
    requiredSigners: ['buyer', 'seller'],
    alternativeSignerSets: [
      ['buyer', 'arbiter'],
      ['seller', 'arbiter'],
    ],
    signingPath: 'taproot_script_path',
  });
  const refundTemplate = createTemplate({
    kind: 'refund',
    amountGrains: input.expectedAmountGrains,
    outpoint: input.fundingOutpoint,
    address: input.refundAddress,
    role: 'refund',
    lockTime: input.refundEligibleAfterHeight ?? input.refundEligibleAfterUnixTime,
    requiredSigners: ['seller'],
    timelockSatisfied: false,
    signingPath: 'taproot_script_path',
  });

  return {
    tradeId: input.tradeId,
    network: input.network,
    escrowAddress: payment.address,
    escrowScriptType: 'p2tr',
    expectedAmountGrains: input.expectedAmountGrains,
    requiredConfirmations: input.requiredConfirmations,
    ...(input.fundingOutpoint ? { fundingOutpoint: input.fundingOutpoint } : {}),
    ...(input.refundEligibleAfterHeight == null ? {} : { refundEligibleAfterHeight: input.refundEligibleAfterHeight }),
    ...(input.refundEligibleAfterUnixTime == null ? {} : { refundEligibleAfterUnixTime: input.refundEligibleAfterUnixTime }),
    releaseTemplate,
    refundTemplate,
    keys: {
      internalPubkeyHex: payment.internalPubkeyHex,
      internalKeyPolicy: payment.internalKeyPolicy,
      taprootOutputScriptHex: payment.outputScriptHex,
      signerPubkeys: {
        buyer: toHex(input.buyerPubkey),
        seller: toHex(input.sellerPubkey),
        arbiter: toHex(input.arbiterPubkey),
      },
      taprootScriptLeaves: payment.leaves.map((leaf) => ({
        kind: leaf.kind,
        requiredSigners: [...leaf.requiredSigners],
        scriptHex: leaf.scriptHex,
        leafVersion: leaf.leafVersion,
        controlBlockHex: leaf.controlBlockHex,
        ...(leaf.lockTime == null ? {} : { lockTime: leaf.lockTime }),
      })),
    },
    createdAt: input.createdAt ?? new Date().toISOString(),
    verification: {
      simnetVerified: false,
    },
  };
}

function createTemplate(input: {
  kind: PearlEscrowTxTemplate['kind'];
  amountGrains: string;
  outpoint?: string;
  address: string;
  role: 'buyer' | 'refund';
  lockTime?: number;
  requiredSigners: PearlEscrowTxTemplate['signingPolicy']['requiredSigners'];
  alternativeSignerSets?: PearlEscrowTxTemplate['signingPolicy']['alternativeSignerSets'];
  timelockSatisfied?: boolean;
  signingPath?: PearlEscrowTxTemplate['signingPolicy']['path'];
}): PearlEscrowTxTemplate {
  return {
    kind: input.kind,
    inputs: [
      {
        ...(input.outpoint ? { outpoint: input.outpoint } : {}),
        amountGrains: input.amountGrains,
      },
    ],
    outputs: [
      {
        address: input.address,
        amountGrains: input.amountGrains,
        role: input.role,
      },
    ],
    ...(input.lockTime == null ? {} : { lockTime: input.lockTime }),
    signingPolicy: {
      path: input.signingPath ?? 'taproot_key_path',
      requiredSigners: input.requiredSigners,
      ...(input.alternativeSignerSets == null ? {} : { alternativeSignerSets: input.alternativeSignerSets }),
      ...(input.timelockSatisfied == null ? {} : { timelockSatisfied: input.timelockSatisfied }),
    },
  };
}

function assertMainnetGate(input: { network: CreatePearlEscrowPackageInput['network']; allowMainnet?: boolean }): void {
  if (input.network === 'mainnet' && !input.allowMainnet) {
    throw new Error('mainnet Pearl escrow package creation is disabled until simnet verification is recorded');
  }
}

function assertPositiveIntegerString(value: string, field: string): void {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${field} must be a positive integer string`);
  }
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
}

function assertAddressForNetwork(address: string, network: CreatePearlEscrowPackageInput['network'], field: string): void {
  const validation = validatePearlAddress(address);
  if (!validation.valid) {
    throw new Error(`${field} is invalid: ${validation.reason ?? 'unknown error'}`);
  }
  if (!addressNetworkMatches(validation.network, network)) {
    throw new Error(`${field} network mismatch: expected ${network}, got ${validation.network}`);
  }
}

function addressNetworkMatches(addressNetwork: ReturnType<typeof validatePearlAddress>['network'], expected: CreatePearlEscrowPackageInput['network']): boolean {
  if (expected === 'testnet' || expected === 'testnet2') {
    return addressNetwork === 'testnet' || addressNetwork === 'testnet2';
  }
  if (expected === 'regtest' || expected === 'simnet') {
    return addressNetwork === 'regtest' || addressNetwork === 'simnet';
  }
  return addressNetwork === expected;
}

function toHex(value: string | Uint8Array): string {
  return typeof value === 'string' ? stripHexPrefix(value) : Buffer.from(value).toString('hex');
}

function stripHexPrefix(value: string): string {
  return value.startsWith('0x') ? value.slice(2) : value;
}
