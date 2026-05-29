import { useEffect, useMemo, useState } from 'react';
import { generatePearlMnemonic } from '@kaspacom/pearl-wallet';

import { getPearlWalletSession } from './wallet-session.js';

/**
 * Modal flow run on first "Create offer" with no existing wallet. Four steps:
 *
 *   1. Welcome — explain what's about to happen.
 *   2. Set a strong password (≥12 chars).
 *   3. Reveal a fresh 12-word recovery phrase. Big warning: this is the ONLY
 *      way to recover. We deliberately suppress copy-paste — users need to
 *      write it down. Power users can override with an explicit click.
 *   4. Confirm 4 random words in the right slots. Defensive: it's easy to
 *      think you wrote down a phrase when you actually didn't.
 *
 * On submit: session.create(...) persists the encrypted vault in IndexedDB
 * and leaves the wallet unlocked. The parent triggers its create-offer flow
 * right after, so the user goes straight from "set up wallet" to "post order"
 * with no extra friction.
 */
export interface CreateWalletFlowProps {
  onComplete: () => void;
  onCancel: () => void;
}

type Step = 'welcome' | 'password' | 'reveal' | 'confirm' | 'working';

const CONFIRM_SLOT_COUNT = 4;

export function CreateWalletFlow({ onComplete, onCancel }: CreateWalletFlowProps) {
  const session = useMemo(() => getPearlWalletSession(), []);
  const [step, setStep] = useState<Step>('welcome');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [mnemonic, setMnemonic] = useState<string>('');
  const [allowCopy, setAllowCopy] = useState(false);
  const [confirmInputs, setConfirmInputs] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | undefined>(undefined);

  const confirmSlots = useMemo(() => pickConfirmSlots(mnemonic), [mnemonic]);

  // Generate the mnemonic exactly once when the user reaches the reveal step.
  useEffect(() => {
    if (step === 'reveal' && !mnemonic) {
      setMnemonic(generatePearlMnemonic());
    }
  }, [step, mnemonic]);

  const passwordError = useMemo(() => {
    if (!password) return undefined;
    if (password.length < 12) return 'Password must be at least 12 characters.';
    if (passwordConfirm && password !== passwordConfirm) return 'Passwords do not match.';
    return undefined;
  }, [password, passwordConfirm]);

  const confirmReady = useMemo(() => {
    if (!mnemonic) return false;
    const words = mnemonic.split(' ');
    return confirmSlots.every((idx) => (confirmInputs[idx] ?? '').trim().toLowerCase() === words[idx]);
  }, [mnemonic, confirmSlots, confirmInputs]);

  async function finish() {
    setError(undefined);
    setStep('working');
    try {
      await session.create({ mnemonic, password });
      onComplete();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create wallet.');
      setStep('confirm');
    }
  }

  return (
    <div className="om-modal-backdrop" role="dialog" aria-modal="true">
      <div className="om-modal om-wallet-create">
        <header className="om-modal__header">
          <h2>{step === 'welcome' ? 'Create your Pearl wallet' : `Step ${stepNumber(step)} of 3`}</h2>
          {step === 'welcome' || step === 'working' ? null : (
            <button className="om-modal__close" onClick={onCancel} aria-label="Cancel">×</button>
          )}
        </header>

        {step === 'welcome' && (
          <div className="om-modal__body">
            <p>
              You'll set a password and write down a 12-word recovery phrase. The phrase is the only
              way to recover your wallet if you lose this device — keep it offline, write it down, and
              don't share it with anyone.
            </p>
            <p className="om-muted">
              Your private keys never leave this device. Oysters cannot access your wallet, recover
              your password, or restore your phrase.
            </p>
            <div className="om-modal__actions">
              <button className="om-button" onClick={onCancel}>Not now</button>
              <button className="om-button om-button--primary" onClick={() => setStep('password')}>
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 'password' && (
          <div className="om-modal__body">
            <label className="om-field">
              <span>Set a password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={Boolean(passwordError)}
              />
            </label>
            <label className="om-field">
              <span>Confirm password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                aria-invalid={Boolean(passwordError)}
              />
            </label>
            {passwordError ? <p className="om-error">{passwordError}</p> : null}
            <p className="om-muted">
              Use at least 12 characters. You'll be asked for this every time you sign a trade or
              unlock your wallet.
            </p>
            <div className="om-modal__actions">
              <button className="om-button" onClick={() => setStep('welcome')}>Back</button>
              <button
                className="om-button om-button--primary"
                disabled={!password || password.length < 12 || password !== passwordConfirm}
                onClick={() => setStep('reveal')}
              >
                Generate recovery phrase
              </button>
            </div>
          </div>
        )}

        {step === 'reveal' && mnemonic && (
          <div className="om-modal__body">
            <p>
              <strong>Write down these 12 words.</strong> Order matters. Keep them offline and
              private. Anyone with this phrase can spend your funds.
            </p>
            <ol className="om-mnemonic-list">
              {mnemonic.split(' ').map((word, i) => (
                <li key={i}>
                  <span className="om-mnemonic-index">{i + 1}</span>
                  <code>{word}</code>
                </li>
              ))}
            </ol>
            <details className="om-muted">
              <summary>I want to copy this (advanced)</summary>
              <p>
                Copying onto a device that may be backed up or screenshotted reduces the security of
                your phrase. Only do this if you understand the trade-off.
              </p>
              <button
                className="om-button"
                onClick={async () => {
                  setAllowCopy(true);
                  await navigator.clipboard?.writeText(mnemonic);
                }}
              >
                {allowCopy ? 'Copied' : 'Copy phrase'}
              </button>
            </details>
            <div className="om-modal__actions">
              <button className="om-button" onClick={() => setStep('password')}>Back</button>
              <button className="om-button om-button--primary" onClick={() => setStep('confirm')}>
                I wrote it down
              </button>
            </div>
          </div>
        )}

        {step === 'confirm' && mnemonic && (
          <div className="om-modal__body">
            <p>Confirm by entering the requested words from your phrase.</p>
            {confirmSlots.map((slot) => (
              <label key={slot} className="om-field">
                <span>Word #{slot + 1}</span>
                <input
                  type="text"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={confirmInputs[slot] ?? ''}
                  onChange={(e) => setConfirmInputs({ ...confirmInputs, [slot]: e.target.value })}
                />
              </label>
            ))}
            {error ? <p className="om-error">{error}</p> : null}
            <div className="om-modal__actions">
              <button className="om-button" onClick={() => setStep('reveal')}>Back</button>
              <button
                className="om-button om-button--primary"
                disabled={!confirmReady}
                onClick={finish}
              >
                Create wallet
              </button>
            </div>
          </div>
        )}

        {step === 'working' && (
          <div className="om-modal__body">
            <p>Securing your wallet…</p>
          </div>
        )}
      </div>
    </div>
  );
}

function stepNumber(step: Step): number {
  switch (step) {
    case 'password': return 1;
    case 'reveal': return 2;
    case 'confirm': return 3;
    default: return 0;
  }
}

/**
 * Picks 4 distinct word indexes (0–11) to test the user with. Deterministic
 * given a mnemonic so React doesn't reshuffle them on re-render.
 */
function pickConfirmSlots(mnemonic: string): number[] {
  if (!mnemonic) return [];
  // Hash the mnemonic to a small integer, use it to seed a tiny RNG.
  let seed = 0;
  for (let i = 0; i < mnemonic.length; i += 1) {
    seed = (seed * 31 + mnemonic.charCodeAt(i)) | 0;
  }
  const pool = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  // Fisher-Yates with the seed.
  for (let i = pool.length - 1; i > 0; i -= 1) {
    seed = (seed * 1664525 + 1013904223) | 0;
    const j = Math.abs(seed) % (i + 1);
    [pool[i]!, pool[j]!] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, CONFIRM_SLOT_COUNT).sort((a, b) => a - b);
}
