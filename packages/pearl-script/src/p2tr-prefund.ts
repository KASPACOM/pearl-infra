import { initEccLib, opcodes, payments, script } from 'bitcoinjs-lib';
import type { Taptree } from 'bitcoinjs-lib/src/types.js';
import * as ecc from 'tiny-secp256k1';

import { getPearlScriptNetwork, type PearlScriptNetworkName } from './network.js';
import {
  BIP341_NUMS_INTERNAL_PUBKEY_HEX,
  normalizeXOnlyPubkey,
  type PearlP2trPayment,
} from './p2tr.js';

let eccInitialized = false;

function ensureEccInitialized(): void {
  if (!eccInitialized) {
    initEccLib(ecc);
    eccInitialized = true;
  }
}

// Prefund escrow leaves — distinct from trade-escrow leaves because the
// counterparty model is different. A prefund escrow holds the maker's pool
// while the order sits on the order book; sweeps move PRL into per-trade
// escrows when takers match.
export type PearlPrefundEscrowLeafKind =
  | 'operator_arbiter_sweep' // Mode A: operator+arbiter co-sign, maker passive
  | 'maker_operator_sweep'   // Mode B: maker+operator co-sign at match time
  | 'maker_timeout_refund';  // Both modes: maker reclaims after CLTV expiry

export type PearlPrefundEscrowSignerRole = 'maker' | 'operator' | 'arbiter';

export interface PearlPrefundEscrowLeaf {
  kind: PearlPrefundEscrowLeafKind;
  requiredSigners: readonly PearlPrefundEscrowSignerRole[];
  scriptHex: string;
  leafVersion: number;
  controlBlockHex: string;
  lockTime?: number;
}

export type PearlPrefundMode = 'auto_sweep' | 'manual_confirm';

export interface PearlP2trPrefundEscrowPayment extends PearlP2trPayment {
  internalKeyPolicy: 'bip341_nums_script_path_only';
  mode: PearlPrefundMode;
  leaves: PearlPrefundEscrowLeaf[];
}

export interface CreatePearlP2trPrefundEscrowPaymentInput {
  network: PearlScriptNetworkName;
  mode: PearlPrefundMode;
  makerPubkey: string | Uint8Array;
  operatorPubkey: string | Uint8Array;
  // Required for Mode A (auto_sweep). Must be undefined for Mode B (manual_confirm).
  arbiterPubkey?: string | Uint8Array;
  refundLockTime: number;
  scriptNonceHex?: string;
}

export function createPearlP2trPrefundEscrowPayment(
  input: CreatePearlP2trPrefundEscrowPaymentInput,
): PearlP2trPrefundEscrowPayment {
  ensureEccInitialized();
  const internalPubkey = normalizeXOnlyPubkey(BIP341_NUMS_INTERNAL_PUBKEY_HEX);
  const maker = normalizeXOnlyPubkey(input.makerPubkey);
  const operator = normalizeXOnlyPubkey(input.operatorPubkey);
  assertDistinctSigners([
    ['maker', maker],
    ['operator', operator],
  ]);

  if (!Number.isInteger(input.refundLockTime) || input.refundLockTime <= 0) {
    throw new Error('refundLockTime must be a positive integer');
  }
  const scriptNonce = input.scriptNonceHex ? normalizeScriptNonce(input.scriptNonceHex) : undefined;

  let sweepLeaf: Omit<PearlPrefundEscrowLeaf, 'controlBlockHex'>;
  if (input.mode === 'auto_sweep') {
    if (!input.arbiterPubkey) {
      throw new Error('arbiterPubkey is required for auto_sweep prefund escrow');
    }
    const arbiter = normalizeXOnlyPubkey(input.arbiterPubkey);
    assertDistinctSigners([
      ['maker', maker],
      ['operator', operator],
      ['arbiter', arbiter],
    ]);
    sweepLeaf = createTwoOfTwoLeaf(
      'operator_arbiter_sweep',
      operator,
      arbiter,
      ['operator', 'arbiter'],
      scriptNonce,
    );
  } else if (input.mode === 'manual_confirm') {
    if (input.arbiterPubkey != null) {
      throw new Error('arbiterPubkey must not be provided for manual_confirm prefund escrow');
    }
    sweepLeaf = createTwoOfTwoLeaf(
      'maker_operator_sweep',
      maker,
      operator,
      ['maker', 'operator'],
      scriptNonce,
    );
  } else {
    throw new Error(`unknown prefund mode: ${input.mode satisfies never}`);
  }

  const refundLeaf = createMakerTimeoutRefundLeaf(maker, input.refundLockTime, scriptNonce);
  const leavesWithoutControlBlock = [sweepLeaf, refundLeaf];
  const scriptTree: Taptree = [
    { output: Buffer.from(sweepLeaf.scriptHex, 'hex') },
    { output: Buffer.from(refundLeaf.scriptHex, 'hex') },
  ];
  const payment = payments.p2tr({
    internalPubkey: Buffer.from(internalPubkey),
    scriptTree,
    network: getPearlScriptNetwork(input.network),
  });
  if (!payment.address || !payment.output) {
    throw new Error('failed to construct Pearl P2TR prefund escrow payment');
  }
  const leaves = leavesWithoutControlBlock.map((leaf) =>
    addControlBlockToLeaf(leaf, internalPubkey, scriptTree, input.network),
  );
  return {
    network: input.network,
    mode: input.mode,
    address: payment.address,
    outputScriptHex: Buffer.from(payment.output).toString('hex'),
    internalPubkeyHex: Buffer.from(internalPubkey).toString('hex'),
    internalKeyPolicy: 'bip341_nums_script_path_only',
    leaves,
  };
}

function createTwoOfTwoLeaf(
  kind: Extract<PearlPrefundEscrowLeafKind, 'operator_arbiter_sweep' | 'maker_operator_sweep'>,
  firstPubkey: Uint8Array,
  secondPubkey: Uint8Array,
  requiredSigners: readonly PearlPrefundEscrowSignerRole[],
  scriptNonce?: Uint8Array,
): Omit<PearlPrefundEscrowLeaf, 'controlBlockHex'> {
  const output = script.compile([
    ...scriptNoncePrefix(scriptNonce),
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
    leafVersion: 0xc0,
  };
}

function createMakerTimeoutRefundLeaf(
  makerPubkey: Uint8Array,
  lockTime: number,
  scriptNonce?: Uint8Array,
): Omit<PearlPrefundEscrowLeaf, 'controlBlockHex'> {
  const output = script.compile([
    ...scriptNoncePrefix(scriptNonce),
    script.number.encode(lockTime),
    opcodes.OP_CHECKLOCKTIMEVERIFY,
    opcodes.OP_DROP,
    Buffer.from(makerPubkey),
    opcodes.OP_CHECKSIG,
  ]);
  return {
    kind: 'maker_timeout_refund',
    requiredSigners: ['maker'],
    scriptHex: Buffer.from(output).toString('hex'),
    leafVersion: 0xc0,
    lockTime,
  };
}

function assertDistinctSigners(entries: readonly (readonly [string, Uint8Array])[]): void {
  const seen = new Map<string, string>();
  for (const [role, pubkey] of entries) {
    const hex = Buffer.from(pubkey).toString('hex');
    const existingRole = seen.get(hex);
    if (existingRole) {
      throw new Error(`prefund signer pubkeys must be distinct: ${role} duplicates ${existingRole}`);
    }
    seen.set(hex, role);
  }
}

function normalizeScriptNonce(value: string): Uint8Array {
  const normalized = value.startsWith('0x') ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]+$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error('scriptNonceHex must be even-length hex');
  }
  const bytes = Buffer.from(normalized, 'hex');
  if (bytes.length === 0 || bytes.length > 80) {
    throw new Error('scriptNonceHex must be between 1 and 80 bytes');
  }
  return Uint8Array.from(bytes);
}

function scriptNoncePrefix(scriptNonce?: Uint8Array): Array<Buffer | number> {
  return scriptNonce ? [Buffer.from(scriptNonce), opcodes.OP_DROP] : [];
}

function addControlBlockToLeaf(
  leaf: Omit<PearlPrefundEscrowLeaf, 'controlBlockHex'>,
  internalPubkey: Uint8Array,
  scriptTree: Taptree,
  network: PearlScriptNetworkName,
): PearlPrefundEscrowLeaf {
  const scriptOutput = Buffer.from(leaf.scriptHex, 'hex');
  const payment = payments.p2tr({
    internalPubkey: Buffer.from(internalPubkey),
    scriptTree,
    redeem: {
      output: scriptOutput,
      redeemVersion: leaf.leafVersion,
    },
    network: getPearlScriptNetwork(network),
  });
  const controlBlock = payment.witness?.[1];
  if (!controlBlock) {
    throw new Error(`failed to compute Taproot control block for ${leaf.kind}`);
  }
  return {
    ...leaf,
    controlBlockHex: Buffer.from(controlBlock).toString('hex'),
  };
}
