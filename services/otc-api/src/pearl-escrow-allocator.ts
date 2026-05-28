import { createHash } from 'node:crypto';

import { createPearlEscrowPackage, createPearlMultisigEscrowPackage } from '@kaspacom/pearl-escrow';
import { createPearlP2trPrefundEscrowPayment, getPearlScriptNetwork } from '@kaspacom/pearl-script';
import { parsePrlToGrains, type OtcOrderPrefundMode } from '@kaspacom/pearl-sdk';
import { BIP32Factory, type BIP32Interface } from 'bip32';
import * as ecc from 'tiny-secp256k1';

import type {
  OrderPrefundAllocation,
  OrderPrefundAllocationInput,
  OtcRepository,
  PearlEscrowAllocation,
  PearlEscrowAllocationInput,
} from './repository.js';
import type { PearlEscrowAllocator, PearlPrefundEscrowAllocator } from './trade-service.js';
import type { OtcApiConfig } from './types.js';

const bip32 = BIP32Factory(ecc);
const BIP32_HARDENED_OFFSET = 0x80000000;
const MAX_DERIVATION_ALLOCATION_ATTEMPTS = 128;

export function createConfiguredPearlEscrowAllocator(config: OtcApiConfig, repository?: OtcRepository): PearlEscrowAllocator {
  if (config.pearlEscrowAllocator === 'mock') {
    return {
      async allocateEscrow(input) {
        return {
          network: input.config.pearlNetwork,
          address: `mock:${input.tradeId}`,
          expectedAmountGrains: (parsePrlToGrains(input.quote.amountPrl) + parsePrlToGrains(input.quote.feePrl)).toString(),
          requiredConfirmations: input.config.pearlEscrowConfirmations,
        };
      },
    };
  }
  if (config.pearlEscrowAllocator === 'p2tr_multisig') {
    if (!config.pearlEscrowArbiterPubkey) {
      throw new Error('PEARL_ESCROW_ARBITER_PUBKEY is required when PEARL_ESCROW_ALLOCATOR=p2tr_multisig');
    }
    return new MultisigPearlEscrowAllocator(config);
  }
  if (config.pearlEscrowAllocator !== 'p2tr_xpub') {
    throw new Error(`unsupported Pearl escrow allocator: ${config.pearlEscrowAllocator}`);
  }
  if (!config.pearlEscrowXpub) {
    throw new Error('PEARL_ESCROW_XPUB is required when PEARL_ESCROW_ALLOCATOR=p2tr_xpub');
  }
  if (!repository) {
    throw new Error('OtcRepository is required when PEARL_ESCROW_ALLOCATOR=p2tr_xpub');
  }
  return new XpubPearlEscrowAllocator(config, repository);
}

export class MultisigPearlEscrowAllocator implements PearlEscrowAllocator {
  private readonly config: OtcApiConfig;

  constructor(config: OtcApiConfig) {
    this.config = config;
    if (!config.pearlEscrowArbiterPubkey) {
      throw new Error('pearlEscrowArbiterPubkey is required');
    }
  }

  async allocateEscrow(input: Parameters<PearlEscrowAllocator['allocateEscrow']>[0]) {
    assertPubkey(input.request.buyerPearlPubkey, 'buyerPearlPubkey');
    assertPubkey(input.request.sellerPearlPubkey, 'sellerPearlPubkey');
    const expectedAmountGrains = (parsePrlToGrains(input.quote.amountPrl) + parsePrlToGrains(input.quote.feePrl)).toString();
    const refundEligibleAfterUnixTime = Math.floor(new Date(input.deadlines.refundAvailableAt).getTime() / 1000);
    const escrowPackage = createPearlMultisigEscrowPackage({
      tradeId: input.tradeId,
      network: this.config.pearlNetwork,
      expectedAmountGrains,
      requiredConfirmations: this.config.pearlEscrowConfirmations,
      releaseAddress: input.request.buyerPearlAddress,
      refundAddress: input.request.sellerPearlRefundAddress,
      refundEligibleAfterUnixTime,
      allowMainnet: this.config.allowMainnetPearlEscrow,
      buyerPubkey: input.request.buyerPearlPubkey,
      sellerPubkey: input.request.sellerPearlPubkey,
      arbiterPubkey: this.config.pearlEscrowArbiterPubkey as string,
    });

    return {
      network: escrowPackage.network,
      address: escrowPackage.escrowAddress,
      expectedAmountGrains: escrowPackage.expectedAmountGrains,
      requiredConfirmations: escrowPackage.requiredConfirmations,
      escrowScriptType: escrowPackage.escrowScriptType,
      internalPubkeyHex: escrowPackage.keys.internalPubkeyHex,
      internalKeyPolicy: escrowPackage.keys.internalKeyPolicy,
      scriptNonceHex: escrowPackage.keys.scriptNonceHex,
      taprootOutputScriptHex: escrowPackage.keys.taprootOutputScriptHex,
      refundEligibleAfterUnixTime: escrowPackage.refundEligibleAfterUnixTime,
      releaseTemplate: escrowPackage.releaseTemplate,
      refundTemplate: escrowPackage.refundTemplate,
      signerPubkeys: escrowPackage.keys.signerPubkeys,
      taprootScriptLeaves: escrowPackage.keys.taprootScriptLeaves,
      simnetVerified: escrowPackage.verification.simnetVerified,
    };
  }
}

export class XpubPearlEscrowAllocator implements PearlEscrowAllocator {
  private readonly root: BIP32Interface;
  private readonly prefix: readonly number[];
  private readonly derivationPrefix: string;
  private readonly allocatorKey: string;
  private readonly config: OtcApiConfig;
  private readonly repository: OtcRepository;

  constructor(config: OtcApiConfig, repository: OtcRepository) {
    if (!config.pearlEscrowXpub) {
      throw new Error('pearlEscrowXpub is required');
    }
    this.config = config;
    this.repository = repository;
    this.root = bip32.fromBase58(config.pearlEscrowXpub, getPearlScriptNetwork(config.pearlNetwork));
    this.prefix = parseDerivationPrefix(config.pearlEscrowDerivationPrefix);
    this.derivationPrefix = formatDerivationPath(this.prefix);
    this.allocatorKey = createAllocatorKey(config);
  }

  async allocateEscrow(input: Parameters<PearlEscrowAllocator['allocateEscrow']>[0]) {
    const existing = await this.repository.findPearlEscrowAllocationByTradeId(input.tradeId);
    if (existing) {
      return this.buildAndVerifyEscrow(input, existing);
    }

    for (let attempt = 0; attempt < MAX_DERIVATION_ALLOCATION_ATTEMPTS; attempt += 1) {
      const candidate = this.buildEscrow(input, deriveTradeIndex(input.tradeId, attempt));
      try {
        const reserved = await this.repository.reservePearlEscrowAllocation(candidate.allocation);
        return this.verifyPersistedAllocation(candidate.pearlEscrow, reserved.allocation);
      } catch (error) {
        if (isPearlEscrowDerivationCollision(error)) {
          continue;
        }
        throw error;
      }
    }

    throw new Error(`unable to allocate unique Pearl escrow derivation after ${MAX_DERIVATION_ALLOCATION_ATTEMPTS} attempts`);
  }

  private buildAndVerifyEscrow(
    input: Parameters<PearlEscrowAllocator['allocateEscrow']>[0],
    allocation: PearlEscrowAllocation,
  ) {
    const pearlEscrow = this.buildEscrow(input, allocation.derivationIndex).pearlEscrow;
    return this.verifyPersistedAllocation(pearlEscrow, allocation);
  }

  private buildEscrow(input: Parameters<PearlEscrowAllocator['allocateEscrow']>[0], index: number) {
    const child = deriveChild(this.root, [...this.prefix, index]);
    const derivationPath = formatDerivationPath([...this.prefix, index]);
    const expectedAmountGrains = (parsePrlToGrains(input.quote.amountPrl) + parsePrlToGrains(input.quote.feePrl)).toString();
    const refundEligibleAfterUnixTime = Math.floor(new Date(input.deadlines.refundAvailableAt).getTime() / 1000);
    const escrowPackage = createPearlEscrowPackage({
      tradeId: input.tradeId,
      network: this.config.pearlNetwork,
      internalPubkey: child.publicKey,
      expectedAmountGrains,
      requiredConfirmations: this.config.pearlEscrowConfirmations,
      releaseAddress: input.request.buyerPearlAddress,
      refundAddress: input.request.sellerPearlRefundAddress,
      refundEligibleAfterUnixTime,
      allowMainnet: this.config.allowMainnetPearlEscrow,
      signerPubkeys: {
        desk: Buffer.from(child.publicKey).toString('hex'),
      },
    });

    const pearlEscrow = {
      network: escrowPackage.network,
      address: escrowPackage.escrowAddress,
      expectedAmountGrains: escrowPackage.expectedAmountGrains,
      requiredConfirmations: escrowPackage.requiredConfirmations,
      escrowScriptType: escrowPackage.escrowScriptType,
      internalPubkeyHex: escrowPackage.keys.internalPubkeyHex,
      taprootOutputScriptHex: escrowPackage.keys.taprootOutputScriptHex,
      derivationPath,
      refundEligibleAfterUnixTime: escrowPackage.refundEligibleAfterUnixTime,
      releaseTemplate: escrowPackage.releaseTemplate,
      refundTemplate: escrowPackage.refundTemplate,
      simnetVerified: escrowPackage.verification.simnetVerified,
    };
    const allocation: PearlEscrowAllocationInput = {
      tradeId: input.tradeId,
      allocatorKey: this.allocatorKey,
      derivationPrefix: this.derivationPrefix,
      derivationIndex: index,
      derivationPath,
      escrowAddress: escrowPackage.escrowAddress,
      internalPubkeyHex: escrowPackage.keys.internalPubkeyHex,
      taprootOutputScriptHex: escrowPackage.keys.taprootOutputScriptHex,
    };
    return { pearlEscrow, allocation };
  }

  private verifyPersistedAllocation(
    pearlEscrow: Awaited<ReturnType<PearlEscrowAllocator['allocateEscrow']>>,
    allocation: PearlEscrowAllocation,
  ) {
    const mismatches: string[] = [];
    if (allocation.allocatorKey !== this.allocatorKey) mismatches.push('allocatorKey');
    if (allocation.derivationPrefix !== this.derivationPrefix) mismatches.push('derivationPrefix');
    if (allocation.derivationPath !== pearlEscrow.derivationPath) mismatches.push('derivationPath');
    if (allocation.escrowAddress !== pearlEscrow.address) mismatches.push('escrowAddress');
    if (allocation.internalPubkeyHex !== pearlEscrow.internalPubkeyHex) mismatches.push('internalPubkeyHex');
    if (allocation.taprootOutputScriptHex !== pearlEscrow.taprootOutputScriptHex) mismatches.push('taprootOutputScriptHex');
    if (mismatches.length > 0) {
      throw new Error(`persisted Pearl escrow allocation mismatch for ${allocation.tradeId}: ${mismatches.join(', ')}`);
    }
    return pearlEscrow;
  }
}

function deriveChild(root: BIP32Interface, path: readonly number[]): BIP32Interface {
  let node = root;
  for (const index of path) {
    node = node.derive(index);
  }
  return node;
}

export function deriveTradeIndex(tradeId: string, attempt = 0): number {
  const hash = createHash('sha256');
  hash.update(tradeId);
  if (attempt > 0) {
    hash.update(':');
    hash.update(attempt.toString());
  }
  return hash.digest().readUInt32BE(0) & 0x7fffffff;
}

function createAllocatorKey(config: OtcApiConfig): string {
  if (!config.pearlEscrowXpub) {
    throw new Error('pearlEscrowXpub is required');
  }
  return `p2tr_xpub:${config.pearlNetwork}:${createHash('sha256').update(config.pearlEscrowXpub).digest('hex')}`;
}

function isPearlEscrowDerivationCollision(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { name?: unknown }).name === 'PearlEscrowDerivationCollisionError');
}

function assertPubkey(value: string | undefined, field: string): asserts value is string {
  if (!value || !/^(?:0x)?[0-9a-fA-F]{64}$|^(?:0x)?0[23][0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${field} must be an x-only or compressed secp256k1 public key`);
  }
}

function parseDerivationPrefix(prefix: string): readonly number[] {
  const normalized = prefix.trim().replace(/^m\//, '');
  if (!normalized) {
    return [];
  }
  return normalized.split('/').map((segment) => {
    if (segment.endsWith("'") || segment.endsWith('h') || segment.endsWith('H')) {
      throw new Error('PEARL_ESCROW_DERIVATION_PREFIX must use non-hardened child indexes only');
    }
    const index = Number(segment);
    if (!Number.isInteger(index) || index < 0 || index >= BIP32_HARDENED_OFFSET) {
      throw new Error(`invalid PEARL_ESCROW_DERIVATION_PREFIX segment: ${segment}`);
    }
    return index;
  });
}

function formatDerivationPath(path: readonly number[]): string {
  return path.length > 0 ? `m/${path.join('/')}` : 'm';
}

// ---------- Prefund (order-book) escrow allocator ----------

export interface PrefundAllocateInput {
  orderId: string;
  mode: OtcOrderPrefundMode;
  makerPearlPubkey: string;
  amountPrl: string;
}

export interface PrefundAllocateOutput {
  network: OtcApiConfig['pearlNetwork'];
  mode: OtcOrderPrefundMode;
  escrowAddress: string;
  expectedAmountGrains: string;
  requiredConfirmations: number;
  refundEligibleAfterUnixTime: number;
  internalPubkeyHex: string;
  taprootOutputScriptHex: string;
}

export function createConfiguredPearlPrefundEscrowAllocator(
  config: OtcApiConfig,
  repository: OtcRepository,
  now: () => Date = () => new Date(),
): PearlPrefundEscrowAllocator | undefined {
  if (!config.pearlPrefundEnabled) return undefined;
  if (!config.pearlPrefundOperatorPubkey) {
    throw new Error('PEARL_PREFUND_OPERATOR_PUBKEY is required when PEARL_PREFUND_ENABLED=true');
  }
  if (!config.pearlEscrowArbiterPubkey) {
    throw new Error('PEARL_ESCROW_ARBITER_PUBKEY is required when PEARL_PREFUND_ENABLED=true (shared arbiter)');
  }
  return new MultisigPearlPrefundEscrowAllocator(config, repository, now);
}

export class MultisigPearlPrefundEscrowAllocator implements PearlPrefundEscrowAllocator {
  private readonly config: OtcApiConfig;
  private readonly repository: OtcRepository;
  private readonly now: () => Date;
  private readonly allocatorKey: string;
  private readonly derivationPrefix: string;

  constructor(config: OtcApiConfig, repository: OtcRepository, now: () => Date = () => new Date()) {
    this.config = config;
    this.repository = repository;
    this.now = now;
    if (!config.pearlPrefundOperatorPubkey) {
      throw new Error('pearlPrefundOperatorPubkey is required');
    }
    if (!config.pearlEscrowArbiterPubkey) {
      throw new Error('pearlEscrowArbiterPubkey is required');
    }
    this.derivationPrefix = config.pearlPrefundDerivationPrefix ?? '1';
    this.allocatorKey = `p2tr_multisig_prefund:${config.pearlNetwork}:${this.derivationPrefix}`;
  }

  async allocatePrefundEscrow(input: PrefundAllocateInput): Promise<PrefundAllocateOutput> {
    assertPubkey(input.makerPearlPubkey, 'makerPearlPubkey');
    const refundDelayHours = this.config.pearlPrefundRefundDelayHours ?? 24;
    const refundEligibleAfterUnixTime = Math.floor(this.now().getTime() / 1000) + refundDelayHours * 3600;
    const expectedAmountGrains = parsePrlToGrains(input.amountPrl).toString();

    const payment = createPearlP2trPrefundEscrowPayment({
      network: getPearlScriptNetworkName(this.config.pearlNetwork),
      mode: input.mode,
      makerPubkey: input.makerPearlPubkey,
      operatorPubkey: this.config.pearlPrefundOperatorPubkey as string,
      ...(input.mode === 'auto_sweep'
        ? { arbiterPubkey: this.config.pearlEscrowArbiterPubkey as string }
        : {}),
      refundLockTime: refundEligibleAfterUnixTime,
      scriptNonceHex: createHash('sha256').update(`pearl-otc-prefund:${input.orderId}`).digest('hex'),
    });

    // Derivation index: deterministic SHA-256 of orderId to allow idempotent
    // reallocation on retries; the (allocator_key, derivation_prefix,
    // derivation_index) tuple is uniquely indexed in the DB.
    const derivationIndex = createHash('sha256').update(input.orderId).digest().readUInt32BE(0) & 0x7fffffff;
    const derivationPath = `m/${this.derivationPrefix}/${derivationIndex}`;

    const allocation: OrderPrefundAllocationInput = {
      orderId: input.orderId,
      allocatorKey: this.allocatorKey,
      derivationPrefix: this.derivationPrefix,
      derivationIndex,
      derivationPath,
      escrowAddress: payment.address,
      internalPubkeyHex: payment.internalPubkeyHex,
      taprootOutputScriptHex: payment.outputScriptHex,
      scriptLeaves: payment.leaves.map((leaf) => ({
        kind: leaf.kind,
        requiredSigners: [...leaf.requiredSigners],
        scriptHex: leaf.scriptHex,
        leafVersion: leaf.leafVersion,
        controlBlockHex: leaf.controlBlockHex,
        ...(leaf.lockTime == null ? {} : { lockTime: leaf.lockTime }),
      })),
      signerPubkeys: {
        maker: normalizeXOnlyHex(input.makerPearlPubkey),
        operator: normalizeXOnlyHex(this.config.pearlPrefundOperatorPubkey as string),
        ...(input.mode === 'auto_sweep'
          ? { arbiter: normalizeXOnlyHex(this.config.pearlEscrowArbiterPubkey as string) }
          : {}),
      },
    };
    const reserved = await this.repository.reserveOrderPrefundAllocation(allocation);
    this.assertReservedMatchesPayment(reserved.allocation, payment.address);

    return {
      network: this.config.pearlNetwork,
      mode: input.mode,
      escrowAddress: payment.address,
      expectedAmountGrains,
      requiredConfirmations: this.config.pearlEscrowConfirmations,
      refundEligibleAfterUnixTime,
      internalPubkeyHex: payment.internalPubkeyHex,
      taprootOutputScriptHex: payment.outputScriptHex,
    };
  }

  private assertReservedMatchesPayment(allocation: OrderPrefundAllocation, expectedAddress: string): void {
    if (allocation.escrowAddress !== expectedAddress) {
      throw new Error(
        `persisted Pearl prefund allocation mismatch for ${allocation.orderId}: address differs from rebuild`,
      );
    }
  }
}

function getPearlScriptNetworkName(network: OtcApiConfig['pearlNetwork']): Parameters<typeof createPearlP2trPrefundEscrowPayment>[0]['network'] {
  if (network === 'mainnet' || network === 'testnet' || network === 'testnet2' || network === 'simnet' || network === 'regtest') {
    return network;
  }
  throw new Error(`unsupported pearl network: ${network}`);
}

function normalizeXOnlyHex(value: string): string {
  const trimmed = value.trim().toLowerCase().replace(/^0x/, '');
  if (trimmed.length === 64) return trimmed;
  if (trimmed.length === 66 && (trimmed.startsWith('02') || trimmed.startsWith('03'))) {
    return trimmed.slice(2);
  }
  throw new Error(`expected x-only or compressed secp256k1 pubkey, got ${value.length} chars`);
}
