import { initEccLib, Psbt, Transaction } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';

import { getPearlScriptNetwork, type PearlScriptNetworkName } from '@kaspacom/pearl-script';

import type {
  PearlEscrowPackage,
  PearlEscrowSignerRole,
  PearlEscrowTaprootScriptLeaf,
} from './types.js';

let eccInitialized = false;

function ensureEcc(): void {
  if (!eccInitialized) {
    initEccLib(ecc);
    eccInitialized = true;
  }
}

export type PearlMultisigLeafKind =
  | 'buyer_seller_release'
  | 'buyer_arbiter_release'
  | 'seller_arbiter_release'
  | 'seller_timeout_refund';

export interface PearlEscrowScriptPathSigner {
  publicKey: Buffer;
  sign(hash: Buffer): Buffer;
  signSchnorr(hash: Buffer): Buffer;
}

export interface PearlEscrowScriptPathSpendInput {
  escrow: PearlEscrowPackage;
  leafKind: PearlMultisigLeafKind;
  fundingTxid: string;
  vout: number;
  amountGrains: number;
  destinationAddress: string;
  destinationAmountGrains: number;
  signers: readonly PearlEscrowScriptPathSigner[];
  lockTime?: number;
  sequence?: number;
}

export interface PearlEscrowScriptPathPartialPsbtInput {
  escrow: PearlEscrowPackage;
  leafKind: PearlMultisigLeafKind;
  fundingTxid: string;
  vout: number;
  amountGrains: number;
  destinationAddress: string;
  destinationAmountGrains: number;
  signers?: readonly PearlEscrowScriptPathSigner[];
  lockTime?: number;
  sequence?: number;
}

export interface PearlEscrowScriptPathPartialPsbtResult {
  psbtBase64: string;
  signedRoles: readonly PearlEscrowSignerRole[];
}

export interface PearlEscrowScriptPathCombineInput {
  psbtBase64: string;
  network: PearlScriptNetworkName;
  signers?: readonly PearlEscrowScriptPathSigner[];
}

export interface PearlEscrowScriptPathCombineResult {
  signedTxHex: string;
  signedTxid: string;
}

export function selectMultisigLeaf(
  escrow: PearlEscrowPackage,
  leafKind: PearlMultisigLeafKind,
): PearlEscrowTaprootScriptLeaf {
  const leaves = escrow.keys.taprootScriptLeaves ?? [];
  const leaf = leaves.find((candidate) => candidate.kind === leafKind);
  if (!leaf?.scriptHex || !leaf.controlBlockHex || leaf.leafVersion === undefined) {
    throw new Error(`Pearl escrow leaf metadata is missing for ${leafKind}`);
  }
  return leaf;
}

export function createPearlEscrowScriptPathSpendTx(input: PearlEscrowScriptPathSpendInput): string {
  ensureEcc();
  const leaf = selectMultisigLeaf(input.escrow, input.leafKind);
  const network = getPearlScriptNetwork(input.escrow.network);
  const psbt = new Psbt({ network });
  psbt.setVersion(2);
  if (input.lockTime !== undefined) {
    psbt.setLocktime(input.lockTime);
  }
  psbt.addInput({
    hash: input.fundingTxid,
    index: input.vout,
    sequence: input.sequence,
    witnessUtxo: {
      script: Buffer.from(input.escrow.keys.taprootOutputScriptHex, 'hex'),
      value: input.amountGrains,
    },
    tapInternalKey: Buffer.from(input.escrow.keys.internalPubkeyHex, 'hex'),
    tapLeafScript: [
      {
        leafVersion: leaf.leafVersion!,
        script: Buffer.from(leaf.scriptHex, 'hex'),
        controlBlock: Buffer.from(leaf.controlBlockHex!, 'hex'),
      },
    ],
  });
  psbt.addOutput({
    address: input.destinationAddress,
    value: input.destinationAmountGrains,
  });
  for (const signer of input.signers) {
    psbt.signTaprootInput(0, signer);
  }
  psbt.finalizeTaprootInput(0);
  return psbt.extractTransaction(true).toHex();
}

export function buildPartialPearlEscrowScriptPathPsbt(
  input: PearlEscrowScriptPathPartialPsbtInput,
): PearlEscrowScriptPathPartialPsbtResult {
  ensureEcc();
  const leaf = selectMultisigLeaf(input.escrow, input.leafKind);
  const network = getPearlScriptNetwork(input.escrow.network);
  const psbt = new Psbt({ network });
  psbt.setVersion(2);
  if (input.lockTime !== undefined) {
    psbt.setLocktime(input.lockTime);
  }
  psbt.addInput({
    hash: input.fundingTxid,
    index: input.vout,
    sequence: input.sequence,
    witnessUtxo: {
      script: Buffer.from(input.escrow.keys.taprootOutputScriptHex, 'hex'),
      value: input.amountGrains,
    },
    tapInternalKey: Buffer.from(input.escrow.keys.internalPubkeyHex, 'hex'),
    tapLeafScript: [
      {
        leafVersion: leaf.leafVersion!,
        script: Buffer.from(leaf.scriptHex, 'hex'),
        controlBlock: Buffer.from(leaf.controlBlockHex!, 'hex'),
      },
    ],
  });
  psbt.addOutput({
    address: input.destinationAddress,
    value: input.destinationAmountGrains,
  });
  const signedRoles: PearlEscrowSignerRole[] = [];
  if (input.signers) {
    for (const signer of input.signers) {
      psbt.signTaprootInput(0, signer);
      const role = signerRoleForPubkey(input.escrow, signer.publicKey);
      if (role) signedRoles.push(role);
    }
  }
  return { psbtBase64: psbt.toBase64(), signedRoles };
}

export function combinePearlEscrowScriptPathPsbt(
  input: PearlEscrowScriptPathCombineInput,
): PearlEscrowScriptPathCombineResult {
  ensureEcc();
  const network = getPearlScriptNetwork(input.network);
  const psbt = Psbt.fromBase64(input.psbtBase64, { network });
  if (input.signers) {
    for (const signer of input.signers) {
      psbt.signTaprootInput(0, signer);
    }
  }
  psbt.finalizeTaprootInput(0);
  const tx = psbt.extractTransaction(true);
  assertScriptPathWitnessComplete(tx);
  return { signedTxHex: tx.toHex(), signedTxid: tx.getId() };
}

function assertScriptPathWitnessComplete(tx: Transaction): void {
  const witness = tx.ins[0]?.witness ?? [];
  if (witness.length < 3) {
    throw new Error('Pearl escrow script-path witness is missing script or control block');
  }
  const script = witness[witness.length - 2]!;
  const sigCount = witness.length - 2;
  const expectedSigCount = countScriptSigOpcodes(script);
  if (sigCount !== expectedSigCount) {
    throw new Error(
      `Pearl escrow script-path witness has ${sigCount} signatures but the leaf script requires ${expectedSigCount}`,
    );
  }
  for (let i = 0; i < sigCount; i += 1) {
    const sig = witness[i]!;
    if (sig.length !== 64 && sig.length !== 65) {
      throw new Error(`Pearl escrow script-path witness signature ${i} has invalid length ${sig.length}`);
    }
  }
}

function countScriptSigOpcodes(script: Buffer): number {
  const OP_CHECKSIG = 0xac;
  const OP_CHECKSIGADD = 0xba;
  let count = 0;
  let cursor = 0;
  while (cursor < script.length) {
    const op = script[cursor]!;
    if (op === OP_CHECKSIG || op === OP_CHECKSIGADD) {
      count += 1;
      cursor += 1;
      continue;
    }
    // Skip the pushed-data payload so opcode bytes inside a push are not miscounted.
    if (op >= 0x01 && op <= 0x4b) {
      cursor += 1 + op;
      continue;
    }
    if (op === 0x4c) {
      const len = script[cursor + 1] ?? 0;
      cursor += 2 + len;
      continue;
    }
    if (op === 0x4d) {
      const len = script.readUInt16LE(cursor + 1);
      cursor += 3 + len;
      continue;
    }
    if (op === 0x4e) {
      const len = script.readUInt32LE(cursor + 1);
      cursor += 5 + len;
      continue;
    }
    cursor += 1;
  }
  return count;
}

function signerRoleForPubkey(
  escrow: PearlEscrowPackage,
  publicKey: Buffer,
): PearlEscrowSignerRole | undefined {
  const xOnly = publicKey.length === 33 ? publicKey.subarray(1) : publicKey;
  const hex = Buffer.from(xOnly).toString('hex').toLowerCase();
  const entries = Object.entries(escrow.keys.signerPubkeys ?? {});
  for (const [role, pubkeyHex] of entries) {
    if (!pubkeyHex) continue;
    if (pubkeyHex.toLowerCase() === hex) {
      return role as PearlEscrowSignerRole;
    }
  }
  return undefined;
}
