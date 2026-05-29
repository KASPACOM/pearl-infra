import { useState } from 'react';

import { getPearlWalletSession } from './wallet-session.js';

export interface UnlockWalletPromptProps {
  /** Called once the wallet is unlocked. */
  onUnlocked: () => void;
  /** Called if the user backs out without unlocking. */
  onCancel: () => void;
}

/**
 * Modal that prompts for the wallet password and unlocks the session. Used as
 * a precondition before any signing operation. The password input field is
 * `type="password"` + `autoComplete="current-password"` so password managers
 * fill it cleanly.
 *
 * Error handling: wrong password surfaces as a generic "Could not unlock —
 * check your password" message. We do NOT distinguish "wrong password" from
 * "vault tampered" — both should look identical to the user (and to a
 * shoulder-surfing attacker).
 */
export function UnlockWalletPrompt({ onUnlocked, onCancel }: UnlockWalletPromptProps) {
  const session = getPearlWalletSession();
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'unlocking' | 'error'>('idle');
  const [error, setError] = useState<string | undefined>();

  async function submit() {
    setStatus('unlocking');
    setError(undefined);
    try {
      await session.unlock({ password });
      setPassword('');
      onUnlocked();
    } catch {
      setStatus('error');
      setError('Could not unlock — check your password.');
    }
  }

  return (
    <div className="om-modal-backdrop" role="dialog" aria-modal="true">
      <div className="om-modal om-wallet-unlock">
        <header className="om-modal__header">
          <h2>Unlock your Pearl wallet</h2>
          <button className="om-modal__close" onClick={onCancel} aria-label="Cancel">×</button>
        </header>
        <div className="om-modal__body">
          <label className="om-field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && password) submit();
              }}
              autoFocus
              aria-invalid={status === 'error'}
            />
          </label>
          {error ? <p className="om-error">{error}</p> : null}
          <p className="om-muted">
            Your wallet auto-locks after 15 minutes of inactivity, so you may need to unlock once per
            session.
          </p>
          <div className="om-modal__actions">
            <button className="om-button" onClick={onCancel} disabled={status === 'unlocking'}>
              Cancel
            </button>
            <button
              className="om-button om-button--primary"
              onClick={submit}
              disabled={!password || status === 'unlocking'}
            >
              {status === 'unlocking' ? 'Unlocking…' : 'Unlock'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
