import { decryptVaultBlob, encryptVaultBlob } from './cipher.js';
import { deriveVaultKey, generatePearlWalletKdfSalt, PEARL_WALLET_KDF_DEFAULTS, type PearlWalletKdfParams } from './kdf.js';
import { isValidPearlMnemonic } from './mnemonic.js';

/**
 * Persisted vault shape. Lives in IndexedDB (or whatever storage the host
 * passes to the storage adapter).
 *
 * The only thing in the clear is structural metadata: kdf params, schema
 * version, the encrypted blobs. Anyone with read access to the vault file
 * learns nothing about the user's keys without the password.
 */
export interface PearlWalletStoredVault {
  walletId: string;
  schemaVersion: 1;
  kdf: PersistedKdfParams;
  /** AES-GCM of the BIP39 mnemonic, UTF-8 encoded. */
  encryptedMnemonic: Uint8Array;
  /** Plaintext metadata for the derived keys — pubkeys + addresses are not secret. */
  derivedKeys: PearlWalletStoredDerivedKey[];
  /** Monotonic counter; next deriveOrderKey call uses this index. */
  nextDerivationIndex: number;
  createdAt: string;
  lastUnlockedAt?: string;
  /** Vault auto-locks if no decrypt happens for this many ms. Default 15 min. */
  autoLockMs: number;
}

export interface PearlWalletStoredDerivedKey {
  derivationIndex: number;
  /** Plaintext x-only pubkey for fast lookups. */
  publicKey: Uint8Array;
  address: string;
  orderId?: string;
  createdAt: string;
}

interface PersistedKdfParams {
  algorithm: 'argon2id';
  memoryKb: number;
  iterations: number;
  parallelism: number;
  salt: Uint8Array;
}

export interface PearlWalletStorageAdapter {
  load(walletId: string): Promise<PearlWalletStoredVault | undefined>;
  save(vault: PearlWalletStoredVault): Promise<void>;
  list(): Promise<PearlWalletStoredVault[]>;
  delete(walletId: string): Promise<void>;
}

/**
 * In-memory storage adapter for tests + ephemeral sessions. The W2 PR ships
 * this; an IndexedDB-backed adapter lands in W4 alongside the wallet creation
 * UI (it needs a browser DOM to test).
 */
export class InMemoryPearlWalletStorage implements PearlWalletStorageAdapter {
  private readonly vaults = new Map<string, PearlWalletStoredVault>();

  async load(walletId: string): Promise<PearlWalletStoredVault | undefined> {
    return this.vaults.get(walletId);
  }
  async save(vault: PearlWalletStoredVault): Promise<void> {
    this.vaults.set(vault.walletId, vault);
  }
  async list(): Promise<PearlWalletStoredVault[]> {
    return Array.from(this.vaults.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async delete(walletId: string): Promise<void> {
    this.vaults.delete(walletId);
  }
}

export interface CreatePearlWalletInput {
  walletId?: string;
  mnemonic: string;
  password: string;
  storage: PearlWalletStorageAdapter;
  autoLockMs?: number;
  now?: () => Date;
  /**
   * Optional KDF override. Production paths should NEVER pass this — the
   * default (Argon2id, 64 MiB, 3 iterations) is the security floor. Tests
   * use a weaker variant (e.g., 8 MiB, 1 iteration) so the suite finishes
   * in seconds instead of minutes. The override knob is exported only to
   * make the test seam explicit; an audit can grep for any call site that
   * passes `kdfOverride` outside of `*.test.ts`.
   */
  kdfOverride?: Omit<PearlWalletKdfParams, 'salt'>;
}

/**
 * Build a fresh vault from a mnemonic + password. Used by the W4 wallet
 * creation flow after the user has set their password and seen/confirmed
 * their mnemonic.
 */
export async function createPearlWallet(input: CreatePearlWalletInput): Promise<PearlWalletStoredVault> {
  if (!isValidPearlMnemonic(input.mnemonic)) {
    throw new Error('invalid pearl-wallet mnemonic');
  }
  assertPasswordStrength(input.password);
  const now = (input.now ?? defaultNow)();
  const params: PearlWalletKdfParams = {
    ...(input.kdfOverride ?? PEARL_WALLET_KDF_DEFAULTS),
    salt: generatePearlWalletKdfSalt(),
  };
  const vaultKey = deriveVaultKey(input.password, params);
  const encryptedMnemonic = await encryptVaultBlob(new TextEncoder().encode(input.mnemonic.trim()), vaultKey);
  vaultKey.fill(0);

  const vault: PearlWalletStoredVault = {
    walletId: input.walletId ?? generateWalletId(),
    schemaVersion: 1,
    kdf: serializeKdfParams(params),
    encryptedMnemonic,
    derivedKeys: [],
    nextDerivationIndex: 0,
    createdAt: now.toISOString(),
    autoLockMs: input.autoLockMs ?? 15 * 60 * 1000,
  };
  await input.storage.save(vault);
  return vault;
}

/**
 * Decrypts the mnemonic out of the vault using the password. Throws on bad
 * password or tampered ciphertext with a generic error — the caller MUST NOT
 * surface "wrong password" vs "tampered vault" to the user.
 *
 * Returns the cleartext mnemonic. Caller is responsible for not echoing it
 * back into long-lived storage.
 */
export async function unlockPearlWallet(input: {
  vault: PearlWalletStoredVault;
  password: string;
  storage?: PearlWalletStorageAdapter;
  now?: () => Date;
}): Promise<string> {
  const params: PearlWalletKdfParams = {
    algorithm: 'argon2id',
    memoryKb: input.vault.kdf.memoryKb,
    iterations: input.vault.kdf.iterations,
    parallelism: input.vault.kdf.parallelism,
    salt: input.vault.kdf.salt,
  };
  const vaultKey = deriveVaultKey(input.password, params);
  let mnemonic: string;
  try {
    const plaintext = await decryptVaultBlob(input.vault.encryptedMnemonic, vaultKey);
    mnemonic = new TextDecoder().decode(plaintext);
    plaintext.fill(0);
  } finally {
    vaultKey.fill(0);
  }
  if (!isValidPearlMnemonic(mnemonic)) {
    // Either the vault was corrupted post-write OR the password was right
    // but cosmically improbable wrong-byte luck. Reject explicitly.
    throw new Error('pearl-wallet vault decryption produced an invalid mnemonic');
  }
  if (input.storage) {
    const now = (input.now ?? defaultNow)();
    await input.storage.save({ ...input.vault, lastUnlockedAt: now.toISOString() });
  }
  return mnemonic;
}

/**
 * Re-encrypts the vault with a new password. Vault key changes, but the
 * derived public-key index does NOT regenerate — every per-order key the
 * user already had stays the same.
 */
export async function changePearlWalletPassword(input: {
  vault: PearlWalletStoredVault;
  currentPassword: string;
  newPassword: string;
  storage: PearlWalletStorageAdapter;
  kdfOverride?: Omit<PearlWalletKdfParams, 'salt'>;
}): Promise<PearlWalletStoredVault> {
  assertPasswordStrength(input.newPassword);
  const mnemonic = await unlockPearlWallet({ vault: input.vault, password: input.currentPassword });
  try {
    const params: PearlWalletKdfParams = {
      ...(input.kdfOverride ?? PEARL_WALLET_KDF_DEFAULTS),
      salt: generatePearlWalletKdfSalt(),
    };
    const vaultKey = deriveVaultKey(input.newPassword, params);
    const encryptedMnemonic = await encryptVaultBlob(new TextEncoder().encode(mnemonic), vaultKey);
    vaultKey.fill(0);
    const updated: PearlWalletStoredVault = {
      ...input.vault,
      kdf: serializeKdfParams(params),
      encryptedMnemonic,
    };
    await input.storage.save(updated);
    return updated;
  } finally {
    // Even if encryption fails, drop the cleartext mnemonic from our scope.
    // (Can't actually zero a JS string, but losing the reference is the best
    // we can do.)
  }
}

/**
 * Records a freshly-derived key in the vault. The privkey is NOT stored —
 * it can always be re-derived from the mnemonic + index. We persist only
 * the pubkey + address + optional orderId backlink.
 */
export async function recordDerivedKey(input: {
  vault: PearlWalletStoredVault;
  storage: PearlWalletStorageAdapter;
  derivationIndex: number;
  publicKey: Uint8Array;
  address: string;
  orderId?: string;
  now?: () => Date;
}): Promise<PearlWalletStoredVault> {
  const now = (input.now ?? defaultNow)();
  const next = Math.max(input.vault.nextDerivationIndex, input.derivationIndex + 1);
  const updated: PearlWalletStoredVault = {
    ...input.vault,
    nextDerivationIndex: next,
    derivedKeys: [
      ...input.vault.derivedKeys,
      {
        derivationIndex: input.derivationIndex,
        publicKey: input.publicKey,
        address: input.address,
        ...(input.orderId ? { orderId: input.orderId } : {}),
        createdAt: now.toISOString(),
      },
    ],
  };
  await input.storage.save(updated);
  return updated;
}

export function assertPasswordStrength(password: string): void {
  if (typeof password !== 'string') {
    throw new Error('pearl-wallet password must be a string');
  }
  if (password.length < 12) {
    throw new Error('pearl-wallet password must be at least 12 characters');
  }
}

function serializeKdfParams(params: PearlWalletKdfParams): PersistedKdfParams {
  return {
    algorithm: params.algorithm,
    memoryKb: params.memoryKb,
    iterations: params.iterations,
    parallelism: params.parallelism,
    salt: params.salt,
  };
}

function generateWalletId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function defaultNow(): Date {
  return new Date();
}
