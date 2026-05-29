# Embedded Pearl Wallet — Design Plan

**Status:** Locked-in spec, implementation pending.
**Owner:** Marko (lead) / Sione (review).
**Date:** 2026-05-29.

## Why

The Pearl OTC product currently asks users to:

- Paste a Pearl public key into the order form.
- Paste a Schnorr signature (the maker proof) into a separate field.

This was an MVP shortcut and assumes the user has a Pearl wallet extension, which does not exist in any meaningful adoption form. The Mode B prefund flow (manual_confirm) is unbuildable without the maker actually being able to sign PSBTs at match time; the CLTV refund path is unbuildable without the maker being able to sign a refund tx. We need an in-browser Pearl wallet so:

1. Users never paste cryptographic material into a form.
2. The desk never has the maker's private key.
3. Mode B sweep signing happens with one click + one password entry.
4. CLTV refunds work without an external wallet.
5. Sign-in does not require email or an EVM wallet (it can, but the user can opt out).

## Locked-in spec

### Identity model — Option B (HD-derived per-trade keys from one master mnemonic)

- One **12-word BIP39 mnemonic** per user (128 bits entropy).
- Each order derives a fresh keypair via **BIP86** (`m/86'/0'/0'/0/N`) where `N` is a monotonic order index stored in the vault.
- Different on-chain key per trade (per-trade isolation in linkage and storage), but the user has **one phrase** to back up. Lost device = recover from phrase.
- Master seed + derived per-order privkeys are stored in the encrypted vault. The seed is encrypted separately from the derived keys, so an order-level vault leak doesn't expose the master.

Rationale over per-trade-ephemeral wallets:

- One backup phrase regardless of how many orders. A bot maker posting hundreds of orders is the same backup as a one-off user.
- Recovery is unambiguous — "which phrase was for which order" is not a question.
- Mirrors the UX users already know from MetaMask, Phantom, hardware wallets.
- Storage-level isolation per trade is preserved.

### Authentication

- **Password (required)** — Argon2id KDF, 64MB memory, 3 iterations, single parallelism. Produces a 32-byte key for AES-GCM.
- **TOTP 2FA (optional)** — RFC 6238, user opt-in. Second factor on vault unlock. Single-use backup codes generated at enrollment.
- **No email login.** Email is for notifications only, never auth. Already true on the server (`walletType: 'evm' | 'pearl'`); frontend currently hardcodes EVM and must be updated.
- **Pearl-only sign-in.** A user with no EVM wallet can post a sell_prl order — the maker signs their wallet challenge with the embedded Pearl wallet. (Takers still need USDC on Base, so they need a USDC-receiving address, but Mode A takers don't sign anything on Pearl at all.)

### Crypto stack

- **`@scure/bip39`** — BIP39 mnemonic, audited, browser-safe, by Paul Miller (no fs/path deps).
- **`@scure/bip32`** — BIP32 derivation, same author, browser-safe.
- **`tiny-secp256k1`** — Schnorr signing; already in repo via `pearl-script`. Requires WASM bundled in the Vite build.
- **`@noble/hashes`** — Argon2id, HMAC-SHA1 for TOTP, SHA-256.
- **WebCrypto `AES-GCM`** — native browser API for vault encryption.
- **IndexedDB** — vault persistence. localStorage is unsuitable (too small, sync API, accessible to all same-origin JS without explicit gating).

No `bitcoinjs-lib` in the frontend bundle. The `pearl-script` package brings it for the Taproot payment builder, which we need for address derivation — that one usage is acceptable bundle cost.

### Vault schema (IndexedDB `pearl-wallet` store)

```ts
interface PearlWalletVault {
  walletId: string;               // random, stable across re-encryption
  schemaVersion: 1;
  kdf: {
    algorithm: 'argon2id';
    memoryKb: 65536;
    iterations: 3;
    parallelism: 1;
    salt: Uint8Array;             // 16 bytes, per-vault
  };
  totp?: {
    encryptedSecret: Uint8Array;  // AES-GCM with vault key
    backupCodeHashes: string[];   // sha256 hashes
  };
  encryptedSeed: Uint8Array;      // AES-GCM with vault key; opens BIP39 mnemonic
  derivedKeys: Array<{
    derivationIndex: number;      // N in m/86'/0'/0'/0/N
    encryptedPrivkey: Uint8Array; // AES-GCM with vault key
    publicKey: Uint8Array;        // x-only, plaintext for fast address lookups
    address: string;              // tprl1p... / prl1p...
    orderId?: string;             // backlink, if assigned
    createdAt: string;            // ISO timestamp
  }>;
  nextDerivationIndex: number;
  createdAt: string;
  lastUnlockedAt?: string;
  autoLockMs: number;             // default 900_000 (15 min)
}
```

### Auto-lock + memory hygiene

- The decrypted seed and derived privkeys live in memory only after unlock.
- 15-minute idle timeout flushes them. Explicit "lock" button flushes immediately.
- No `setTimeout` references to plaintext keys; everything goes through a single `LockedVault` controller that zeroes its internal state.
- No plaintext key material is ever passed to React component state (which can serialize during devtools snapshots). State only holds opaque vault handles.

### What this replaces

Today's ProfilePage create-offer form has three fields the maker fills manually:

- `makerPearlAddress` (paste)
- `makerPearlPubkey` (paste)
- `makerPearlPubkeyProof` (paste — they generate it elsewhere with the proof message shown to them)

After this workstream, those three fields are gone. The form is just amount + price + mode picker. On submit:

1. If no wallet exists yet, the W4 creation flow runs first (set password, write down phrase, confirm).
2. The wallet derives a fresh keypair, computes the Pearl address, computes the maker proof signature in-browser.
3. The server receives the same wire shape as today, generated locally.

## Threat model

| Adversary | Mitigation |
|---|---|
| Server compromise | Server never has the seed or derived privkeys. Server holds public keys + addresses + proofs, all of which it would have either way. |
| Network MITM | All Pearl signing happens locally. The PSBT to be signed is delivered server → client over HTTPS but the client validates the PSBT structure (W3 contract) before signing. The signed PSBT goes back to the server; even a tampered post-sign tampering would invalidate the signature. |
| Stolen device | Encrypted vault + Argon2id password requirement. Without password, the vault is opaque ciphertext. |
| Stolen device + keylogger | Compromised. TOTP 2FA helps if the user has it on. |
| Lost device | User restores from 12-word phrase on a new device. |
| Phishing site impersonating Oyster | This is the harder one. We will tie the vault to the origin (IndexedDB is origin-scoped — phishing.com cannot read oyster.kaspa.com's vault) and add a future hardening: domain-bound origin attestation in the password screen ("you are signing on oyster.kaspa.com"). |
| Malicious browser extension reading memory | Outside our perimeter. Recommended mitigation in user-facing copy: use a clean profile / install no extensions. |
| Desk insider stealing seed | Cannot — never on the server. |

## Phase plan

Each phase is one PR, stacked. Each phase is independently testable (no UI dependency for W1–W3).

### W0 — Design plan (this PR)

The artifact you're reading. Locks the spec so subsequent code reviews can refer to a fixed target.

### W1 — `packages/pearl-wallet` scaffolding + BIP39/BIP86 primitives

- New package, browser-safe deps only.
- `generateMnemonic()` / `validateMnemonic()` (12 words).
- `mnemonicToSeed(mnemonic, passphrase?)`.
- `deriveOrderKey(seed, index)` → BIP86 `m/86'/0'/0'/0/index` → `{ privkey, pubkey, address }`.
- `pearlAddressFromXOnlyPubkey(pubkey, network)` (uses `pearl-script`).
- Tests: BIP39 wordlist sanity, BIP86 reference vectors (from BIP86 spec), Pearl address determinism across multiple runs.

### W2 — Encrypted vault

- `argon2idDeriveKey(password, kdfParams) → vaultKey`.
- `encryptVault(vault, vaultKey)` / `decryptVault(ciphertext, vaultKey)` using WebCrypto AES-GCM.
- IndexedDB persistence: `openVault`, `saveVault`, `lockVault`.
- `LockedVault` controller — singleton holding the unlocked state with auto-lock timer.
- `changePassword(oldPassword, newPassword)` re-encrypts the vault.
- Tests: round-trip, wrong-password rejection, schema migration hook (for future v2), auto-lock fires.

### W3 — Browser-safe Pearl PSBT signing

- Port the script-path signer from `pearl-escrow/src/script-path-signing.ts` into a browser-safe API in `pearl-wallet`. Audit what assumptions need adapting (Node Buffer vs `Uint8Array`, etc).
- `signPearlPsbt({ psbt, leafKind, derivationPath, vault, password })` → signed PSBT.
- **Mandatory structural validation before signing (L-PR-3 contract):**
  - PSBT has exactly one input, matching the expected outpoint.
  - Each output's destination matches an expected address (passed by caller).
  - Total output amount + fee ≤ input amount; fee ≤ configured cap.
  - Selected leaf is the one the caller asked for (sweep vs refund).
- Reject with explicit error messages if any check fails.
- Tests: signing produces verifiable Schnorr sigs against known test vectors; each validation check rejects appropriately.

### W4 — Wallet creation UI

- New modal flow in `apps/otc-web`. Trigger: user clicks "Create offer" with no wallet yet.
- Steps:
  1. Welcome + explain why ("This is your Pearl wallet, only you can unlock it.").
  2. Set password (with strength meter, min 12 chars).
  3. Show 12 words on a "write these down" screen (no copy button by default; allow only if user clicks a small "I know what I'm doing" link).
  4. Confirm 4 random words (test memorization).
  5. Vault saved + wallet ready.
- Submit path: the form generates `makerPearlPubkey`, `makerPearlPubkeyProof`, `makerPearlAddress` locally. Submits the same request shape as today.

### W5 — Unlock + sign UI

- Lock state shown in header ("Wallet locked" / "Wallet unlocked, locks in 14:32").
- Unlock prompt: password (+ optional TOTP code).
- Sign prompt for sweeps/refunds: shows
  - what's being signed (sweep vs refund),
  - input outpoint,
  - output destination + amount in human-readable PRL,
  - fee,
  - the trade ID this is for.
- Password entry below; Sign button enabled when password is right.
- Wired into Mode B match notifications + CLTV refund button.

### W6 — Recovery flow

- "I lost my device" link on login.
- 12-word phrase input with per-word BIP39 wordlist autocomplete + checksum validation.
- Re-derives all keys, asks for new password to create a fresh vault.
- Tests: phrase → identical derived addresses vs the original.

### W7 — Optional TOTP 2FA

- Settings screen entry: "Enable 2FA".
- Provisioning: shows QR code (provisioning URI per RFC 6238), user adds to Google Authenticator / Authy / 1Password.
- 8 single-use backup codes generated, shown once.
- On unlock: password + 6-digit code → vault unlocks. Backup codes work in place of TOTP if device is lost.
- Disable: requires current password + current TOTP.

### W8 — Pearl-only sign-in

- Backend already supports `walletType: 'pearl'` in `createWalletChallenge` + `verifyWalletChallenge`.
- Frontend currently hardcodes `'evm'` in `ProfilePage.createOffer()`. Change to: if user has a Pearl embedded wallet, sign the challenge with it. EVM wallet stays optional for the USDC receive address (still required to prove ownership of `makerUsdcAddress`).

### W9 — Mode B sweep + CLTV refund integration

- Notification handler: when server pushes "your order matched, sign sweep", deep-link to the sign UI with the prepared PSBT.
- The PSBT comes from the server's `prepareSweepPsbt` (Mode B prepare step that doesn't yet exist as a concrete implementation — it's the deferred C5 builder). This phase assumes that builder is also delivered.
- Refund button in the order list: triggers `requestPrefundRefund`, server returns the PSBT, client signs locally, submits via a new endpoint `submitSignedPrefundRefund({orderId, signedPsbtBase64})`.

## Open dependencies on other workstreams

- **C5 concrete sweep PSBT builder** (server side) must exist before W9 is useful. Without it, the embedded wallet has nothing to sign for sweeps. The interface is locked, the impl is the gap.
- **C6 concrete refund PSBT builder** same story for refunds.

These two server-side PSBT builders + this client-side wallet are the two halves of "Mode B actually works." Either half alone is unshippable.

## Sequencing recommendation

| Slot | Workstream | Notes |
|---|---|---|
| Now | W0 (this doc) | Land for review. |
| Slot 1 | W1 + W2 + W3 | All three are crypto primitives, testable in isolation, no UI. Land in 3 stacked PRs. |
| Slot 2 | W4 (create wallet) + W5 (sign UI) | First UI work. Slot 1 must be done. |
| Slot 3 | W8 (Pearl sign-in) + W6 (recovery) | Smaller, parallel to nothing. |
| Slot 4 | W7 (2FA) | Optional, can ship later. |
| Slot 5 | W9 (integration) | Blocked on the concrete server PSBT builders for sweep + refund. Coordinate launch with that workstream. |

## Effort sense

- W1–W3 (primitives): ~500 LOC each, with tests; ~3 PRs.
- W4–W6 (UI): chunkier; ~800–1200 LOC each, lots of state machine work.
- W7 (2FA): ~400 LOC.
- W8 (sign-in): small change, ~150 LOC.
- W9 (integration): depends on the server PSBT builders, but the client wiring itself is ~200 LOC.

Total ballpark: 5–7 PRs, three weeks of focused work if all goes well, plus the matching server-side PSBT builder workstream landing in parallel.

## What this does NOT cover

- Hardware wallet support (Ledger / Trezor for Pearl) — useful eventually, not a v1 priority.
- WebAuthn / passkey unlock — could replace password in a follow-up; we noted it but did not lock it in.
- Cross-device sync (e.g. iCloud Keychain integration). Recovery via phrase is the supported cross-device path for v1.
- Social recovery / multi-party guardians. Not in scope.
- Mobile app. Web only for v1.
