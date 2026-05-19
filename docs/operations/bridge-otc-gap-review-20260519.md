# Pearl Bridge And OTC Gap Review - 2026-05-19

This review reflects `dev` after PR #81 (`chore: prepare bridge mainnet
deployment gates`). It is a roll-up of the Pearl-side technical blockers for
the OTC settlement desk, the PRL -> Igra bridge, and the future `wPRL/USDC`
pool. The detailed source checklist remains
`docs/openspec/pearl-infra-ecosystem/tasks.md`.

## Current Build State

The bridge track is no longer only a design. The repo now has:

- `WrappedPearl` and `PearlBridge` contracts with replay protection, separate
  entry/exit pause controls, min/max limits, rolling caps, pilot supply caps,
  processed-exit idempotency, refund handling, and two-step ownership.
- Guarded bridge deployment tooling for `local`, `galleon`, and
  `igra-mainnet`.
- Bridge-service support for Pearl deposit/reserve watches, Igra event polling,
  exit mirroring, reserve-spend matching, reconciliation snapshots, public proof
  DTOs, admin decisions, alert evaluation, and persisted state.
- A local-Igra bridge rehearsal using real public Pearl simnet deposit and
  release txids.
- OTC API, web, indexer, settlement-worker, signer-boundary, monitoring, admin,
  and dev deployment scaffolding.
- Dev Oyster API/web deployment evidence against the live watched-address
  indexer.

## Bridge Blockers

These items block a live bridge pilot and any public `wPRL/USDC` pool:

1. Resolve the live Igra deployment path.
   - PR #81 proved the guarded script locally and proved that mainnet refuses
     without explicit gates.
   - The Galleon attempt failed before broadcast because the configured RPC
     rejected the underlying Kaspa fee as below standardness minimum.
   - Next action: rerun Galleon with an accepted gas/fee path, or replace the
     deploy path and record fresh evidence.

2. Repeat the bridge rehearsal with freshly-created writable Pearl simnet txids.
   - Current rehearsal uses real public simnet txids, but not newly created
     wallet-funded txids controlled during the run.
   - Next action: run `npm --workspace @kaspacom/bridge-service run
     rehearse:simnet-bridge` with writable `pearld`/wallet credentials and
     record new deposit and release evidence.

3. Select reserve addresses, signer policy, and hot/warm/cold limits.
   - The service has cap checks and alerting, but no approved live reserve
     address set or custody policy is recorded.
   - Next action: document reserve tiers, signer ownership, emergency pause
     authority, daily limits, and maximum hot-wallet exposure.

4. Decide and implement bridge reserve custody.
   - The bridge can watch reserve addresses and reconcile reserve spends, but
     the live Pearl reserve address/multisig/threshold-signing construction is
     not implemented or selected.
   - Next action: choose the low-cap pilot custody shape, record the reserve
     address set, and prove the Pearl release signing path before any live exit.

5. Execute an emergency pause drill.
   - The runbook exists, but the live operator drill still needs evidence.
   - Next action: run a low-cap pause/unpause drill against the deployed test
     bridge path and commit the result.

6. Add bridge proof-page/frontend support.
   - Public API contracts exist; user-facing proof pages still need to consume
     them.
   - Next action: add frontend models/pages for deposit status, exit status,
     reserve backing, blockers, event hashes, quorum counts, and cap usage.

7. Upgrade federation/signing beyond the pilot shape.
   - Current bridge decisions use relayer attestations plus manual operator
     approval.
   - Next action: finalize federation membership, relayer independence rules,
     signer custody boundaries, quorum threshold, and threshold/FROST-style
     release authorization or an equivalent reviewed boundary.

## OTC Blockers

These items block a full production-grade Pearl OTC settlement release:

1. Complete a real full-flow OTC run.
   - Automated full-flow coverage exists.
   - The live verifier exists.
   - Still missing: real Base Sepolia `createTrade`, `deposit`, and terminal
     `release` or `refund` txids plus a real PRL signing/broadcast path.

2. Decide whether the first mainnet OTC pilot uses the current coordinator
   P2TR model or waits for true multisig escrow.
   - Current implementation derives one P2TR escrow address per trade from an
     xpub and uses a policy-gated coordinator signer. It is not the final
     non-custodial 2-of-3 buyer/seller/arbiter multisig design.
   - Next action: either approve this constrained custody model for a low-cap
     pilot, or implement Taproot script/MuSig/FROST-style multisig before
     mainnet OTC trades.

3. Replace the remaining simulated Base leg in live evidence.
   - The checker can verify receipts, but the evidence needs actual Base
   Sepolia receipts from the current escrow contract.
   - Next action: run the real Base Sepolia leg and feed the tx hashes into
   `services/otc-api/test/live-full-otc-evidence.test.ts`.

4. Resolve the PRL raw signer path.
   - Oyster currently does not provide arbitrary raw transaction signing for
     the desired path.
   - Next action: use a non-Oyster raw signer path or extend Oyster before
     enabling mainnet PRL release/refund code paths.

5. Move from simnet to explicitly approved low-cap mainnet.
   - Pearl testnet2 is not a mandatory blocker because there is no usable
     faucet/liquidity.
   - Next action: finish the remaining simnet proof, then run only low-cap
     mainnet PRL paths with explicit approval, real txids, public proof, and
     clean reconciliation.

6. Finish production Oyster deployment.
   - Dev API/web are deployed and smoked.
   - Prod secrets, prod image release, prod DNS, and prod smoke checks remain
     open.

7. Replace shared bearer-token admin auth with real operator identity.
   - Multi-token RBAC is present as a compatibility layer.
   - A real identity provider/session layer is still required before broader
     support rollout.

## Pool Blockers

Do not seed `wPRL/USDC` liquidity until all of these are true:

- one low-cap bridge entry passes with public proof;
- one low-cap bridge exit passes with public proof;
- reserve reconciliation has no blockers;
- live reserve addresses and signer policy are approved;
- initial liquidity source, LP ownership, withdrawal authority, emergency
  liquidity removal, price assumptions, and max bridge exposure are approved in
  writing.

## Recommended Next PR Order

1. Deployment proof PR: fix Galleon deployment fee/gas path and commit evidence.
2. Writable simnet proof PR: rerun bridge rehearsal with freshly-created Pearl
   simnet deposit/release txids.
3. Custody policy PR: reserve addresses, signer tiers, emergency pause drill,
   cap policy, and an explicit decision on coordinator P2TR versus true
   multisig/threshold custody for OTC and bridge reserves.
4. Low-cap mainnet proof PR: real Pearl mainnet and Base/Igra txids after
   explicit approval, with public proof and clean reconciliation.
5. Bridge proof UI PR: public bridge deposit/exit/reserve proof pages.
6. Prod Oyster release PR: prod secrets, prod image path, prod DNS, and smoke
   evidence.
