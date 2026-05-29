import {
  LockedVaultController,
  createPearlWallet,
  deriveOrderKeyFromMnemonic,
  generatePearlMnemonic,
  pearlAddressFromXOnlyPubkey,
  recordDerivedKey,
  unlockPearlWallet,
  type PearlWalletStorageAdapter,
  type PearlWalletStoredVault,
} from '@kaspacom/pearl-wallet';
import type { PearlScriptNetworkName } from '@kaspacom/pearl-script';
import { sha256 } from '@noble/hashes/sha2';
import * as ecc from 'tiny-secp256k1';

/**
 * Reserved BIP86 derivation index for the user's IDENTITY key. Wallet
 * challenges + maker-proof signatures are signed with this key. Orders start
 * from index 1, so the identity key never collides with an on-chain order
 * escrow.
 */
const IDENTITY_DERIVATION_INDEX = 0;


/**
 * Single source of truth for the user's Pearl wallet across the app. Wraps:
 *   - the IndexedDB vault storage adapter,
 *   - the LockedVaultController (auto-lock + memory hygiene),
 *   - convenience methods for creating, unlocking, and deriving order keys.
 *
 * Components subscribe via onChange — they receive both the persisted vault
 * (or undefined if not yet created) and the live LockedVaultController state.
 * Components never reach for the mnemonic directly; they use signWith*
 * helpers that gate the mnemonic through the controller's withMnemonic.
 */

export interface PearlWalletSessionSnapshot {
  vault?: PearlWalletStoredVault;
  locked: boolean;
}

export class PearlWalletSession {
  private vault?: PearlWalletStoredVault;
  private readonly controller: LockedVaultController;
  private readonly storage: PearlWalletStorageAdapter;
  private readonly listeners = new Set<(snapshot: PearlWalletSessionSnapshot) => void>();
  private hydratePromise?: Promise<void>;

  constructor(storage: PearlWalletStorageAdapter) {
    this.storage = storage;
    this.controller = new LockedVaultController();
    this.controller.onStateChange(() => this.emit());
  }

  /**
   * Pulls the most-recently-saved vault from storage, if any. Idempotent;
   * safe to call from multiple React effects. Returns the same promise on
   * concurrent calls.
   */
  async hydrate(): Promise<void> {
    if (this.hydratePromise) return this.hydratePromise;
    this.hydratePromise = (async () => {
      const all = await this.storage.list();
      // Pick the most recently created vault. v1 only supports one wallet per
      // browser profile — future "switch accounts" UX changes this.
      this.vault = all.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      this.emit();
    })();
    return this.hydratePromise;
  }

  getSnapshot(): PearlWalletSessionSnapshot {
    return {
      ...(this.vault ? { vault: this.vault } : {}),
      locked: this.controller.getState().status === 'locked',
    };
  }

  onChange(listener: (snapshot: PearlWalletSessionSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Returns true if the user has an embedded Pearl wallet stored locally. */
  hasWallet(): boolean {
    return this.vault !== undefined;
  }

  /** Returns true if the wallet is unlocked and ready to sign. */
  isUnlocked(): boolean {
    return this.controller.getState().status === 'unlocked';
  }

  /**
   * Creates a brand-new vault from a freshly generated mnemonic. The caller is
   * responsible for showing the mnemonic to the user + collecting the confirm
   * step before this is called. After creation the wallet is left UNLOCKED so
   * the user can immediately post their first order.
   */
  async create(input: {
    mnemonic: string;
    password: string;
    /** Test-only seam — production code does not set this. See pearl-wallet
     * `CreatePearlWalletInput.kdfOverride` for the explanation. */
    kdfOverride?: Parameters<typeof createPearlWallet>[0]['kdfOverride'];
  }): Promise<PearlWalletStoredVault> {
    const vault = await createPearlWallet({
      mnemonic: input.mnemonic,
      password: input.password,
      storage: this.storage,
      ...(input.kdfOverride ? { kdfOverride: input.kdfOverride } : {}),
    });
    this.vault = vault;
    this.controller.unlock(input.mnemonic);
    this.emit();
    return vault;
  }

  /**
   * Unlocks the wallet by verifying the password against the persisted vault.
   * Throws on wrong password (generic message — no info leak). Schedules the
   * 15-minute auto-lock timer.
   */
  async unlock(input: { password: string }): Promise<void> {
    if (!this.vault) throw new Error('pearl-wallet: no vault to unlock');
    const mnemonic = await unlockPearlWallet({
      vault: this.vault,
      password: input.password,
      storage: this.storage,
    });
    this.controller.unlock(mnemonic);
    // Pull the touched vault (lastUnlockedAt is bumped server-side).
    const refreshed = await this.storage.load(this.vault.walletId);
    if (refreshed) {
      this.vault = refreshed;
    }
    this.emit();
  }

  /** Explicit lock — user clicked "Lock wallet" or app is shutting down. */
  lock(): void {
    this.controller.lock();
  }

  /**
   * Derives a fresh per-order keypair (BIP86 next index), records its pubkey
   * + address in the vault, and returns the derived key data. Only the pubkey
   * + address persist; the privkey is re-derived from the mnemonic + index on
   * demand.
   *
   * @param orderId optional backlink for UI grouping. Not security-critical.
   */
  async deriveNextOrderKey(input: {
    orderId?: string;
    network: PearlScriptNetworkName;
  }): Promise<{ derivationIndex: number; pubkey: Uint8Array; address: string }> {
    if (!this.vault) throw new Error('pearl-wallet: no vault — create or recover first');
    return this.controller.withMnemonic(async (mnemonic) => {
      // Reserve index 0 for the user's identity — orders start at 1.
      const index = Math.max(this.vault!.nextDerivationIndex, IDENTITY_DERIVATION_INDEX + 1);
      const derived = deriveOrderKeyFromMnemonic(mnemonic, index);
      const address = pearlAddressFromXOnlyPubkey(derived.pubkey, input.network);
      this.vault = await recordDerivedKey({
        vault: this.vault!,
        storage: this.storage,
        derivationIndex: index,
        publicKey: derived.pubkey,
        address,
        ...(input.orderId ? { orderId: input.orderId } : {}),
      });
      this.emit();
      return { derivationIndex: index, pubkey: derived.pubkey, address };
    });
  }

  /**
   * Re-derives a specific order's keypair on demand. The privkey lives only
   * inside the callback — it is NOT returned to the caller because callers
   * should hand the privkey directly into validateAndSignPearlPrefundPsbt.
   */
  async withOrderPrivkey<T>(
    derivationIndex: number,
    fn: (privkey: Uint8Array, pubkey: Uint8Array) => Promise<T> | T,
  ): Promise<T> {
    return this.controller.withMnemonic((mnemonic) => {
      const derived = deriveOrderKeyFromMnemonic(mnemonic, derivationIndex);
      try {
        return Promise.resolve(fn(derived.privkey, derived.pubkey));
      } finally {
        derived.privkey.fill(0);
      }
    });
  }

  /**
   * Returns the user's identity pubkey + Pearl address. The identity key is
   * BIP86 index 0, stable across recoveries (same mnemonic → same identity).
   * Used to call createWalletChallenge + verifyWalletChallenge with
   * walletType='pearl'. Requires the wallet to be unlocked.
   */
  async getIdentity(network: PearlScriptNetworkName): Promise<{
    publicKeyHex: string;
    address: string;
  }> {
    return this.controller.withMnemonic((mnemonic) => {
      const derived = deriveOrderKeyFromMnemonic(mnemonic, IDENTITY_DERIVATION_INDEX);
      try {
        return {
          publicKeyHex: Buffer.from(derived.pubkey).toString('hex'),
          address: pearlAddressFromXOnlyPubkey(derived.pubkey, network),
        };
      } finally {
        derived.privkey.fill(0);
      }
    });
  }

  /**
   * Signs a wallet-challenge message with the identity key. The signature is a
   * 64-byte BIP340 Schnorr signature over SHA-256(message), encoded as hex.
   * The server's verifyWalletChallenge expects exactly this shape for
   * walletType='pearl'.
   */
  async signWalletChallenge(message: string): Promise<string> {
    return this.controller.withMnemonic((mnemonic) => {
      const derived = deriveOrderKeyFromMnemonic(mnemonic, IDENTITY_DERIVATION_INDEX);
      try {
        // SHA-256 the message bytes — matches the server's
        // verifyWalletChallenge → createHash('sha256').update(message).digest().
        const hash = sha256(new TextEncoder().encode(message));
        const sig = ecc.signSchnorr(hash, derived.privkey);
        return Buffer.from(sig).toString('hex');
      } finally {
        derived.privkey.fill(0);
      }
    });
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

let singleton: PearlWalletSession | undefined;

/**
 * Singleton accessor used by React components. Initialize with
 * setPearlWalletSession() exactly once at app boot, then components reach for
 * the live session via this getter. Throws if not initialized so tests +
 * dev-server boot order are explicit.
 */
export function getPearlWalletSession(): PearlWalletSession {
  if (!singleton) {
    throw new Error('pearl-wallet: session not initialized — call setPearlWalletSession() first');
  }
  return singleton;
}

export function setPearlWalletSession(session: PearlWalletSession): void {
  singleton = session;
}

/** Test helper: wipes the singleton between tests. */
export function _resetPearlWalletSessionForTesting(): void {
  singleton = undefined;
}

export { generatePearlMnemonic };
