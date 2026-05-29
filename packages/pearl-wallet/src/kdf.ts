import { argon2id } from '@noble/hashes/argon2';

/**
 * Argon2id parameters per the W0 spec. These translate to roughly 100ms unlock
 * time on a modern laptop and a memory wall that makes GPU brute force
 * impractical. If we change these, we have to bump the vault `schemaVersion`
 * and re-encrypt every user's vault on next unlock — these params live INSIDE
 * the vault so old vaults stay readable.
 */
export const PEARL_WALLET_KDF_DEFAULTS = {
  algorithm: 'argon2id' as const,
  memoryKb: 65_536,   // 64 MiB
  iterations: 3,
  parallelism: 1,
  outputBytes: 32,
};

export interface PearlWalletKdfParams {
  algorithm: 'argon2id';
  memoryKb: number;
  iterations: number;
  parallelism: number;
  salt: Uint8Array;
}

/**
 * Random 16-byte salt for a new vault. Use crypto.getRandomValues — Node
 * exposes it via webcrypto, browsers natively.
 */
export function generatePearlWalletKdfSalt(): Uint8Array {
  const salt = new Uint8Array(16);
  cryptoLike().getRandomValues(salt);
  return salt;
}

/**
 * password + salt → 32-byte AES-GCM key. Deterministic given the params; an
 * attacker without the password must do at least `memoryKb * iterations` work
 * per guess.
 */
export function deriveVaultKey(password: string, params: PearlWalletKdfParams): Uint8Array {
  if (params.algorithm !== 'argon2id') {
    throw new Error(`unsupported KDF algorithm: ${params.algorithm}`);
  }
  if (params.memoryKb < 8192) {
    throw new Error('pearl-wallet KDF rejects sub-8 MiB memory (too weak)');
  }
  if (params.iterations < 1) {
    throw new Error('pearl-wallet KDF rejects zero iterations');
  }
  if (params.parallelism < 1) {
    throw new Error('pearl-wallet KDF rejects zero parallelism');
  }
  if (params.salt.length < 8) {
    throw new Error('pearl-wallet KDF rejects salts shorter than 8 bytes');
  }
  const passwordBytes = new TextEncoder().encode(password);
  return argon2id(passwordBytes, params.salt, {
    m: params.memoryKb,
    t: params.iterations,
    p: params.parallelism,
    dkLen: PEARL_WALLET_KDF_DEFAULTS.outputBytes,
  });
}

function cryptoLike(): { getRandomValues: (buf: Uint8Array) => Uint8Array } {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    return globalThis.crypto;
  }
  throw new Error('pearl-wallet requires a runtime with crypto.getRandomValues (node 22+ or any modern browser)');
}
