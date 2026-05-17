import { createHash } from 'node:crypto';

import { createPearlEscrowPackage } from '@kaspacom/pearl-escrow';
import { getPearlScriptNetwork } from '@kaspacom/pearl-script';
import { parsePrlToGrains } from '@kaspacom/pearl-sdk';
import { BIP32Factory, type BIP32Interface } from 'bip32';
import * as ecc from 'tiny-secp256k1';

import type { PearlEscrowAllocator } from './trade-service.js';
import type { OtcApiConfig } from './types.js';

const bip32 = BIP32Factory(ecc);
const BIP32_HARDENED_OFFSET = 0x80000000;

export function createConfiguredPearlEscrowAllocator(config: OtcApiConfig): PearlEscrowAllocator {
  if (config.pearlEscrowAllocator === 'mock') {
    return {
      allocateEscrow(input) {
        return {
          network: input.config.pearlNetwork,
          address: `mock:${input.tradeId}`,
          expectedAmountGrains: (parsePrlToGrains(input.quote.amountPrl) + parsePrlToGrains(input.quote.feePrl)).toString(),
          requiredConfirmations: input.config.pearlEscrowConfirmations,
        };
      },
    };
  }
  if (config.pearlEscrowAllocator !== 'p2tr_xpub') {
    throw new Error(`unsupported Pearl escrow allocator: ${config.pearlEscrowAllocator}`);
  }
  if (!config.pearlEscrowXpub) {
    throw new Error('PEARL_ESCROW_XPUB is required when PEARL_ESCROW_ALLOCATOR=p2tr_xpub');
  }
  return new XpubPearlEscrowAllocator(config);
}

export class XpubPearlEscrowAllocator implements PearlEscrowAllocator {
  private readonly root: BIP32Interface;
  private readonly prefix: readonly number[];
  private readonly config: OtcApiConfig;

  constructor(config: OtcApiConfig) {
    if (!config.pearlEscrowXpub) {
      throw new Error('pearlEscrowXpub is required');
    }
    this.config = config;
    this.root = bip32.fromBase58(config.pearlEscrowXpub, getPearlScriptNetwork(config.pearlNetwork));
    this.prefix = parseDerivationPrefix(config.pearlEscrowDerivationPrefix);
  }

  allocateEscrow(input: Parameters<PearlEscrowAllocator['allocateEscrow']>[0]) {
    const index = deriveTradeIndex(input.tradeId);
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

    return {
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
  }
}

function deriveChild(root: BIP32Interface, path: readonly number[]): BIP32Interface {
  let node = root;
  for (const index of path) {
    node = node.derive(index);
  }
  return node;
}

function deriveTradeIndex(tradeId: string): number {
  return createHash('sha256').update(tradeId).digest().readUInt32BE(0) & 0x7fffffff;
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
