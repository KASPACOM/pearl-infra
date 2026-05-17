import { initEccLib, payments } from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';

import { getPearlScriptNetwork, type PearlScriptNetworkName } from './network.js';

let eccInitialized = false;

export interface PearlP2trPayment {
  network: PearlScriptNetworkName;
  address: string;
  outputScriptHex: string;
  internalPubkeyHex: string;
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
