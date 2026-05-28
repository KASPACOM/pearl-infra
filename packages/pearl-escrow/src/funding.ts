import { address as bitcoinAddress } from 'bitcoinjs-lib';

import { getPearlScriptNetwork } from '@kaspacom/pearl-script';

import type {
  PearlEscrowFundingCandidate,
  PearlEscrowFundingMatch,
  PearlEscrowPackage,
} from './types.js';

export function matchPearlEscrowFundingOutput(
  escrow: PearlEscrowPackage,
  candidate: PearlEscrowFundingCandidate,
): PearlEscrowFundingMatch {
  assertTxid(candidate.txid);
  assertVout(candidate.vout);
  assertPositiveIntegerString(candidate.amountGrains, 'amountGrains');

  const outpoint = `${candidate.txid}:${candidate.vout}`;
  const scriptPubKeyHex = candidateScriptPubKeyHex(escrow, candidate);
  if (escrow.fundingOutpoint && escrow.fundingOutpoint !== outpoint) {
    return createFundingMatch(escrow, candidate, outpoint, scriptPubKeyHex, 'outpoint_mismatch', false);
  }
  if (scriptPubKeyHex !== escrow.keys.taprootOutputScriptHex) {
    return createFundingMatch(escrow, candidate, outpoint, scriptPubKeyHex, 'script_mismatch', false);
  }

  const expected = BigInt(escrow.expectedAmountGrains);
  const observed = BigInt(candidate.amountGrains);
  if (observed < expected) {
    return createFundingMatch(escrow, candidate, outpoint, scriptPubKeyHex, 'underpaid', false);
  }
  if (observed > expected) {
    return createFundingMatch(escrow, candidate, outpoint, scriptPubKeyHex, 'overpaid', false);
  }
  return createFundingMatch(escrow, candidate, outpoint, scriptPubKeyHex, 'matched', true);
}

function candidateScriptPubKeyHex(escrow: PearlEscrowPackage, candidate: PearlEscrowFundingCandidate): string {
  if (candidate.scriptPubKeyHex) {
    return normalizeHex(candidate.scriptPubKeyHex, 'scriptPubKeyHex');
  }
  if (!candidate.address) {
    throw new Error('funding candidate requires address or scriptPubKeyHex');
  }
  return bitcoinAddress
    .toOutputScript(candidate.address, getPearlScriptNetwork(escrow.network))
    .toString('hex');
}

function createFundingMatch(
  escrow: PearlEscrowPackage,
  candidate: PearlEscrowFundingCandidate,
  outpoint: string,
  scriptPubKeyHex: string,
  status: PearlEscrowFundingMatch['status'],
  matched: boolean,
): PearlEscrowFundingMatch {
  return {
    matched,
    status,
    outpoint,
    expectedAmountGrains: escrow.expectedAmountGrains,
    observedAmountGrains: candidate.amountGrains,
    scriptPubKeyHex,
    ...(candidate.blockHeight == null ? {} : { blockHeight: candidate.blockHeight }),
    ...(candidate.confirmations == null ? {} : { confirmations: candidate.confirmations }),
  };
}

function assertTxid(txid: string): void {
  if (!/^[0-9a-fA-F]{64}$/.test(txid)) {
    throw new Error('txid must be 32-byte hex');
  }
}

function assertVout(vout: number): void {
  if (!Number.isInteger(vout) || vout < 0) {
    throw new Error('vout must be a non-negative integer');
  }
}

function assertPositiveIntegerString(value: string, field: string): void {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${field} must be a positive integer string`);
  }
}

function normalizeHex(value: string, field: string): string {
  const normalized = value.startsWith('0x') ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]*$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error(`${field} must be even-length hex`);
  }
  return normalized.toLowerCase();
}
