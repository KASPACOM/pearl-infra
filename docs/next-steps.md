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

4. Complete OTC live evidence.
   - Run the real Base Sepolia `createTrade`, `deposit`, and terminal
     `release` or `refund` leg.
   - Pair it with real PRL signing/broadcast evidence and the live proof
     verifier.

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
- Do not enable mainnet PRL release/refund code paths until the testnet2 escrow
  run records real Pearl and Base Sepolia txids.

## Detailed Gap Map

Use `docs/operations/bridge-otc-gap-review-20260519.md` for the current
bridge/OTC blocker list and recommended PR order.
