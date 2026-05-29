import { useCallback, useMemo, useState } from 'react';
import {
  PEARL_WALLET_WORD_COUNT,
  getPearlWalletWordlist,
  isValidPearlMnemonic,
} from '@kaspacom/pearl-wallet';

import { getPearlWalletSession } from './wallet-session.js';

export interface RecoverWalletFlowProps {
  onComplete: () => void;
  onCancel: () => void;
}

type Step = 'phrase' | 'password' | 'working';

/**
 * Recovery flow: user lost their device or cleared site data and wants to
 * restore access from their 12-word phrase. Three steps:
 *
 *   1. Enter 12 words, with per-word autocomplete from the BIP39 English
 *      wordlist + checksum validation on the full phrase.
 *   2. Set a fresh password for the new vault.
 *   3. Build the vault. Identical mnemonic → identical BIP86-derived keys,
 *      so the user's on-chain addresses are preserved.
 *
 * Important: this is destructive on the LOCAL vault — any existing local
 * vault is replaced. There's no fork; we never silently merge a new mnemonic
 * with an older one.
 */
export function RecoverWalletFlow({ onComplete, onCancel }: RecoverWalletFlowProps) {
  const session = useMemo(() => getPearlWalletSession(), []);
  const wordlist = useMemo(() => getPearlWalletWordlist(), []);
  const [step, setStep] = useState<Step>('phrase');
  const [words, setWords] = useState<string[]>(() => Array(PEARL_WALLET_WORD_COUNT).fill(''));
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState<string | undefined>();

  const mnemonic = useMemo(() => words.map((w) => w.trim().toLowerCase()).join(' '), [words]);
  const phraseValid = useMemo(() => isValidPearlMnemonic(mnemonic), [mnemonic]);

  const passwordError = useMemo(() => {
    if (!password) return undefined;
    if (password.length < 12) return 'Password must be at least 12 characters.';
    if (passwordConfirm && password !== passwordConfirm) return 'Passwords do not match.';
    return undefined;
  }, [password, passwordConfirm]);

  const updateWord = useCallback(
    (i: number, value: string) => {
      const next = words.slice();
      next[i] = value;
      setWords(next);
    },
    [words],
  );

  /**
   * Pastes a full mnemonic across the 12 inputs when the user pastes into any
   * single field. Handles whitespace + newlines + multi-line copies from
   * password managers.
   */
  const handlePaste = useCallback((slot: number, raw: string) => {
    const parts = raw.trim().split(/\s+/);
    if (parts.length === PEARL_WALLET_WORD_COUNT) {
      setWords(parts.map((p) => p.toLowerCase()));
      return true;
    }
    if (parts.length === 1) {
      updateWord(slot, parts[0]!);
      return true;
    }
    // Length mismatch — refuse the paste and surface a hint.
    setError(`Expected ${PEARL_WALLET_WORD_COUNT} words, got ${parts.length}`);
    return false;
  }, [updateWord]);

  async function finish() {
    setError(undefined);
    setStep('working');
    try {
      await session.create({ mnemonic, password });
      onComplete();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to recover wallet.');
      setStep('password');
    }
  }

  return (
    <div className="om-modal-backdrop" role="dialog" aria-modal="true">
      <div className="om-modal om-wallet-recover">
        <header className="om-modal__header">
          <h2>Recover your Pearl wallet</h2>
          {step === 'working' ? null : (
            <button className="om-modal__close" onClick={onCancel} aria-label="Cancel">×</button>
          )}
        </header>

        {step === 'phrase' && (
          <div className="om-modal__body">
            <p>
              Enter your 12-word recovery phrase. Order matters. Words are not case-sensitive.
            </p>
            <ol className="om-mnemonic-input">
              {words.map((word, i) => (
                <li key={i}>
                  <label>
                    <span className="om-mnemonic-index">{i + 1}</span>
                    <MnemonicWordInput
                      value={word}
                      wordlist={wordlist}
                      onChange={(v) => updateWord(i, v)}
                      onPaste={(raw) => handlePaste(i, raw)}
                    />
                  </label>
                </li>
              ))}
            </ol>
            {error ? <p className="om-error">{error}</p> : null}
            {mnemonic.split(' ').filter(Boolean).length === PEARL_WALLET_WORD_COUNT && !phraseValid ? (
              <p className="om-error">Phrase checksum doesn't match — check your words.</p>
            ) : null}
            <div className="om-modal__actions">
              <button className="om-button" onClick={onCancel}>Cancel</button>
              <button
                className="om-button om-button--primary"
                disabled={!phraseValid}
                onClick={() => {
                  setError(undefined);
                  setStep('password');
                }}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 'password' && (
          <div className="om-modal__body">
            <label className="om-field">
              <span>Set a new password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={Boolean(passwordError)}
              />
            </label>
            <label className="om-field">
              <span>Confirm new password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                aria-invalid={Boolean(passwordError)}
              />
            </label>
            {passwordError ? <p className="om-error">{passwordError}</p> : null}
            {error ? <p className="om-error">{error}</p> : null}
            <p className="om-muted">
              The new password applies only on this device. Your phrase and derived addresses are
              unchanged.
            </p>
            <div className="om-modal__actions">
              <button className="om-button" onClick={() => setStep('phrase')}>Back</button>
              <button
                className="om-button om-button--primary"
                disabled={!password || password.length < 12 || password !== passwordConfirm}
                onClick={finish}
              >
                Recover wallet
              </button>
            </div>
          </div>
        )}

        {step === 'working' && (
          <div className="om-modal__body">
            <p>Securing your recovered wallet…</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Single-word input with BIP39 autocomplete ----------

interface MnemonicWordInputProps {
  value: string;
  wordlist: readonly string[];
  onChange: (value: string) => void;
  onPaste: (raw: string) => boolean;
}

function MnemonicWordInput({ value, wordlist, onChange, onPaste }: MnemonicWordInputProps) {
  const datalistId = useMemo(() => `pearl-wallet-bip39-${Math.random().toString(36).slice(2, 8)}`, []);
  // Pre-filter wordlist to options that match the current prefix so the
  // datalist stays tractable for the browser.
  const suggestions = useMemo(() => {
    const prefix = value.trim().toLowerCase();
    if (!prefix) return [];
    if (prefix.length === 1) return wordlist.filter((w) => w.startsWith(prefix)).slice(0, 32);
    return wordlist.filter((w) => w.startsWith(prefix)).slice(0, 16);
  }, [value, wordlist]);

  return (
    <>
      <input
        type="text"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        value={value}
        list={datalistId}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => {
          const raw = e.clipboardData.getData('text');
          if (onPaste(raw)) {
            e.preventDefault();
          }
        }}
      />
      <datalist id={datalistId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </>
  );
}
