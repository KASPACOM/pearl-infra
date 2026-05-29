import { HDKey } from '@scure/bip32';
import * as ecc from 'tiny-secp256k1';

import { pearlMnemonicToSeed } from './mnemonic.js';

const HARDENED_OFFSET = 0x80000000;

// BIP86 derivation path: m/86'/0'/account'/change/index
//
// We pick:
//   purpose'  = 86' (Taproot, single-key, per BIP86 spec).
//   coin'     = 0' (we treat Pearl's BIP44 slot as 0 for now; can be revisited
//                   if SLIP-44 ever registers a Pearl coin type).
//   account'  = 0' (single account per user in v1).
//   change    = 0  (external addresses; internal/change isn't exposed because
//                   each Pearl prefund order gets its own external key).
//   index     = N  (monotonic counter; the vault tracks the next free index).
const PEARL_WALLET_PURPOSE = 86 | HARDENED_OFFSET;
const PEARL_WALLET_COIN = 0 | HARDENED_OFFSET;
const PEARL_WALLET_ACCOUNT = 0 | HARDENED_OFFSET;
const PEARL_WALLET_CHANGE = 0;

/**
 * Derives the BIP86 keypair for a given index, returned as raw x-only material.
 *
 * Notes:
 *   - The privkey is returned as the raw 32-byte secret. Per BIP86, when you
 *     actually use this key to sign for the Taproot key-path, you tweak it
 *     with `taggedHash('TapTweak', xOnlyPub)` first. The script-path (which is
 *     all the prefund flow uses) signs with the RAW secret here. We expose
 *     both forms to keep callers honest.
 *   - The pubkey is the x-only (32-byte) form — drop the parity byte from the
 *     compressed pubkey. Pearl Taproot leaves take x-only pubkeys directly.
 */
export interface PearlWalletDerivedKey {
  derivationPath: string;
  /** 32-byte raw secret. Caller MUST keep this in memory only. */
  privkey: Uint8Array;
  /** 32-byte x-only pubkey. Safe to persist. */
  pubkey: Uint8Array;
}

export function deriveOrderKey(seed: Uint8Array, index: number): PearlWalletDerivedKey {
  assertNonHardenedIndex(index);
  const master = HDKey.fromMasterSeed(seed);
  const path = formatPath(index);
  const child = master.derive(path);
  if (!child.privateKey) {
    throw new Error(`derived key at ${path} has no private component`);
  }
  return {
    derivationPath: path,
    privkey: child.privateKey,
    pubkey: xOnlyFromCompressed(child.publicKey ?? compressFromPriv(child.privateKey)),
  };
}

/**
 * Convenience for the common path: mnemonic → seed → derived key for index N.
 * Wraps pearlMnemonicToSeed + deriveOrderKey so callers don't accidentally
 * hold a 64-byte seed any longer than necessary.
 */
export function deriveOrderKeyFromMnemonic(mnemonic: string, index: number): PearlWalletDerivedKey {
  const seed = pearlMnemonicToSeed(mnemonic);
  try {
    return deriveOrderKey(seed, index);
  } finally {
    // Best-effort zeroize. JS doesn't truly free, but overwriting the bytes
    // prevents the seed from sitting around in a heap snapshot for arbitrarily
    // long. Callers should also drop their reference.
    seed.fill(0);
  }
}

/**
 * The BIP86 derivation path used for a given order index. Exposed so callers
 * can persist the path alongside the derived key (cleaner than recomputing).
 */
export function formatPearlWalletDerivationPath(index: number): string {
  assertNonHardenedIndex(index);
  return formatPath(index);
}

// ---------- internals ----------

function formatPath(index: number): string {
  return [
    'm',
    `${PEARL_WALLET_PURPOSE & ~HARDENED_OFFSET}'`,
    `${PEARL_WALLET_COIN & ~HARDENED_OFFSET}'`,
    `${PEARL_WALLET_ACCOUNT & ~HARDENED_OFFSET}'`,
    `${PEARL_WALLET_CHANGE}`,
    `${index}`,
  ].join('/');
}

function assertNonHardenedIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= HARDENED_OFFSET) {
    throw new Error(`pearl-wallet derivation index must be an unsigned 31-bit integer, got ${index}`);
  }
}

function xOnlyFromCompressed(compressed: Uint8Array): Uint8Array {
  if (compressed.length === 33 && (compressed[0] === 0x02 || compressed[0] === 0x03)) {
    return compressed.slice(1);
  }
  if (compressed.length === 32) {
    return compressed;
  }
  throw new Error(`expected 33-byte compressed pubkey, got ${compressed.length} bytes`);
}

function compressFromPriv(priv: Uint8Array): Uint8Array {
  const pub = ecc.pointFromScalar(priv, true);
  if (!pub) throw new Error('invalid pearl-wallet private key (off-curve or zero)');
  return pub;
}
