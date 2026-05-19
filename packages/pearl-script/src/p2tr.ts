import { initEccLib, opcodes, payments, script } from 'bitcoinjs-lib';
import type { Taptree } from 'bitcoinjs-lib/src/types.js';
import * as ecc from 'tiny-secp256k1';

import { getPearlScriptNetwork, type PearlScriptNetworkName } from './network.js';

let eccInitialized = false;

export interface PearlP2trPayment {
  network: PearlScriptNetworkName;
  address: string;
  outputScriptHex: string;
  internalPubkeyHex: string;
}

export type PearlMultisigEscrowLeafKind =
  | 'buyer_seller_release'
  | 'buyer_arbiter_release'
  | 'seller_arbiter_release'
  | 'seller_timeout_refund';

export interface PearlMultisigEscrowLeaf {
  kind: PearlMultisigEscrowLeafKind;
  requiredSigners: readonly ('buyer' | 'seller' | 'arbiter')[];
  scriptHex: string;
  lockTime?: number;
}

export interface PearlP2trMultisigEscrowPayment extends PearlP2trPayment {
  leaves: PearlMultisigEscrowLeaf[];
}

export function createPearlP2trPayment(input: {
  network: PearlScriptNetworkName;
  internalPubkey: string | Uint8Array;
}): PearlP2trPayment {
  ensureEccInitialized();
  const internalPubkey = normalizeXOnlyPubkey(input.internalPubkey);
  const payment = payments.p2tr({
    internalPubkey: Buffer.from(internalPubkey),
    network: getPearlScriptNetwork(input.network),
  });
  if (!payment.address || !payment.output) {
    throw new Error('failed to construct Pearl P2TR payment');
  }
  return {
    network: input.network,
    address: payment.address,
    outputScriptHex: Buffer.from(payment.output).toString('hex'),
    internalPubkeyHex: Buffer.from(internalPubkey).toString('hex'),
  };
}

export function createPearlP2trMultisigEscrowPayment(input: {
  network: PearlScriptNetworkName;
  internalPubkey: string | Uint8Array;
  buyerPubkey: string | Uint8Array;
  sellerPubkey: string | Uint8Array;
  arbiterPubkey: string | Uint8Array;
  refundLockTime?: number;
}): PearlP2trMultisigEscrowPayment {
  ensureEccInitialized();
  const internalPubkey = normalizeXOnlyPubkey(input.internalPubkey);
  const buyerPubkey = normalizeXOnlyPubkey(input.buyerPubkey);
  const sellerPubkey = normalizeXOnlyPubkey(input.sellerPubkey);
  const arbiterPubkey = normalizeXOnlyPubkey(input.arbiterPubkey);
  if (input.refundLockTime == null) {
    throw new Error('refundLockTime is required for multisig escrow timeout refund leaf');
  }
  const leaves = [
    createTwoOfTwoLeaf('buyer_seller_release', buyerPubkey, sellerPubkey, ['buyer', 'seller']),
    createTwoOfTwoLeaf('buyer_arbiter_release', buyerPubkey, arbiterPubkey, ['buyer', 'arbiter']),
    createTwoOfTwoLeaf('seller_arbiter_release', sellerPubkey, arbiterPubkey, ['seller', 'arbiter']),
    createTimeoutRefundLeaf(sellerPubkey, input.refundLockTime),
  ];
  const scriptTree: Taptree = [
    [{ output: Buffer.from(leaves[0].scriptHex, 'hex') }, { output: Buffer.from(leaves[1].scriptHex, 'hex') }],
    [{ output: Buffer.from(leaves[2].scriptHex, 'hex') }, { output: Buffer.from(leaves[3].scriptHex, 'hex') }],
  ];
  const payment = payments.p2tr({
    internalPubkey: Buffer.from(internalPubkey),
    scriptTree,
    network: getPearlScriptNetwork(input.network),
  });
  if (!payment.address || !payment.output) {
    throw new Error('failed to construct Pearl P2TR multisig escrow payment');
  }
  return {
    network: input.network,
    address: payment.address,
    outputScriptHex: Buffer.from(payment.output).toString('hex'),
    internalPubkeyHex: Buffer.from(internalPubkey).toString('hex'),
    leaves,
  };
}

export function normalizeXOnlyPubkey(pubkey: string | Uint8Array): Uint8Array {
  const bytes = typeof pubkey === 'string' ? Buffer.from(stripHexPrefix(pubkey), 'hex') : pubkey;
  if (bytes.length === 32) {
    return Uint8Array.from(bytes);
  }
  if (bytes.length === 33 && (bytes[0] === 0x02 || bytes[0] === 0x03)) {
    return Uint8Array.from(bytes.slice(1));
  }
  throw new Error(`expected x-only or compressed public key, got ${bytes.length} bytes`);
}

function ensureEccInitialized(): void {
  if (!eccInitialized) {
    initEccLib(ecc);
    eccInitialized = true;
  }
}

function stripHexPrefix(value: string): string {
  return value.startsWith('0x') ? value.slice(2) : value;
}

function createTwoOfTwoLeaf(
  kind: Extract<PearlMultisigEscrowLeafKind, 'buyer_seller_release' | 'buyer_arbiter_release' | 'seller_arbiter_release'>,
  firstPubkey: Uint8Array,
  secondPubkey: Uint8Array,
  requiredSigners: PearlMultisigEscrowLeaf['requiredSigners'],
): PearlMultisigEscrowLeaf {
  const output = script.compile([
    Buffer.from(firstPubkey),
    opcodes.OP_CHECKSIG,
    Buffer.from(secondPubkey),
    opcodes.OP_CHECKSIGADD,
    opcodes.OP_2,
    opcodes.OP_NUMEQUAL,
  ]);
  return {
    kind,
    requiredSigners,
    scriptHex: Buffer.from(output).toString('hex'),
  };
}

function createTimeoutRefundLeaf(sellerPubkey: Uint8Array, lockTime: number): PearlMultisigEscrowLeaf {
  if (!Number.isInteger(lockTime) || lockTime <= 0) {
    throw new Error('refundLockTime must be a positive integer');
  }
  const output = script.compile([
    script.number.encode(lockTime),
    opcodes.OP_CHECKLOCKTIMEVERIFY,
    opcodes.OP_DROP,
    Buffer.from(sellerPubkey),
    opcodes.OP_CHECKSIG,
  ]);
  return {
    kind: 'seller_timeout_refund',
    requiredSigners: ['seller'],
    scriptHex: Buffer.from(output).toString('hex'),
    lockTime,
  };
}
