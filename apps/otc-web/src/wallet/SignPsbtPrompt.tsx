import { useMemo, useState } from 'react';

import {
  validateAndSignPearlPrefundPsbt,
  type PearlPrefundSpendContract,
} from '@kaspacom/pearl-wallet';
import type { PearlPrefundEscrowLeaf, PearlScriptNetworkName } from '@kaspacom/pearl-script';

import { getPearlWalletSession } from './wallet-session.js';
import { buildPsbtSummary } from './psbt-summary.js';
import { UnlockWalletPrompt } from './UnlockWalletPrompt.js';

export interface SignPsbtPromptProps {
  /** Title shown in the modal header — e.g. "Sign sweep" or "Sign refund". */
  title: string;
  /** Short explainer shown above the summary. */
  intent: string;
  /** Unsigned PSBT, prepared by the server. */
  psbtBase64: string;
  /** Taproot leaf the user's key signs against. */
  leaf: PearlPrefundEscrowLeaf;
  /** Pearl network the spend targets. */
  network: PearlScriptNetworkName;
  /** L-PR-3 contract the wallet enforces before signing. Shown to the user. */
  contract: PearlPrefundSpendContract;
  /** BIP86 derivation index of the maker key that signs. */
  derivationIndex: number;
  /** Called with the signed PSBT once the user clicks Sign and signing succeeds. */
  onSigned: (signedPsbtBase64: string) => void | Promise<void>;
  onCancel: () => void;
}

/**
 * The W5 signing modal. Shows a human-readable summary of what the user is
 * about to sign, then either:
 *   - if the wallet is locked, swaps to the UnlockWalletPrompt first,
 *   - if unlocked, runs validateAndSignPearlPrefundPsbt under the W3
 *     contract (the same one displayed) and returns the signed PSBT.
 *
 * The summary fields are derived from the contract, NOT the PSBT — that's
 * deliberate. The wallet's pre-sign validation guarantees the PSBT matches
 * the contract; if it doesn't, signing throws before any signature is added.
 * So what the user sees IS what gets signed.
 */
export function SignPsbtPrompt({
  title,
  intent,
  psbtBase64,
  leaf,
  network,
  contract,
  derivationIndex,
  onSigned,
  onCancel,
}: SignPsbtPromptProps) {
  const session = getPearlWalletSession();
  const summary = useMemo(() => buildPsbtSummary(contract), [contract]);
  const [needsUnlock, setNeedsUnlock] = useState(!session.isUnlocked());
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | undefined>();

  if (needsUnlock) {
    return (
      <UnlockWalletPrompt
        onUnlocked={() => setNeedsUnlock(false)}
        onCancel={onCancel}
      />
    );
  }

  async function sign() {
    setSigning(true);
    setError(undefined);
    try {
      const signed = await session.withOrderPrivkey(derivationIndex, (privkey) => {
        return validateAndSignPearlPrefundPsbt({
          psbtBase64,
          leaf,
          privkey,
          network,
          contract,
        }).signedPsbtBase64;
      });
      await onSigned(signed);
    } catch (signError) {
      const message = signError instanceof Error ? signError.message : 'Signing failed.';
      setError(message);
      setSigning(false);
    }
  }

  return (
    <div className="om-modal-backdrop" role="dialog" aria-modal="true">
      <div className="om-modal om-wallet-sign">
        <header className="om-modal__header">
          <h2>{title}</h2>
          <button className="om-modal__close" onClick={onCancel} aria-label="Cancel">×</button>
        </header>
        <div className="om-modal__body">
          <p>{intent}</p>
          {summary.kind === 'unknown' ? (
            <p className="om-error">
              ⚠ This request has an unexpected shape ({contract.expectedOutputs.length} outputs).
              Sign only if you trust the source.
            </p>
          ) : null}
          <ul className="om-psbt-summary">
            {summary.lines.map((line, i) => (
              <li key={i}>
                <span className="om-psbt-summary__label">{line.label}</span>
                <span className="om-psbt-summary__value">{line.value}</span>
              </li>
            ))}
          </ul>
          {error ? <p className="om-error">{error}</p> : null}
          <div className="om-modal__actions">
            <button className="om-button" onClick={onCancel} disabled={signing}>
              Cancel
            </button>
            <button className="om-button om-button--primary" onClick={sign} disabled={signing}>
              {signing ? 'Signing…' : 'Sign'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
