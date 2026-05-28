import { address as bitcoinAddress, initEccLib, Psbt } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';

import { getPearlScriptNetwork } from '@kaspacom/pearl-script';

import type { PearlEscrowPackage } from './types.js';

let eccInitialized = false;
function ensureEcc(): void {
  if (!eccInitialized) {
    initEccLib(ecc);
    eccInitialized = true;
  }
}

export interface BuyerPreauthorizedReleasePresignatureCanonical {
  escrow: PearlEscrowPackage;
  destinationAddress: string;
  outputAmountGrains: string;
  fundingOutpoint: string;
  buyerPubkey: string;
}

export interface ValidateBuyerPreauthorizedReleasePsbtInput
  extends BuyerPreauthorizedReleasePresignatureCanonical {
  psbtBase64: string;
}

export interface ValidatedBuyerPreauthorizedReleasePsbt {
  psbtBase64: string;
  buyerPubkey: string;
  leafKind: 'buyer_arbiter_release';
  destinationAddress: string;
  outputAmountGrains: string;
  feeGrains: string;
  fundingOutpoint: string;
}

const ACCEPTABLE_BUYER_LEAF_KIND = 'buyer_arbiter_release';

export function validateBuyerPreauthorizedReleasePsbt(
  input: ValidateBuyerPreauthorizedReleasePsbtInput,
): ValidatedBuyerPreauthorizedReleasePsbt {
  ensureEcc();
  if (!input.psbtBase64 || input.psbtBase64.length > 200_000) {
    throw new Error('psbtBase64 must be a non-empty string under 200000 chars');
  }
  const network = getPearlScriptNetwork(input.escrow.network);
  const psbt = Psbt.fromBase64(input.psbtBase64, { network });

  if (psbt.inputCount !== 1) {
    throw new Error('preauthorized release PSBT must have exactly one input');
  }
  if (psbt.txOutputs.length !== 1) {
    throw new Error('preauthorized release PSBT must have exactly one output');
  }

  const expectedOutpoint = parseOutpoint(input.fundingOutpoint);
  const txInput = psbt.txInputs[0]!;
  const txInputTxid = Buffer.from(txInput.hash).reverse().toString('hex').toLowerCase();
  if (txInputTxid !== expectedOutpoint.txid || txInput.index !== expectedOutpoint.vout) {
    throw new Error('preauthorized release PSBT input does not match the trade funding outpoint');
  }

  const inputData = psbt.data.inputs[0]!;
  if (!inputData.witnessUtxo) {
    throw new Error('preauthorized release PSBT input must include witnessUtxo');
  }
  const expectedScript = Buffer.from(input.escrow.keys.taprootOutputScriptHex, 'hex');
  if (!inputData.witnessUtxo.script.equals(expectedScript)) {
    throw new Error('preauthorized release PSBT input witnessUtxo script does not match escrow output script');
  }
  const expectedInputValue = BigInt(input.escrow.expectedAmountGrains);
  if (BigInt(inputData.witnessUtxo.value) !== expectedInputValue) {
    throw new Error('preauthorized release PSBT input witnessUtxo value does not match escrow expected amount');
  }

  const expectedInternalKey = Buffer.from(input.escrow.keys.internalPubkeyHex, 'hex');
  if (!inputData.tapInternalKey || !inputData.tapInternalKey.equals(expectedInternalKey)) {
    throw new Error('preauthorized release PSBT input tapInternalKey does not match escrow internal pubkey');
  }

  const tapLeafScripts = inputData.tapLeafScript ?? [];
  if (tapLeafScripts.length !== 1) {
    throw new Error(`preauthorized release PSBT input must contain exactly one tapLeafScript, got ${tapLeafScripts.length}`);
  }
  const tapLeafScript = tapLeafScripts[0]!;
  const expectedLeaf = (input.escrow.keys.taprootScriptLeaves ?? []).find(
    (leaf) => leaf.kind === ACCEPTABLE_BUYER_LEAF_KIND,
  );
  if (!expectedLeaf || !expectedLeaf.scriptHex || !expectedLeaf.controlBlockHex) {
    throw new Error(`escrow does not expose the ${ACCEPTABLE_BUYER_LEAF_KIND} leaf`);
  }
  const expectedScriptBuf = Buffer.from(expectedLeaf.scriptHex, 'hex');
  const expectedControlBuf = Buffer.from(expectedLeaf.controlBlockHex, 'hex');
  if (!tapLeafScript.script.equals(expectedScriptBuf)) {
    throw new Error('preauthorized release PSBT tapLeafScript script does not match buyer_arbiter_release leaf');
  }
  if (!tapLeafScript.controlBlock.equals(expectedControlBuf)) {
    throw new Error('preauthorized release PSBT tapLeafScript controlBlock does not match buyer_arbiter_release leaf');
  }
  if ((tapLeafScript.leafVersion ?? 0xc0) !== (expectedLeaf.leafVersion ?? 0xc0)) {
    throw new Error('preauthorized release PSBT tapLeafScript leafVersion mismatch');
  }

  const txOutput = psbt.txOutputs[0]!;
  const expectedDestinationScript = bitcoinAddress.toOutputScript(input.destinationAddress, network);
  if (!Buffer.from(txOutput.script).equals(expectedDestinationScript)) {
    throw new Error('preauthorized release PSBT output script does not match the trade buyer Pearl address');
  }
  const expectedOutputValue = BigInt(input.outputAmountGrains);
  if (BigInt(txOutput.value) !== expectedOutputValue) {
    throw new Error('preauthorized release PSBT output value does not match expected release amount');
  }

  if (psbt.locktime !== 0) {
    throw new Error('preauthorized release PSBT must have locktime 0 (only refund leaf uses CLTV)');
  }

  const buyerSigEntry = (inputData.tapScriptSig ?? []).find(
    (entry) =>
      entry.pubkey.toString('hex').toLowerCase() === stripHex(input.buyerPubkey).toLowerCase(),
  );
  if (!buyerSigEntry) {
    throw new Error('preauthorized release PSBT does not contain a Schnorr signature from the buyer pubkey');
  }
  if (buyerSigEntry.signature.length !== 64) {
    throw new Error(
      `preauthorized release PSBT buyer signature must be 64 bytes (SIGHASH_DEFAULT), got ${buyerSigEntry.signature.length} bytes`,
    );
  }

  const feeGrains = (expectedInputValue - expectedOutputValue).toString();
  if (BigInt(feeGrains) < 0n) {
    throw new Error('preauthorized release PSBT fee must be non-negative');
  }

  return {
    psbtBase64: psbt.toBase64(),
    buyerPubkey: stripHex(input.buyerPubkey).toLowerCase(),
    leafKind: 'buyer_arbiter_release',
    destinationAddress: input.destinationAddress,
    outputAmountGrains: input.outputAmountGrains,
    feeGrains,
    fundingOutpoint: input.fundingOutpoint,
  };
}

function parseOutpoint(outpoint: string): { txid: string; vout: number } {
  const [txid, voutRaw, extra] = outpoint.split(':');
  if (!txid || !voutRaw || extra != null) {
    throw new Error('outpoint must be formatted as txid:vout');
  }
  if (!/^[0-9a-fA-F]{64}$/.test(txid)) {
    throw new Error('outpoint txid must be 32-byte hex');
  }
  const vout = Number(voutRaw);
  if (!Number.isInteger(vout) || vout < 0) {
    throw new Error('outpoint vout must be a non-negative integer');
  }
  return { txid: txid.toLowerCase(), vout };
}

function stripHex(value: string): string {
  return value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value;
}
