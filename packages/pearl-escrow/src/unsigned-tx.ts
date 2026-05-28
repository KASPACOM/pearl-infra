import { address as bitcoinAddress, Transaction } from 'bitcoinjs-lib';

import { getPearlScriptNetwork } from '@kaspacom/pearl-script';

import type {
  CreatePearlEscrowUnsignedTxInput,
  PearlEscrowPackage,
  PearlEscrowTemplateKind,
  PearlEscrowTxTemplate,
  PearlEscrowUnsignedTx,
} from './types.js';

export function createPearlEscrowUnsignedTx(input: CreatePearlEscrowUnsignedTxInput): PearlEscrowUnsignedTx {
  const template = selectTemplate(input.escrow, input.kind);
  const outpoint = input.escrow.fundingOutpoint ?? template.inputs[0]?.outpoint;
  if (!outpoint) {
    throw new Error('escrow fundingOutpoint is required to construct an unsigned transaction');
  }

  const feeGrains = input.feeGrains ?? '0';
  assertNonNegativeIntegerString(feeGrains, 'feeGrains');
  const inputAmount = BigInt(input.escrow.expectedAmountGrains);
  const fee = BigInt(feeGrains);
  if (fee >= inputAmount) {
    throw new Error('feeGrains must be less than input amount');
  }

  const outputAmount = inputAmount - fee;
  const output = template.outputs[0];
  if (!output) {
    throw new Error(`${input.kind} template requires one output`);
  }

  const parsedOutpoint = parseOutpoint(outpoint);
  const tx = new Transaction();
  tx.version = 2;
  tx.locktime = template.lockTime ?? 0;
  tx.addInput(
    Buffer.from(parsedOutpoint.txid, 'hex').reverse(),
    parsedOutpoint.vout,
    input.sequence ?? defaultSequenceFor(template),
  );
  tx.addOutput(
    bitcoinAddress.toOutputScript(output.address, getPearlScriptNetwork(input.escrow.network)),
    toSafeNumber(outputAmount, 'outputAmountGrains'),
  );

  return {
    kind: input.kind,
    unsignedTxHex: tx.toHex(),
    inputOutpoint: outpoint,
    inputAmountGrains: input.escrow.expectedAmountGrains,
    outputAmountGrains: outputAmount.toString(),
    feeGrains,
    lockTime: tx.locktime,
  };
}

function selectTemplate(escrow: PearlEscrowPackage, kind: PearlEscrowTemplateKind): PearlEscrowTxTemplate {
  return kind === 'release' ? escrow.releaseTemplate : escrow.refundTemplate;
}

function defaultSequenceFor(template: PearlEscrowTxTemplate): number {
  return template.lockTime == null ? Transaction.DEFAULT_SEQUENCE : Transaction.DEFAULT_SEQUENCE - 1;
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

function assertNonNegativeIntegerString(value: string, field: string): void {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${field} must be a non-negative integer string`);
  }
}

function toSafeNumber(value: bigint, field: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${field} exceeds JavaScript safe integer range`);
  }
  return Number(value);
}
