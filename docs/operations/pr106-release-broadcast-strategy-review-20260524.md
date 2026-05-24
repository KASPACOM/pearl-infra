# PR #106 Release Broadcast Strategy Review - 2026-05-24

This review covers PR #106 (`feat: submit signed Pearl release transactions`)
after merge to `dev`, then records the follow-up hardening loop.

## Strategy Boundary

The current strategy is acceptable as an intermediate paste/broadcast bridge:
the server creates the unsigned release/refund transaction template, the user
or operator supplies a signed transaction, and the API broadcasts it only when
the trade is already in `release_pending` or `refund_pending`.

This is not yet the final self-serve wallet strategy. Native browser Pearl
wallet signing and first-class refund signing UX are still required before the
platform can claim fully self-serve PRL release/refund from the browser.

## Reviewed Loopholes

- Template tampering: fixed by comparing signed transaction version, locktime,
  inputs, outputs, scripts, and values against the server unsigned template
  before RPC broadcast.
- Partial witness acceptance: hardened after review. Every input must now carry
  witness data, not merely one input.
- Retry / idempotency replay: hardened after review. The API now reserves the
  `pearl_release` or `pearl_refund` side-effect idempotency key before Pearl RPC
  broadcast, returns the existing submitted side effect for safe retries, and
  rejects duplicate in-progress reservations before another RPC call.
- RPC txid mismatch: PR #106 already rejected a broadcaster-returned txid that
  does not match the locally decoded signed transaction id.
- State bypass: PR #106 already gates release broadcast to `release_pending` and
  refund broadcast to `refund_pending`.
- Public actor spoofing: PR #106 records the broadcast side effect with
  server-assigned `actor=user`; request bodies cannot choose the actor.
- Stale template signing: the server recomputes the current intent and rejects
  signed transactions that no longer match the current indexed outpoint/template.

## Remaining Non-Production Gaps

- Browser-native Pearl wallet signing is still missing; the checkout only
  supports paste/submit for a signed release transaction.
- Refund signing has backend intent/broadcast support, but the first-class
  checkout refund UX is still missing.
- A broadcast can still succeed on Pearl RPC and then fail during the final DB
  update; the side effect is reserved before RPC, but no API can make Pearl RPC
  and Postgres a single atomic transaction. Operational recovery must reconcile
  reserved/submitted side effects against the Pearl txid/indexer.
- The May 21 full live proof used a one-off in-memory API runner; the proof must
  be productized through Postgres or a durable live API process before it can be
  rerun from public routes after shutdown.

## Evidence

- PR #106 merged to `dev` on 2026-05-24 as
  `65e01e347600ddb295f79e5925f9b71087a778db`.
- GitHub CI for PR #106 passed `test`, `typecheck`, and
  `usdc-escrow-contracts`.
- Local hardening verification:
  - `npm run typecheck`
  - `npm test --workspace @kaspacom/otc-api -- --test-name-pattern "Pearl multisig release intent"`: 72 pass, 1 skipped
  - `npm test --workspace @kaspacom/otc-api -- --test-name-pattern "PgOtcRepository persists side effects"`: 72 pass, 1 skipped
- Full testnet2/Base Sepolia evidence is recorded in
  `docs/operations/full-otc-testnet2-evidence-20260521.md`.
