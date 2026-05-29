/**
 * Controller for the live (unlocked) wallet state. Holds the decrypted
 * mnemonic in memory; auto-locks after a configurable idle window; explicit
 * `lock()` flushes immediately.
 *
 * Used by the React app to gate signing operations. Components should
 * subscribe to `onStateChange` rather than reading the controller state
 * directly during render — the controller emits a 'locked' event when
 * auto-lock fires so the UI can route the user to the unlock prompt.
 *
 * IMPORTANT: never serialize this controller into React state, Redux,
 * localStorage, or any logger. The mnemonic stays inside this object only.
 */

export type LockedVaultState =
  | { status: 'locked' }
  | { status: 'unlocked'; mnemonic: string; unlockedAt: Date; lastTouchedAt: Date };

export interface LockedVaultControllerOptions {
  /** Auto-lock idle window in ms. Default 15 minutes. */
  autoLockMs?: number;
  /** Allows tests to fast-forward time. */
  now?: () => Date;
  /** Allows tests to stub setTimeout. */
  setTimer?: (cb: () => void, ms: number) => unknown;
  /** Counterpart to setTimer for cleanup. */
  clearTimer?: (handle: unknown) => void;
}

export class LockedVaultController {
  private state: LockedVaultState = { status: 'locked' };
  private readonly autoLockMs: number;
  private readonly now: () => Date;
  private readonly setTimer: (cb: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private timerHandle: unknown | undefined;
  private listeners = new Set<(state: LockedVaultState) => void>();

  constructor(options: LockedVaultControllerOptions = {}) {
    this.autoLockMs = options.autoLockMs ?? 15 * 60 * 1000;
    this.now = options.now ?? (() => new Date());
    this.setTimer = options.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
    this.clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  getState(): LockedVaultState {
    return this.state;
  }

  unlock(mnemonic: string): void {
    const now = this.now();
    this.state = { status: 'unlocked', mnemonic, unlockedAt: now, lastTouchedAt: now };
    this.scheduleAutoLock();
    this.emit();
  }

  /**
   * Call after any user-initiated signing operation. Resets the idle timer so
   * the wallet doesn't lock mid-flow.
   */
  touch(): void {
    if (this.state.status !== 'unlocked') return;
    this.state = { ...this.state, lastTouchedAt: this.now() };
    this.scheduleAutoLock();
  }

  /** Explicit lock — user clicked "lock now", or app is shutting down. */
  lock(): void {
    if (this.timerHandle != null) {
      this.clearTimer(this.timerHandle);
      this.timerHandle = undefined;
    }
    if (this.state.status === 'unlocked') {
      // Best-effort cleanup. JS won't let us truly zero a string, but losing
      // the only reference is what we have.
      this.state = { status: 'locked' };
    }
    this.emit();
  }

  withMnemonic<T>(fn: (mnemonic: string) => T): T {
    if (this.state.status !== 'unlocked') {
      throw new Error('pearl-wallet is locked — unlock before signing');
    }
    this.touch();
    return fn(this.state.mnemonic);
  }

  onStateChange(listener: (state: LockedVaultState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private scheduleAutoLock(): void {
    if (this.timerHandle != null) {
      this.clearTimer(this.timerHandle);
    }
    this.timerHandle = this.setTimer(() => {
      this.lock();
    }, this.autoLockMs);
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }
}
