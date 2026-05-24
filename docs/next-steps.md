# Next Steps

## Current Status

The repo is now an implementation repo for the Pearl OTC settlement desk and
the PRL -> Igra bridge track. The original planning/bootstrap phase is complete.

Current state after PR #81:

- OTC API, web app, Pearl indexer, settlement worker, signer boundary, admin
  controls, monitoring docs, and dev Oyster deployment scaffolding are merged.
- Dev Oyster API/web have deployment and smoke evidence.
- `WrappedPearl` and `PearlBridge` contracts are implemented and tested.
- Bridge-service has Pearl watch registration, Igra event mirroring,
  reconciliation snapshots, reserve-spend matching, public proof DTOs, admin
  decisions, persisted state, and alert evaluation.
- Guarded bridge deployment tooling exists for `local`, `galleon`, and
  `igra-mainnet`, with mainnet blocked behind explicit chain ID and approval
  gates.
- A local-Igra bridge rehearsal exists using real public Pearl simnet deposit
  and release txids.

## Immediate Priorities

1. Fix the live Igra deployment path.
   - Galleon deployment currently fails before broadcast because the configured
     RPC rejects the underlying Kaspa fee as below standardness minimum.
   - Re-run with an accepted fee/gas path or replace the deployment route and
     commit evidence.

2. Repeat bridge rehearsal with writable Pearl simnet txids.
   - Use freshly-created wallet-funded Pearl simnet deposit/release txids, not
     only public fixture txids.
   - Keep Pearl mainnet custody disabled.

3. Define live bridge custody policy.
   - Select reserve addresses, signer ownership, hot/warm/cold cap limits,
     emergency pause authority, relayer/operator identities, and final
     multisig owner.
   - Explicitly decide whether OTC mainnet starts with the current
     coordinator-signed P2TR escrow model or waits for true PRL multisig escrow.
   - Simnet 2-of-3 P2TR address/package construction now passes locally and
     has funded spend evidence: OTC release classified as `release`, OTC CLTV
     refund classified as `refund`, and bridge reserve release spent through
     the same 2-of-3 script-path signer policy.
   - The bridge reserve scanner gate passed on 2026-05-20:
     `kaspacom-pearl-indexer-simnet` was redeployed from `origin/dev`, and the
     proof rerun with `PEARL_REQUIRE_BRIDGE_EXIT_RELEASE=1` classified the
     bridge reserve spend as `exit_release` with `amount_grains` and
     `pearl_recipient` metadata.
   - Remaining bridge custody gate: record approved live reserve addresses,
     signer custody, relayer/operator identities, cap limits, and the full
     low-cap entry/exit rehearsal evidence.
   - Treat `exit_release` as classification only; actual release authorization
     must still come from bridge-service matching against an approved pending
     exit, unique release txid, clean reconciliation, and cap limits.

4. Replay OTC live evidence from durable API state.
   - The 2026-05-21 testnet2/Base Sepolia proof recorded real PRL
     funding/release, Base `createTrade`, `approve`, `deposit`, and `release`
     txids, plus public proof fields.
   - The OTC API now records durable `live_proof_evidence` side effects and
     exposes a public evidence route so the verifier can rerun from public
     routes after shutdown when the trade is persisted.
   - OTC escrow watch registration now records distinct Pearl release/refund
     destinations plus templates so fee-adjusted spends classify cleanly.
   - PR #106 plus the 2026-05-24 review hardening covers paste/submit signed
     release broadcast. Native browser Pearl wallet signing and first-class
     refund signing UX remain open.

5. Finish production Oyster release.
   - Populate prod secrets, execute prod image path, configure prod DNS, and
     smoke prod `/healthz`, quote, support-alert, and admin-auth routes.

## Do Not Do Yet

- Do not deploy Igra mainnet bridge contracts until
  `PEARL_BRIDGE_MAINNET_APPROVED=1`,
  `PEARL_BRIDGE_MAINNET_READY_CHECKLIST=1`, chain ID `38833`, final owner,
  relayer, and operator are explicit.
- Do not point bridge signing or reserve release at Pearl mainnet during simnet
  rehearsals.
- Do not seed a `wPRL/USDC` pool until one low-cap bridge entry and one low-cap
  bridge exit have public proof and clean reserve reconciliation.
- Do not enable broad mainnet PRL release/refund code paths from testnet
  assumptions. Finish simnet proof first, then run only explicitly approved
  low-cap mainnet with real txids, public proof, and clean reconciliation.

## Detailed Gap Map

Use `docs/operations/bridge-otc-gap-review-20260519.md` for the current
bridge/OTC blocker list and recommended PR order.
