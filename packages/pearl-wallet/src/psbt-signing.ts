import { initEccLib, Psbt } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';

import {
  getPearlScriptNetwork,
  type PearlPrefundEscrowLeaf,
  type PearlScriptNetworkName,
} from '@kaspacom/pearl-script';

let eccInitialized = false;

function ensureEcc(): void {
  if (!eccInitialized) {
    initEccLib(ecc);
    eccInitialized = true;
  }
}

/**
 * The L-PR-3 security contract: what the caller (UI, ultimately the maker
 * reviewing in a wallet popup) expects the PSBT to do. We validate every
 * field of this contract before adding any signature so a malicious server
 * cannot trick the user into signing a PSBT that, e.g., diverts the prefund
 * grains to an attacker address.
 *
 * Discrepancies are surfaced as explicit errors — the UI should render them
 * verbatim so the user knows exactly what didn't match.
 */
export interface PearlPrefundSpendContract {
  /** Single input the maker is authorising. Format: "txid:vout". */
  expectedInputOutpoint: string;
  /** Total grains the input UTXO is worth (the prefund balance being spent). */
  expectedInputAmountGrains: number;
  /**
   * Outputs the maker authorises, in ORDER. Length 1 (full sweep) or 2
   * (partial sweep with change back to prefund + main output, OR refund
   * sweep with single output back to maker).
   */
  expectedOutputs: ReadonlyArray<{ address: string; amountGrains: number }>;
  /**
   * Upper bound on the network fee. The PSBT's implied fee
   * (input - sum(outputs)) must be ≤ this. Reject anything larger so a
   * server-side bug or attack can't drain prefund grains as "fee".
   */
  feeCapGrains: number;
}

export interface PearlPrefundSigningInput {
  /** PSBT to validate and sign — typically prepared by the server. */
  psbtBase64: string;
  /** Which Taproot leaf the maker's key signs against. */
  leaf: PearlPrefundEscrowLeaf;
  /** 32-byte raw secret derived via deriveOrderKey. */
  privkey: Uint8Array;
  network: PearlScriptNetworkName;
  /** L-PR-3 contract; enforced before signing. */
  contract: PearlPrefundSpendContract;
}

export interface PearlPrefundSigningResult {
  signedPsbtBase64: string;
  /** x-only pubkey we signed with — caller can verify it matches expectations. */
  signedXOnlyPubkey: Uint8Array;
}

/**
 * Validates the PSBT against the L-PR-3 contract and signs with the provided
 * key. Throws on ANY validation mismatch; never partially signs.
 *
 * What we check before signing:
 *   1. PSBT has exactly one input.
 *   2. That input's outpoint matches `contract.expectedInputOutpoint`.
 *   3. That input's value matches `contract.expectedInputAmountGrains`.
 *   4. PSBT has exactly `contract.expectedOutputs.length` outputs.
 *   5. Each output's address + amount matches the contract (order-sensitive).
 *   6. Implied fee ≤ `contract.feeCapGrains`. Negative fee rejected (overspend).
 *   7. The leaf the PSBT is going to spend through matches the leaf the
 *      caller passed (the leaf script + control block + leaf version must
 *      all match what's in the PSBT's tapLeafScript field). Prevents a
 *      server from swapping the leaf to one the maker's key isn't supposed
 *      to authorise (e.g. forcing a sign through a non-existent path).
 */
export function validateAndSignPearlPrefundPsbt(
  input: PearlPrefundSigningInput,
): PearlPrefundSigningResult {
  ensureEcc();
  if (input.privkey.length !== 32) {
    throw new Error(`pearl-wallet privkey must be 32 bytes, got ${input.privkey.length}`);
  }
  const network = getPearlScriptNetwork(input.network);
  const psbt = Psbt.fromBase64(input.psbtBase64, { network });

  // ---- L-PR-3 structural validation ----

  if (psbt.txInputs.length !== 1) {
    throw new Error(`pearl prefund PSBT must have exactly 1 input, got ${psbt.txInputs.length}`);
  }
  const txInput = psbt.txInputs[0]!;
  const actualOutpoint = `${reverseHex(Buffer.from(txInput.hash).toString('hex'))}:${txInput.index}`;
  if (actualOutpoint.toLowerCase() !== input.contract.expectedInputOutpoint.toLowerCase()) {
    throw new Error(
      `pearl prefund PSBT input outpoint mismatch — expected ${input.contract.expectedInputOutpoint}, got ${actualOutpoint}`,
    );
  }

  const inputData = psbt.data.inputs[0]!;
  const witnessUtxo = inputData.witnessUtxo;
  if (!witnessUtxo) {
    throw new Error('pearl prefund PSBT input missing witnessUtxo');
  }
  if (witnessUtxo.value !== input.contract.expectedInputAmountGrains) {
    throw new Error(
      `pearl prefund PSBT input amount mismatch — expected ${input.contract.expectedInputAmountGrains}, got ${witnessUtxo.value}`,
    );
  }

  if (psbt.txOutputs.length !== input.contract.expectedOutputs.length) {
    throw new Error(
      `pearl prefund PSBT must have exactly ${input.contract.expectedOutputs.length} outputs, got ${psbt.txOutputs.length}`,
    );
  }
  for (let i = 0; i < input.contract.expectedOutputs.length; i += 1) {
    const expected = input.contract.expectedOutputs[i]!;
    const actual = psbt.txOutputs[i]!;
    if (actual.address !== expected.address) {
      throw new Error(
        `pearl prefund PSBT output ${i} address mismatch — expected ${expected.address}, got ${actual.address ?? '<no address>'}`,
      );
    }
    if (actual.value !== expected.amountGrains) {
      throw new Error(
        `pearl prefund PSBT output ${i} amount mismatch — expected ${expected.amountGrains}, got ${actual.value}`,
      );
    }
  }

  const outputSum = input.contract.expectedOutputs.reduce((s, o) => s + o.amountGrains, 0);
  const fee = input.contract.expectedInputAmountGrains - outputSum;
  if (fee < 0) {
    throw new Error(`pearl prefund PSBT outputs exceed input — fee would be ${fee} grains`);
  }
  if (fee > input.contract.feeCapGrains) {
    throw new Error(
      `pearl prefund PSBT fee ${fee} exceeds cap ${input.contract.feeCapGrains}`,
    );
  }

  // Validate the leaf the PSBT is spending through matches the caller's leaf.
  const tapLeafScripts = inputData.tapLeafScript ?? [];
  if (tapLeafScripts.length !== 1) {
    throw new Error(
      `pearl prefund PSBT must reference exactly 1 tapLeafScript, got ${tapLeafScripts.length}`,
    );
  }
  const psbtLeaf = tapLeafScripts[0]!;
  const expectedScript = Buffer.from(input.leaf.scriptHex, 'hex');
  const expectedControl = Buffer.from(input.leaf.controlBlockHex, 'hex');
  if (!psbtLeaf.script.equals(expectedScript)) {
    throw new Error('pearl prefund PSBT tapLeafScript script does not match the expected leaf');
  }
  if (!psbtLeaf.controlBlock.equals(expectedControl)) {
    throw new Error('pearl prefund PSBT tapLeafScript controlBlock does not match the expected leaf');
  }
  if (psbtLeaf.leafVersion !== input.leaf.leafVersion) {
    throw new Error(
      `pearl prefund PSBT leafVersion mismatch — expected ${input.leaf.leafVersion}, got ${psbtLeaf.leafVersion}`,
    );
  }

  // ---- All checks passed — sign ----

  const compressedPubkey = ecc.pointFromScalar(input.privkey, true);
  if (!compressedPubkey) {
    throw new Error('pearl-wallet privkey is invalid (off-curve or zero)');
  }
  const xOnlyPubkey = compressedPubkey.subarray(1);

  psbt.signTaprootInput(0, {
    publicKey: Buffer.from(compressedPubkey),
    signSchnorr: (hash: Buffer) => Buffer.from(ecc.signSchnorr(hash, input.privkey)),
    // bitcoinjs requires a sign function for ECDSA; we never use it for
    // Taproot script-path, but the interface insists. Provide a sane stub.
    sign: (hash: Buffer) => Buffer.from(ecc.sign(hash, input.privkey)),
  });

  return {
    signedPsbtBase64: psbt.toBase64(),
    signedXOnlyPubkey: Uint8Array.from(xOnlyPubkey),
  };
}

function reverseHex(hex: string): string {
  // PSBT hash is little-endian in the binary format; the conventional outpoint
  // string is big-endian. Reverse byte order.
  let reversed = '';
  for (let i = hex.length - 2; i >= 0; i -= 2) {
    reversed += hex.slice(i, i + 2);
  }
  return reversed;
}
