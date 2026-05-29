import { entropyToMnemonic, generateMnemonic, mnemonicToEntropy, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

// 12 words = 128 bits of entropy. This is the strict default per the W0 plan.
// Anything larger (15/18/21/24 words) is rejected to keep recovery UX uniform.
export const PEARL_WALLET_WORD_COUNT = 12;
const PEARL_WALLET_ENTROPY_BITS = 128;

/**
 * Generates a fresh 12-word BIP39 mnemonic. Uses the BIP39 English wordlist.
 * Entropy comes from @scure/bip39 → which under the hood uses
 * `crypto.getRandomValues` in browsers / `crypto.randomBytes` in Node.
 */
export function generatePearlMnemonic(): string {
  return generateMnemonic(wordlist, PEARL_WALLET_ENTROPY_BITS);
}

/**
 * Validates a user-supplied mnemonic. Enforces:
 *   1. exactly 12 words
 *   2. every word is in the BIP39 English wordlist
 *   3. the BIP39 checksum byte matches (4 trailing bits computed from SHA-256)
 *
 * Returns false on any failure rather than throwing — callers display
 * "Invalid recovery phrase" UI; we don't want to leak which word is wrong
 * since that's also useful to an attacker brute-forcing partial phrases.
 */
export function isValidPearlMnemonic(mnemonic: string): boolean {
  if (typeof mnemonic !== 'string') return false;
  const words = mnemonic.trim().split(/\s+/);
  if (words.length !== PEARL_WALLET_WORD_COUNT) return false;
  return validateMnemonic(words.join(' '), wordlist);
}

/**
 * Returns the BIP39 wordlist exactly as we use it. Frontend uses this for
 * autocomplete in the recovery flow (W6).
 */
export function getPearlWalletWordlist(): readonly string[] {
  return wordlist;
}

/**
 * Lower-level entropy ↔ mnemonic for testing + advanced flows.
 * Not exported in the public package API — callers should always go through
 * generatePearlMnemonic / isValidPearlMnemonic.
 */
export function _mnemonicToEntropy(mnemonic: string): Uint8Array {
  return mnemonicToEntropy(mnemonic, wordlist);
}

export function _entropyToMnemonic(entropy: Uint8Array): string {
  if (entropy.length * 8 !== PEARL_WALLET_ENTROPY_BITS) {
    throw new Error(`pearl-wallet mnemonic must encode ${PEARL_WALLET_ENTROPY_BITS} bits of entropy`);
  }
  return entropyToMnemonic(entropy, wordlist);
}

/**
 * Derives the BIP39 seed from a mnemonic. Optional passphrase per BIP39 §3.
 * Pearl wallet doesn't expose the passphrase in v1 — it's always undefined.
 * The argument exists so future flows (hardware wallet, 25th word) work without
 * a breaking API change.
 *
 * @returns 64-byte seed
 */
export function pearlMnemonicToSeed(mnemonic: string, passphrase?: string): Uint8Array {
  if (!isValidPearlMnemonic(mnemonic)) {
    throw new Error('invalid pearl-wallet mnemonic');
  }
  return mnemonicToSeedSync(mnemonic, passphrase);
}
