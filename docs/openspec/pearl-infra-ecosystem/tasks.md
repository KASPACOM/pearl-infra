## 1. Repository Bootstrap

- [x] 1.1 Create local working tree under `/home/coder/projects/pearl/pearl-infra` and push to `marciano147/Pearl-infra-ecosystem`.
- [x] 1.2 Add README with repo purpose, phase, planned modules, and explicit non-goals.
- [x] 1.3 Add upstream manifest pinned to `pearl-research-labs/pearl` commit `0c8cef72da75d10ffd52ac20d3c0b075d9d9f1f7`.
- [x] 1.4 Copy this OpenSpec proposal/design/specs/tasks into the repo for review.
- [x] 1.5 Verify git status is clean and push the bootstrap commits.

## 2. Upstream Pearl Source Handling

- [x] 2.1 Decide submodule vs fetch script vs subtree for upstream Pearl source. Decision: git submodule pinned to inspected commit.
- [x] 2.2 Add selected upstream source mechanism pinned to the inspected commit.
- [x] 2.3 Document every reused path: `node/`, `wallet/`, `spv/`, `apps/apps/pearl-desktop-wallet`, `apps/packages/pearl-address-validation`, `miner/`, `py-pearl-mining/`, and relevant docs.
- [x] 2.4 Add license and update procedure notes.

## 3. Chain and Wallet Service Contracts

- [ ] 3.1 Define canonical Pearl network config for mainnet, testnet/testnet2, simnet/regtest, and local dev.
- [ ] 3.2 Draft typed `pearld` RPC adapter contract for app-safe chain queries and transaction broadcast.
- [ ] 3.3 Draft typed `oyster` wallet RPC adapter contract for address, balance, transaction, signing, and publish flows.
- [ ] 3.4 Add fixture-based adapter tests using mocked RPC responses.

## 4. Indexer and Explorer Foundation

- [ ] 4.1 Define normalized data models for block, transaction, output, input, address activity, mempool entry, miner summary, and OP_RETURN data.
- [ ] 4.2 Design read-only indexer ingestion flow from `pearld`/Blockbook-compatible sources.
- [ ] 4.3 Add app-facing chain-data API contract for tx/block/address/mempool/miner endpoints, reusing Pearl explorer/Blockbook first.
- [ ] 4.4 Add validation fixtures from live Pearl public endpoints without committing secrets.

## 5. Wallet SDK Foundation

- [ ] 5.1 Extract or wrap Pearl address validation into a reusable SDK interface.
- [ ] 5.2 Define payment request schema for Pearl Pay and future wallets.
- [ ] 5.3 Define transaction lifecycle API: construct, fund, sign, publish, observe confirmations.
- [ ] 5.4 Define future connector API (`connect`, `getAccounts`, `signMessage`, `signTransaction`, `sendTransaction`) without implementing extension UX yet.

## 6. Market App Rails

- [ ] 6.1 Define Pearl Pay invoice, callback, and confirmation service interfaces.
- [ ] 6.2 Define OTC public market data ingestion and normalization contracts.
- [ ] 6.3 Research Pearl escrow/multisig feasibility and add a security review gate before implementation.
- [ ] 6.4 Define AI compute marketplace control-plane interfaces for model catalog, operator registration, health, metering, billing, and PRL reward reporting.

## 7. Quality Gates and Review

- [x] 7.1 Add goal-based execution checklist to repo contributing docs.
- [ ] 7.2 Add minimal CI plan for lint/typecheck/test once implementation begins.
- [x] 7.3 Run OpenSpec validation/status and include evidence in the bootstrap report.
- [x] 7.4 Present repo/specs to Sione for approval before implementing product code.

## 8. Pearl OTC Settlement Desk Planning

- [x] 8.1 Define the OTC settlement desk product architecture, components, settlement states, and MVP scope.
- [x] 8.2 Define RFQ quote and trade lifecycle API contracts.
- [x] 8.3 Define Pearl escrow package format: Taproot address, funding outpoint, release/refund templates, signatures, and refund eligibility.
- [x] 8.4 Define Base USDC escrow contract interface and event schema.
- [x] 8.5 Define Pearl indexer schema and APIs needed for escrow proof pages.
- [x] 8.6 Add security gates for mainnet-disabled escrow code, simnet verification, arbiter key handling, and admin overrides.
- [x] 8.7 Scaffold implementation packages only after 8.2-8.6 have concrete success criteria and verification commands.
- [x] 8.8 Switch the MVP USDC escrow leg to Base-first settlement with Base/Base Sepolia network config.

## 9. OTC MVP Implementation

Merged implementation checkpoints:

- PR #3 — switched OTC USDC settlement to Base.
- PR #4 — scaffolded the single-machine Pearl indexer.
- PR #5 — added OTC API quote/trade state core.
- PR #6 — added Base USDC escrow Foundry tests and deployment evidence.
- PR #7 — added OTC API HTTP routes.
- PR #8 — added OTC web typed API client and Base USDC escrow call builders.
- PR #9 — added restart-safe Postgres sink and reorg detection.
- PR #10 — designed the shared watched-addresses primitive for OTC + bridge.
- PR #11 — added watched-addresses schema plus `bridge_exit_requests`.
- PR #12 — added watched-address repository, Postgres implementation, HTTP
  handler, and indexer boot wiring.
- PR #13 — synced OTC/bridge checklist items and added product-level escrow
  invariants.
- PR #14 — hardened Base USDC escrow expiry tests and ownership checklist.
- PR #15 — added watched-address repository and HTTP unit tests.
- PR #16 — added the Hetzner watched-address integration smoke and localhost
  HTTP bind.
- PR #17 — added OTC trade deadlines and fail-closed edge states.
- PR #18 — added the OTC operator edge-case runbook.
- PR #19 — defined `wPRL` token controls for the Igra bridge track.
- PR #20 — synced implementation checklist after PRs #13-#19.
- PR #21 — added the indexer mainnet stack alongside testnet2.
- PR #22 — split `PEARLD_MAINNET_MINING_ADDRESS` env so the mainnet pearld
  container stops crash-looping on a testnet-encoded placeholder. Mainnet
  observation is live on Hetzner (port 8089).
- PR #23 — recorded Base Sepolia escrow lifecycle evidence.
- PR #24 — replaced in-memory OTC API persistence with a Postgres
  repository, gated `createTrade()` on real quote acceptance, added the
  on-chain USDC term verifier, and added the side-effect ledger. Closes
  9.2.6, 9.2.8, 9.2.10, and 9.2.11.
- PR #25 — synced implementation checklist after PRs #20-#22 and #24.
- PR #26 — added the funding output detection design for 9.3.6 and 9.3.6.a.
- PR #27 — added the first `packages/pearl-escrow` P2TR escrow package.
- PR #28 — wired OTC API quote acceptance to the real Pearl escrow allocator.
- PR #29 — added Pearl escrow simnet fixture tests.
- PR #30 — added the Pearl indexer funding output detection scanner slice.
- PR #31 — documented Pearl escrow signer custody and recovery-package design.
- PR #32 — added Pearl escrow signer/broadcast hooks and Pearl RPC broadcast
  wrapper. Closes 9.7.5.
- PR #33 — added the settlement-worker decision core and release/refund guard
  regression tests. Closes 9.5.1 through 9.5.9.
- PR #34 — added the OTC web frontend design brief for 9.4.x.
- PR #35 — synced the checklist after escrow worker and broadcast merges.
- PR #36 — rewrote the OTC web design brief to avoid pearl-otc.com mimicry
  and added offers/my-quotes screen direction.
- PR #37 — added OTC web RFQ, quote acceptance, checkout, proof, deadline,
  manual-review, and side-effect page models. Closes 9.4.1.a, 9.4.2.a,
  9.4.3.a, 9.4.4.a, 9.4.6.a, 9.4.7.a, and 9.4.8.a.
- PR #38 — hardened OTC API production startup and canonical request-hash
  idempotency. Closes 9.8.1 and 9.8.2.
- PR #39 — persisted Pearl escrow derivation allocations with uniqueness and
  retry on collision. Closes 9.8.4.
- PR #40 — wired real Pearl escrow quote acceptance to Pearl indexer watch
  registration before returning funding details. Closes 9.8.5.
- PR #41 — added Pearl indexer spend detection with release/refund/unknown
  classification. Closes 9.3.7 and 9.3.7.a.
- PR #43 — projected public Pearl proof fields from active indexer
  observations/spends in the OTC API. Closes 9.8.6.
- PR #44 — hardened Pearl funding classification and detach/replay reorg
  coverage. Closes 9.3.6, 9.3.6.a, 9.3.8, and 9.3.8.a.
- PR #45 — added the Base Sepolia native-USDC stress harness with multiple
  fresh wallets, release/refund/cancel/pause/unauthorized/reuse/parallel
  checks, expected revert selectors, and redacted RPC evidence. Strengthens
  9.6.5 evidence.
- PR #48 — added Base escrow event normalization/storage and the persistent
  settlement-worker iteration that consumes Pearl proof state, Base event
  state, signer, and broadcaster adapters. Closes 9.8.7 and 9.8.8.
- PR #49 — added the Pearl signer boundary with fee caps, expected template
  hash verification, release/refund output policy checks, signer key custody
  controls, persistent request records, append-only audit records, retry-safe
  state, and no live broadcast from the signer path. Closes 9.8.9.
- PR #50 — synced the checklist after PR #48 and PR #49.
- PR #51 — added OTC deployment environment contracts, canonical secret names,
  simnet/testnet2 env examples, testnet2 node/indexer deployment checklists,
  and monitoring contracts for lag, deadlines, failed broadcasts, duplicate
  events, manual-review backlog, and mismatched terms. Closes 9.6.1, 9.6.2,
  9.6.3, 9.6.11, 9.8.3, and 9.8.13.
- PR #52 — documented the OTC status and remaining loopholes.
- PR #53 — added rendered OTC web screens for RFQ, quote accept, checkout,
  public proof, and admin shell.
- PR #54 — added admin diagnostics and support-alert backend APIs.
- PR #55 — added webhook delivery for support alerts.
- PR #56 — added Telegram support-alert delivery.
- PR #57 — expanded the Pearl admin remaining checklist.
- PR #58 — wired the admin trade list UI.
- PR #59 — hardened admin backend controls, auth, redaction, filters, and
  alert replay.
- PR #60 — added Oyster app deployment pipelines, Argo manifests, and image
  contracts.
- PR #61 — fixed Pearl indexer reorg replay.
- PR #62 — added the Oyster dark landing page and FAQ.
- PR #63 — hardened public OTC API inputs.
- PR #64 — hardened the PRL transaction runtime in the settlement worker.
- PR #65 — added Pearl bridge service reconciliation.
- PR #66 — added `WrappedPearl` and `PearlBridge` EVM contracts.
- PR #67 — recorded Pearl simnet escrow evidence.
- PR #68 — added bridge quorum attestations.
- PR #69 — clarified the remaining bridge checklist.
- PR #70 — added bridge persistence repository, Igra event mirror helpers, exit
  lifecycle projection, reserve-spend matcher, public bridge proof/status HTTP
  routes, admin decision routes, pilot alerts, and the bridge pilot runbook.
- PR #71 — synced bridge checklist state after PR #70.
- PR #72 — added automated full OTC flow coverage for quote acceptance, unique
  simnet escrow watch registration, wallet-funded PRL proof facts, Base
  deposit/release projection, worker release/refund decisions, and public proof.
- PR #73 — wired bridge live event indexing: Igra RPC polling with checkpoints,
  Postgres-backed mirrored exits, reserve-spend application, and Pearl indexer
  scanner updates for bridge reserve spends.
- PR #74 — hardened full OTC flow coverage with xpub-backed unique simnet P2TR
  escrow allocation, indexer-shaped PRL proof projection, and fail-closed Base
  event term validation before PRL release preparation.
- PR #75 — synced the implementation checklist after PR #74 and refreshed the
  remaining owner queue.
- PR #76 — hardened bridge live indexing after strategy review: `ExitProcessed`
  now remains a liability as `processed` until Pearl release spend confirmation,
  Igra polling is replay-safe and address-validated, checkpoints are monotonic,
  and Postgres enforces unique exit IDs plus unique release txids.
- PR #77 — synced the checklist after bridge hardening.
- PR #78 — added the full OTC live evidence verifier.
- PR #79 — applied Oysters Market branding.
- PR #80 — added bridge simnet rehearsal evidence for deposit, mint, exit,
  release, proof, and reserve reconciliation.
- PR #81 — prepared guarded bridge mainnet deployment gates.
- PR #82 — synced bridge/OTC remaining work.
- PR #83 — applied final Oysters branding assets.
- PR #84 — tightened EVM bridge pilot safety coverage.
- PR #85 — closed Oysters branding edge cases.
- PR #86 — added the Pearl multisig simnet escrow package.
- PR #87 — hardened bridge live deployment gates.
- PR #88 — hardened the PRL-side multisig proof gates: strict refund locktime
  validation, x-only signer metadata, Taproot control-block recomputation,
  `PEARL_REQUIRE_BRIDGE_EXIT_RELEASE=1`, exact reserve-release matching by
  amount plus Pearl recipient, duplicate pending-exit blockers, malformed
  `exit_release` blockers, and docs clarifying that `exit_release` is only a
  shape signal, not final authorization.
- PR #90 follow-up audit — tightened the bridge reserve strategy so
  reconciliation only counts a reserve spend as known after the shared matcher
  proves it maps to exactly one mirrored exit, normalizes amount/address fields,
  rejects wrong-purpose reserve watches, and enforces duplicate release/exit
  guards in local repositories as well as Postgres.
- Open PR #96 — wires and hardens the OTC dev multisig app flow:
  `p2tr_multisig` API allocation, trade-id-committed 2-of-3 Pearl Taproot
  escrows, buyer/seller signer-ownership proofs bound to quote terms, public
  release-intent templates, FE custody/release-signing choices, and dev env
  defaults for multisig custody.
- Open PR #99 — binds public order execution to maker signer proofs:
  order creation now requires a maker BIP340 signer proof, order-priced quotes
  carry maker accept prefill, order-linked quote accept requires multisig and
  verifies maker/taker signer ownership, and order fill plus trade/event
  persistence is atomic in Postgres.

Review snapshot after PR #90 follow-up audit: PRs #71-#89 are merged into `dev`.
The bridge service and PRL-side proof strategy now fail closed for the known
reserve-spend loopholes: release-shaped spends must match exactly one mirrored
exit before reconciliation treats them as known, malformed or ambiguous matcher
inputs stay blockers, non-reserve watches cannot be counted as reserve backing,
and local plus Postgres repositories reject duplicate exit/release identities.
Mainnet remains blocked until live custody addresses/signer policy are approved.

Current Pearl OTC code/workflow status:

- API/trade workflow is implemented through quote, accept, persistent trade
  state, side-effect idempotency, on-chain Base term verification, Pearl watch
  registration, and public proof projection.
- Pearl indexer workflow is implemented through watched-address registration,
  funding detection/classification, spend classification, detach/replay reorg
  handling, and proof history APIs.
- Base workflow is implemented through the native-USDC escrow contract, Base
  Sepolia deployment/stress evidence, event normalization/storage, and worker
  Base state consumption.
- Settlement workflow is implemented through persistent decision records,
  fail-closed manual-review decisions, PRL release/refund preparation, USDC
  release preparation after confirmed PRL release, and duplicate-safe worker
  iterations. The worker-to-PRL bridge now has JSON-backed decision storage,
  signer-boundary adapters, durable broadcast-attempt storage, simnet-shaped
  release/refund transaction tests, automated quote-to-proof flow coverage, and
  an opt-in live `pearld` RPC smoke test.
- Signer workflow is implemented through fee caps, expected template hashes,
  output-policy checks, signer key allow-list/pause controls, persistent
  request state, append-only audit records, retry-safe requests, and no
  broadcast from the signer path.
- Ops workflow is implemented through explicit env contracts, secret names,
  non-secret env examples, testnet2 node/indexer deployment checklists, and
  monitoring contracts.
- Frontend workflow is implemented through rendered RFQ, quote accept,
  checkout, public proof, and admin/manual-review screens built from the
  existing typed clients and page models. The admin UI is wired to the backend
  diagnostics API for list/detail, expanded filters, pagination, support
  notes, manual-review notes, failed alert-delivery replay, and the public
  support/error alert form. PR #96 adds the public multisig custody and release
  intent UX while keeping direct release/refund execution controls absent.

Current delegation queue after PR #99:

- Bridge proof/scanner owner: PR #88 closed the strategy loopholes in code and
  tests, and the 2026-05-20 simnet proof rerun passed with
  `PEARL_REQUIRE_BRIDGE_EXIT_RELEASE=1`. Remaining bridge evidence task is the
  full bridge rehearsal with freshly-created writable Pearl simnet deposit and
  release txids plus Igra-side entry/exit evidence.
- Bridge FE owner: implement `10.10.5` proof-page/frontend models for deposit
  status, exit status, reserve backing, blockers, public audit fields, event
  hashes, and quorum counts.
- Bridge ops/custody owner: complete `10.11.3` by selecting live reserve
  addresses, signer policy, hot/warm/cold reserve caps, signer identities,
  monitoring alerts, and an emergency pause drill.
- Bridge mainnet-prep owner: Pearl testnet liquidity is unavailable, so prepare
  Igra mainnet deployment tooling behind explicit chain/approval/role gates,
  first prove the Galleon/replacement deployment path, and keep Pearl proof
  testing on simnet until mainnet custody is approved.
- Threshold authorization owner: scope `10.13.1` through `10.13.3` for
  federation membership, signer custody, threshold/FROST-style authorization,
  and public reserve proof snapshots.
- EVM audit owner: re-audit `WrappedPearl` and `PearlBridge` before pilot
  rehearsal, covering ownership transfer, operator/relayer permissions, cap
  semantics, pause behavior, replay protection, exit liabilities, deployment
  scripts, and verification evidence.
- OTC evidence owner: productize the 2026-05-21 testnet2/Base Sepolia proof by
  persisting live proof trades in Postgres or replaying them through a durable
  API process. The remaining evidence blocker is repeatable runtime evidence
  from public routes, not the one-off transaction proof itself.
- OTC order execution owner: build the remaining `/market` taker UX that calls
  `POST /otc/orders/:orderId/quotes`, carries the returned maker prefill into
  quote accept, and shows order-linked open trades in the user dashboard.
- Oyster/dev ops owner: after PR #96 merges, add the dev
  `PEARL_ESCROW_ARBITER_PUBKEY` secret, switch the dev API allocator to
  `p2tr_multisig`, deploy the new API/web images, and smoke the browser path
  through quote, multisig accept with buyer/seller signer proofs, Pearl
  funding/proof, Base create/deposit, and release intent. A settlement-worker
  Kubernetes runtime is still missing and must be packaged/deployed before
  unattended settlement can be claimed.
- Base ops owner: `9.6.7` is complete on Base Sepolia; keep `9.6.9` blocked
  until explicit Base mainnet approval.
- Oyster/prod ops owner: finish `9.10.6.c`, `9.10.8.e`, `9.10.9.b`, and
  `9.10.10.g` only when prod release is approved.
- Pool planning owner: keep `10.12` blocked until one low-cap entry and one
  low-cap exit pass with public proof and clean reserve reconciliation.

### 9.1 Base Smart Contract

- [x] 9.1.1 Add Foundry or Hardhat project setup under `contracts/usdc-escrow`.
- [x] 9.1.2 Add tests for create, deposit, release, refund, cancel-expired, pause, and unauthorized callers.
- [x] 9.1.3 Add Base Sepolia deployment config using the native USDC address.
- [x] 9.1.4 Keep mainnet deployment disabled until review, multisig ownership, and testnet evidence exist.
- [x] 9.1.5 Record that this implementation PR does not deploy any escrow contract.
- [x] 9.1.6 Add explicit tests for expiry boundary behavior: deposit at/before expiry, blocked deposit after expiry, buyer refund after expiry, and cancel of created-but-undeposited trades.
- [x] 9.1.7 Decide whether MVP contract keeps one `owner` or moves to role separation before mainnet: trade creator, releaser, refunder, pauser, admin.
- [x] 9.1.8 Add a production ownership checklist requiring multisig/two-step ownership before any mainnet USDC escrow is enabled.

### 9.2 OTC API And Trade State

- [x] 9.2.1 Add quote create/accept/get/proof API core under `services/otc-api`.
- [x] 9.2.2 Implement one canonical trade state machine using shared `packages/pearl-sdk` types.
- [x] 9.2.3 Add idempotency keys for quote creation, quote acceptance, settlement transitions, callbacks, and admin actions.
- [x] 9.2.4 Add mocked persistence tests before introducing production database plumbing.
- [x] 9.2.5 Add HTTP routes around the API core.
- [x] 9.2.6 Replace in-memory persistence with the shared database layer.
- [x] 9.2.7 Add explicit deadline fields to the trade model: `quote_expires_at`, `pearl_funding_deadline`, `usdc_deposit_deadline`, `settlement_deadline`, and `refund_available_at`.
- [x] 9.2.8 Enforce that `createTrade()` on the EVM escrow is called only after quote acceptance / real match, never on page load or quote preview.
- [x] 9.2.9 Add internal statuses for edge cases: `late_prl_funding`, `usdc_refunded`, `prl_release_failed`, `amount_mismatch`, `reorged`, `stale_indexer`, and `unknown_spend`.
- [x] 9.2.10 Verify on-chain USDC escrow terms match backend trade terms before the frontend is allowed to show the buyer the deposit action.
- [x] 9.2.11 Persist every external side effect with idempotency key, source event ID, tx hash/outpoint, observed height/block, and actor.

### 9.3 Pearl Indexer

- [x] 9.3.1 Add single-machine indexer runbook and Docker Compose topology.
- [x] 9.3.2 Add minimal block polling loop with mocked `pearld` RPC tests.
- [x] 9.3.3 Add initial Postgres schema for blocks, indexer state, and escrow watches.
- [x] 9.3.4 Add restart-safe Postgres sink and `next_height` state.
- [x] 9.3.5 Add escrow watch registration API and proof API. Generalized into a shared "watched addresses" primitive that also serves 10.8 (bridge deposits + reserves). See `docs/operations/escrow-watch-api.md` for the design.
  - [x] 9.3.5.a Migration `002_watched_addresses.sql` — drop `escrow_watches`, add `watched_addresses` + `address_observations` + `address_spends` + `bridge_exit_requests`.
  - [x] 9.3.5.b Repository module + types + in-memory fake. Completed in PR #12.
  - [x] 9.3.5.c Postgres implementation of repository. Completed in PR #12.
  - [x] 9.3.5.d HTTP handler (POST `/watches`, GET `/watches/:id`, POST `/watches/:id/close`) + server boot wiring into `main.ts`. Completed in PR #12.
  - [x] 9.3.5.e Unit tests (repository + handler).
  - [x] 9.3.5.f Integration smoke: register → close → read round-trip against postgres on the Hetzner box.
- [x] 9.3.6 Add funding output detection for watched P2TR escrow addresses.
- [x] 9.3.6.a Classify PRL funding as on-time, late, underpaid, overpaid, duplicate, or reorged using the trade/deposit deadlines supplied in watch metadata.
- [x] 9.3.7 Add spend detection using resolved prevouts, with release/refund/unknown classification.
- [x] 9.3.7.a Add `unknown_spend` handling that blocks settlement and requires manual review.
- [x] 9.3.8 Add detach/replay reorg tests.
- [x] 9.3.8.a Add regression test: confirmed PRL funding becomes detached after a reorg and settlement worker can no longer release USDC.
- [x] 9.3.8.b Fix live Pearl indexer reorg replay so detached historical blocks
  can coexist with replacement canonical blocks at the same height, and startup
  resumes from an unfinished detached fork point. Also handle pearld verbosity
  `2` blocks returning full transactions under `rawtx`.
- [x] 9.3.9 Document that testnet2 integration ingest is not currently
  actionable because no usable Pearl testnet faucet/liquidity is available.
  Keep the adapter compatible with testnet2, but do not block the bridge/OTC
  path on it.

### 9.4 Frontend Checkout

- [x] 9.4.1 Add RFQ buy/sell PRL page in `apps/otc-web`.
  - [x] 9.4.1.a Add RFQ page model with buy/sell tabs, PRL amount validation,
    Pearl/Base address validation, and locked USDC-on-Base request shaping.
- [x] 9.4.2 Add checkout status page using mocked API responses.
  - [x] 9.4.2.a Add quote-acceptance and trade-checkout page models for mocked
    API responses, role-based seller fields, state badges, leg cards, and
    timeline facts.
- [x] 9.4.3 Add public proof page for Pearl and Base settlement legs.
  - [x] 9.4.3.a Add public proof page model for quote terms, deadlines, Pearl
    facts, Base facts, timeline events, and read-only action gating.
- [x] 9.4.4 Add admin/manual-review shell for stuck trades.
  - [x] 9.4.4.a Extend the OTC web API client with side-effect list/record
    routes needed by the operator manual-review shell.
  - [x] 9.4.4.b Add backend admin diagnostics endpoints for trade list, trade
    debug detail, user support/error alerts, support summary, bearer-gated
    admin routes, webhook/Telegram alert delivery, and audited manual-review
    notes.
  - [x] 9.4.4.c Build the admin trade list UI with state/manual-review/search
    filters and alert/backlog indicators.
    - [x] 9.4.4.c.1 Wire the admin list to `GET /otc/admin/trades` instead of
      demo data.
    - [x] 9.4.4.c.2 Implement live state filter, manual-review-only toggle, and
      search query controls.
    - [x] 9.4.4.c.3 Show alert count, failed side-effect count, deadline breach,
      blocker, and backlog indicators in the list.
  - [x] 9.4.4.d Build the admin trade debug detail UI showing trade state,
    Pearl watch/proof history, Base events, side effects, audit notes,
    deadlines, blockers, and safe actions.
    - [x] 9.4.4.d.1 Add a real admin detail route backed by
      `GET /otc/admin/trades/:tradeId`.
    - [x] 9.4.4.d.2 Render trade state, support summary, current blockers,
      deadline breaches, safe actions, public proof path, events, and side
      effects from the backend debug payload.
    - [x] 9.4.4.d.3 Keep release, refund, signing, and trade-term editing
      controls absent from the operator UI.
  - [x] 9.4.4.e Add the user support/error alert form and copyable support
    summary so support can escalate stuck trades quickly.
    - [x] 9.4.4.e.1 Wire the user support/error alert form to
      `POST /otc/trades/:tradeId/support-alerts`.
    - [x] 9.4.4.e.2 Wire the admin "Add note" action to the audited
      manual-review endpoint without exposing arbitrary state edits.
    - [x] 9.4.4.e.3 Display alert delivery status, including failed
      `support_alert_delivery` records, so operators know when Telegram/webhook
      escalation failed.
- [x] 9.4.5 Add typed OTC API client and Base USDC escrow ethers call builders using the shared ABI/config.
  - [x] 9.4.5.a Let checkout build approval/deposit calldata from the
    server-authoritative trade contract and token fields instead of hardcoding
    the Base Sepolia deployment in the UI.
- [x] 9.4.6 Show all relevant deadlines and disable USDC deposit when the deposit cutoff has passed or when on-chain trade terms do not match backend terms.
  - [x] 9.4.6.a Add shared deadline models and deposit-action gating for wallet
    connection, chain mismatch, expired USDC deposit windows, and failed
    on-chain term verification.
  - [x] 9.4.6.b Wire the checkout Base action to injected-wallet connect,
    network switch, USDC approval, and escrow deposit transactions while keeping
    release/refund controls off the user surface.
  - [x] 9.4.6.c Harden checkout deposit gating so the connected wallet must
    match the accepted buyer address, PRL funding must be confirmed, and
    trade/verification/wallet state is re-read immediately before approval and
    deposit broadcast.
  - [x] 9.4.6.d Wire the admin Base escrow setup action to prepare the
    server-authoritative `createTrade` intent, send the owner transaction from
    the operator wallet, and audit the confirmed tx as a side effect.
  - [x] 9.4.6.e Harden the admin Base setup path so admin tokens are never
    compiled into the public web bundle, create-intent/side-effect audit actors
    are stamped from bearer credentials, and `createTrade` is chain-verified
    before and after wallet broadcast.
- [x] 9.4.7 Display late funding, refunded, reorged, stale indexer, and manual-review states without offering release actions to users.
  - [x] 9.4.7.a Add shared state families and failure banners for all manual
    review states, with checkout/proof models explicitly hiding release actions.
- [x] 9.4.8 For proof pages, show quote terms, deadlines, PRL funding/release/refund txids, USDC deposit/release/refund txids, confirmations, and manual-review reason.
  - [x] 9.4.8.a Add proof-page model coverage for deadlines, PRL/Base tx facts,
    confirmations, timeline entries, and manual-review banner copy.

### 9.5 Settlement Worker

- [x] 9.5.1 Join mocked Pearl proof state with mocked Base escrow events.
- [x] 9.5.2 Implement idempotent release/refund decision records.
- [x] 9.5.3 Fail closed to manual review on inconsistent, stale, or reorged observations.
- [x] 9.5.4 Add tests for duplicate events and inconsistent settlement legs.
- [x] 9.5.5 Enforce release guard: PRL release is allowed only when trade is active, USDC is still deposited, PRL funding was observed before the Pearl funding deadline, both legs meet confirmation thresholds, and no refund/reorg/manual-review flag exists.
- [x] 9.5.6 Add regression test: buyer deposits USDC, expiry passes, buyer refunds, seller funds PRL late; worker must never release PRL to buyer.
- [x] 9.5.7 Add regression test: PRL funded, buyer never deposits USDC; worker must choose PRL refund path after deadline.
- [x] 9.5.8 Add regression test: both legs funded but PRL release broadcast fails; USDC must remain escrowed or be refunded, never released to seller.
- [x] 9.5.9 Add regression test: PRL release confirmed and USDC release is submitted exactly once despite duplicate indexer/EVM events.

### 9.6 Ops And Release Gates

- [x] 9.6.1 Add testnet2 node deployment checklist.
  - See `ops/pearl-node/README.md` and `docs/operations/otc-deployment-env-contract.md`.
- [x] 9.6.2 Add indexer environment contract and secrets checklist.
  - See `docs/operations/otc-deployment-env-contract.md`.
- [x] 9.6.3 Add monitoring checks for node lag, indexer lag, failed broadcasts, and stale escrow watches.
  - See `docs/operations/otc-monitoring.md`.
- [x] 9.6.4 Record one simnet escrow run before enabling any mainnet PRL code path.
  - [x] 9.6.4.a Record PRL-side simnet evidence in
    `docs/operations/pearl-simnet-escrow-evidence-20260518.md`, covering real
    simnet funding detection plus signed release and refund transactions mined
    by `pearld` and classified by the indexer.
  - [x] 9.6.4.b Record external simnet node/indexer access: `65.21.206.46`
    runs simnet `pearld` at public RPC `http://65.21.206.46:18556` with RPC
    auth required, and simnet watched-address API at
    `http://65.21.206.46:18088`.
  - [x] 9.6.4.c Record simnet watch evidence for
    `simnet-e2e-1779131665`: height `145`, `144` observed outputs,
    `464964.66624540` observed PRL, `458505.41336571` unspent observed
    PRL, and `2` recorded spends.
  - [x] 9.6.4.d Run a wallet-backed simnet escrow path with oyster wallet
    addresses. Evidence is recorded in
    `docs/operations/pearl-wallet-backed-simnet-evidence-20260519.md`: Oyster
    funded a unique watched escrow address, then spent the exact escrow outpoint
    to the buyer release address; the indexer classified funding as `on_time`
    and the spend as `release`.
- [x] 9.6.5 Record one Base Sepolia escrow run before enabling any Base mainnet contract path.
  - Native Base Sepolia USDC lifecycle evidence is recorded in `contracts/usdc-escrow/deployments/base-sepolia-native-run.json`.
  - Mock-token lifecycle evidence remains recorded in `contracts/usdc-escrow/deployments/base-sepolia-mock-run.json` as secondary isolated proof.
  - Native Base Sepolia stress evidence is recorded in `contracts/usdc-escrow/deployments/base-sepolia-native-stress-20260518114919.json`, covering release, owner refund, buyer refund after expiry, cancel expired, pause/unpause, unauthorized callers, terminal trade ID reuse, parallel trades, expected revert selector/reason checks, and final zero escrow USDC balance.
- [x] 9.6.6 Deploy the Base Sepolia USDC escrow and record contract address, deploy tx, owner, fee recipient, and native USDC address.
- [x] 9.6.7 Complete two-step ownership transfer to the approved multisig or approved testnet owner and record acceptance evidence.
  - Ownership acceptance is recorded by tx `0x65dce0852763075eb3a4618ca1deec5bbfa78cce4cc4610f8338b11749c810ab`; current Base Sepolia `owner()` is `0x35C76bF5A701A30629d9706F4c8f77a4a0cA5978` and `pendingOwner()` is the zero address.
  - Evidence is linked from PR #23 comment `https://github.com/KASPACOM/pearl-infra/pull/23#issuecomment-4471406182`.
- [x] 9.6.8 Keep Base mainnet deployment blocked until contract review, Base Sepolia evidence, multisig ownership plan, and explicit Sione approval are all recorded.
- [ ] 9.6.9 If Base mainnet is approved later, record mainnet contract address, deploy tx, owner/multisig acceptance tx, fee recipient, native USDC address, and verification link before enabling production settlement.
- [x] 9.6.10 Add operator runbook for late PRL funding, refunded USDC, failed PRL release, unknown Pearl spend, stale indexer, and emergency pause.
- [x] 9.6.11 Add monitoring checks for trades past deadline, deposits close to expiry, manual-review backlog, duplicate events, and mismatched on-chain/backend terms.
  - See `docs/operations/otc-monitoring.md`.
- [ ] 9.6.12 Configure production-like operator alert secrets in the deployment
  environment before enabling support/error alert delivery.
  - [ ] 9.6.12.a Set `OTC_ALERT_TELEGRAM_BOT_TOKEN` from the approved bot token
    secret.
  - [ ] 9.6.12.b Set `OTC_ALERT_TELEGRAM_CHAT_ID` for the target operator chat.
  - [ ] 9.6.12.c Optionally set `OTC_ALERT_TELEGRAM_MESSAGE_THREAD_ID` when the
    target chat is a forum topic.
  - [ ] 9.6.12.d Send and record one non-production test support alert proving
    Telegram/webhook delivery and `support_alert_delivery` audit status.

### 9.7 Pearl P2TR Escrow Package

- [x] 9.7.1 Define the `packages/pearl-escrow` package interface: P2TR escrow address, expected amount, funding outpoint, release transaction template, refund transaction template, signature metadata, and refund eligibility.
- [x] 9.7.2 Replace the OTC API mock Pearl escrow allocator with a mainnet-disabled real allocator that creates per-trade escrow packages.
- [x] 9.7.3 Add simnet fixture tests for escrow address derivation, funding output matching, release transaction construction, and refund transaction construction.
- [x] 9.7.4 Add signer/key-handling design for Pearl Taproot/XMSS constraints, operator custody boundaries, and recovery-package storage.
- [x] 9.7.5 Add broadcast, retry, fee, and idempotency hooks consumed by the settlement worker for PRL release/refund transactions.

### 9.8 Strategy Loophole Fix Tracker

Status after PR #74: API startup/idempotency, derivation
allocation safety, watch registration, Pearl funding/spend detection, reorg
hardening, Pearl proof projection, Base escrow event ingestion, the persistent
settlement-worker iteration, the Pearl signer boundary policy/request/audit
layer, explicit deployment environment/secret contracts, monitoring contracts,
backend-driven RFQ/accept/checkout/proof/admin screens, automated full OTC
quote-to-proof coverage, and Base event term fail-closed validation are
implemented, with Base Sepolia native-USDC stress evidence recorded. The
remaining production blockers are live simnet/testnet evidence with real Base
txids and a real PRL signing/broadcast path, alert secret deployment, and Base
ownership acceptance evidence.

Open 9.8 items after PR #74: the remaining live `9.8.10.c` slice and `9.8.11`.

Loophole tracker after PR #74:

- [x] Mock/local production fallback — OTC API production startup now fails
  closed unless Postgres, Base RPC, real Pearl P2TR xpub allocation, Pearl
  indexer watch URL, and a nonzero Base escrow contract are configured.
- [x] Idempotency key reuse with changed payload — quote, accept, and
  side-effect request hashes are persisted and conflicting reuse is rejected.
- [x] Pearl escrow derivation collision/reuse — allocated derivation indexes
  are persisted with uniqueness and retry on collision.
- [x] Funding instructions before indexer observation — real P2TR quote
  acceptance registers the Pearl indexer watch before returning funding
  details.
- [x] Public proof from stale trade JSON — Pearl confirmations, funding
  outpoint, and release/refund txids are projected from active indexer
  observations and spends.
- [x] Ambiguous Pearl funding/spends/reorgs — funding is classified as
  on-time, late, underpaid, overpaid, duplicate, or reorged; spends are
  classified as release, refund, or unknown; detach/replay reorg paths are
  tested.
- [x] Missing Base event truth — Base escrow events are normalized and stored
  for created, deposited, released, refunded, and cancelled transitions.
- [x] Non-persistent settlement execution — worker iterations persist decisions,
  call the Pearl signer boundary through worker adapters, and prepare
  signer/broadcaster actions idempotently.
- [x] Unsafe or unauditable signer path — signer boundary enforces fee caps,
  template hash verification, output policy, custody allow-list/pause controls,
  persistent requests, append-only audit records, durable broadcast-attempt
  storage in the worker runtime, and no live broadcast from the signer path.
- [x] Implicit deployment config and weak ops alerts — canonical env contracts,
  secret names, deployment gates, and monitoring thresholds are documented.
- [x] Automated full OTC flow coverage — `9.8.10.c` now covers quote, accept,
  unique simnet escrow allocation, wallet-funded PRL proof facts, Base
  deposit/release projection, settlement-worker release/refund decisions, and
  public proof projection.
- [x] Live testnet2/Base Sepolia full OTC cross-chain evidence recorded on
  2026-05-21: quote, accept, wallet-funded PRL escrow, Base native-USDC
  create/deposit/release, PRL release signing/broadcast, indexed Pearl release
  classification, and public-proof fields.
  - See `docs/operations/full-otc-testnet2-evidence-20260521.md`.
- [ ] Productize the live proof runner so it persists the trade in Postgres or a
  live API process and can be rerun through
  `services/otc-api/test/live-full-otc-evidence.test.ts` after shutdown.
- [x] Backend-driven admin/support frontend workflow — rendered screens expose
  no release/refund/sign/broadcast actions, and admin list/detail, filters,
  note/manual-review actions, failed alert-delivery replay, and the public
  support-alert form are wired to live backend APIs.
- [x] Public API spoofing/abuse surface — quote and accept inputs now validate
  positive PRL amount, allowed route, Pearl-address prefix/network, EVM
  addresses, and bounded client request IDs; JSON request bodies are capped at
  64 KiB before parsing.
- [x] Public support-alert actor spoofing — the unauthenticated support-alert
  route now forces `actor=user` and `source=user` server-side, while operator
  alerts still require admin auth.
- [x] Public side-effect mutation/leakage — generic side-effect read/write
  routes now require bearer admin auth (`support_read` for read, `operator`
  for write); public users must use proof and support-alert routes only.
- [x] Base Sepolia ownership acceptance evidence is recorded; `9.6.7` is
  complete.
- [x] Multisig signer-key spoofing at quote acceptance — PR #96 now requires
  BIP340 signer-ownership proofs from both buyer and seller before allocating
  a `p2tr_multisig` Pearl escrow. The signed proof is bound to quote ID, role,
  Pearl address, USDC address, Pearl pubkey, and release-signing mode, so a
  typo, placeholder, or substituted pubkey/address cannot silently allocate an
  escrow the intended party cannot sign.
- [ ] Release-signature wallet UX is still not production-complete — signer
  ownership proof is not the final release/refund transaction signature. The
  app can show release-intent templates after indexed funding, but a Pearl
  wallet/tooling path must still collect and submit the actual release
  signatures before claiming fully self-serve user release from the browser.
  - 2026-05-24: Checkout now surfaces the release signing package from
    `/pearl-release/intent`: unsigned transaction, template hash, input/output,
    destination, fee, signer sets, and arbiter-path availability. Still
    missing: browser/wallet signing and submit/broadcast flow for actual
    release/refund signatures.
  - 2026-05-24: Added backend release/refund signing-intent routes and a
    signed-transaction broadcast route. Broadcast is gated to `release_pending`
    or `refund_pending`, validates the signed transaction inputs/outputs/header
    against the server unsigned template before RPC broadcast, and records the
    PRL side effect with a server-assigned user actor. Checkout can paste/submit
    a signed release transaction only once the trade is `release_pending`. Still
    missing: native browser Pearl wallet signing integration and a first-class
    refund signing UX.
  - 2026-05-24 review hardening: signed transaction submission now reserves the
    Pearl broadcast side-effect idempotency key before Pearl RPC broadcast,
    returns the existing submitted side effect for safe retries, rejects
    duplicate in-progress reservations before another RPC call, and requires
    witness data on every signed transaction input. Evidence is recorded in
    `docs/operations/pr106-release-broadcast-strategy-review-20260524.md`.
- [ ] Base mainnet deployment remains explicitly blocked — `9.6.9` only opens
  after separate approval, ownership evidence, and live-run evidence.

- [x] 9.8.1 Make OTC API production startup fail closed unless Postgres,
  Base RPC, real Pearl P2TR allocation, Pearl xpub, and a nonzero Base escrow
  contract are configured.
- [x] 9.8.2 Persist canonical request hashes for quote, accept, and side-effect
  idempotency keys; reject key reuse with a different payload.
- [x] 9.8.3 Replace local/mock-only Pearl escrow defaults in deployment manifests
  with explicit per-environment config contracts and secret names.
  - See `docs/operations/otc-deployment-env-contract.md`.
- [x] 9.8.4 Persist allocated Pearl derivation indexes with uniqueness and retry
  on collision before enabling real-money allocation.
- [x] 9.8.5 Wire quote acceptance to watch registration so every real escrow
  package is observed by the Pearl indexer before funding instructions are
  shown.
- [x] 9.8.6 Derive public proof Pearl confirmations, funding outpoint, and
  spend txids from indexed observations/spends, not stale trade JSON.
  - Pearl spend detection source data landed in PR #41; the OTC API proof
    projection consumes active indexer observations/spends.
- [x] 9.8.7 Add Base escrow event ingestion for created/deposited/released/
  refunded/cancelled transitions.
- [x] 9.8.8 Convert the settlement-worker decision core into a persistent
  execution loop that consumes API, Pearl indexer, Base events, signer, and
  broadcaster adapters.
  - Worker runtime now includes JSON-backed settlement decision persistence,
    a `PearlSignerBoundary` adapter for PRL release/refund construction, and
    durable broadcast-attempt storage.
- [x] 9.8.9 Implement the Pearl signer boundary with fee caps, template hash
  verification, key custody controls, audit trail, and retry-safe persistence.
  - `packages/pearl-escrow` now exposes `PearlSignerBoundary`,
    in-memory/durable request repositories, append-only JSONL audit records,
    fee-cap enforcement, expected template hash verification, release/refund
    output policy checks, signer key allow-list/pause controls, signed-response
    validation, and idempotent retry handling.
  - The signer boundary returns signed transaction material only. Live
    broadcasting remains outside the signer path and is tracked by the separate
    broadcast attempt ledger.
  - Settlement-worker tests cover the simnet-shaped funding -> release/refund
    construction -> signer boundary -> broadcaster wrapper path; live `pearld`
    smoke coverage is present but remains opt-in by env.
- [x] 9.8.10 Record a full escrow run: quote -> accept -> PRL funding
  detection -> Base deposit -> PRL release/refund -> Base release/refund ->
  proof.
  - [x] 9.8.10.a Record live simnet watched-address evidence for the fixture
    escrow address via the external read-only indexer API.
  - [x] 9.8.10.b Record wallet-funded PRL-side simnet evidence with Oyster,
    unique escrow address, watched-address detection, release spend, and indexer
    spend classification.
  - [x] 9.8.10.c Complete the full quote -> accept -> wallet-funded PRL ->
    Base deposit -> PRL release -> Base release -> public proof path.
    - [x] Add automated full-flow coverage in
      `services/otc-api/test/full-otc-flow.test.ts` for quote acceptance,
      unique simnet escrow watch registration, wallet-funded PRL proof facts,
      Base deposit/release event projection, settlement-worker PRL
      release/refund decisions, and public proof projection.
    - [x] Fail closed on Base event state mismatches before preparing PRL
      release: chain, contract, buyer, seller, fee, and funded amount must
      match the accepted trade.
    - [x] Replace fake escrow-address suffixing in automated coverage with real
      xpub-backed unique simnet P2TR allocation and indexer-shaped PRL proof
      projection.
    - [x] Add a gated live evidence verifier for public OTC proof, Base Sepolia
      receipts, settlement-worker Base safety projection, and Pearl indexer
      watch history. See `docs/operations/full-otc-live-evidence.md`.
    - [x] Harden the live evidence verifier and worker projection to require a
      complete Base lifecycle (`TradeCreated`, `Deposited`, and exactly one
      terminal event), matching Base chain ID, created-term fields, and Pearl
      indexer proof before accepting live evidence.
    - [x] Wire the frontend checkout to the backend trade/proof/verification
      routes and executable Base wallet deposit path, so a live run can proceed
      quote -> accept -> checkout -> approve/deposit from the browser once the
      operator-created Base escrow exists.
    - [x] Add the admin/operator frontend action that creates the Base escrow
      from backend terms and records the `TradeCreated` transaction evidence.
    - [x] Confirm the dev Oyster API/web deployment, public quote/accept/proof
      path, and admin-auth read path after PR #94. Smoke trade
      `trade_129c78c70faa719e55c4f2cd` reached `pearl_escrow_pending` with
      Base Sepolia escrow contract `0x7edf75ceB2441d80aBC6599CeB4E62Eeb23BB2a9`
      on chain ID `84532`; remaining blocker is wallet-funded PRL plus
      browser-signed Base transactions.
    - [x] Replace the simulated Base leg with real Base Sepolia txids and a
      non-Oyster raw signer path. The 2026-05-21 testnet2 proof used native
      Base Sepolia USDC escrow txs and a controlled raw P2TR signer path.
      Evidence is recorded in
      `docs/operations/full-otc-testnet2-evidence-20260521.md`.
    - [ ] Move the one-off testnet2 runner into the durable worker/verifier
      path so the proof can be replayed from persisted API state.
- [x] 9.8.11 Record a testnet2/Base Sepolia escrow run with real Pearl and Base
  Sepolia txids.
  - 2026-05-21: recorded the full testnet2/Base Sepolia release path in
    `docs/operations/full-otc-testnet2-evidence-20260521.md`. Before any broad
    mainnet rollout, still require explicit mainnet approval, low-cap mainnet
    PRL paths, real Pearl mainnet and Base/Igra txids, public proof, and clean
    reconciliation.
- [x] 9.8.12 Build actual frontend/admin screens from the 9.4 page models and
  prove no release action is exposed to users or operators.
  - Rendered RFQ, accept, checkout, public proof, and admin shell screens are
    merged, and tests prove no release/refund actions are exposed.
  - [x] 9.8.12.a Complete backend-driven admin list/detail/support-alert/manual
    note wiring under `9.4.4.c` through `9.4.4.e`.
  - [x] 9.8.12.b Prove the wired admin UI still exposes no release, refund,
    signing, or trade-term edit actions.
  - Admin backend contracts now expose read/debug/support/manual-review
    endpoints without arbitrary release, signing, or term-edit actions; admin
    routes require `OTC_ADMIN_API_TOKEN`, and support/error alerts require at
    least one configured sink (`OTC_ALERT_WEBHOOK_URL` or Telegram bot token
    plus chat ID), in production-like deployments.
  - 2026-05-23: Added the dev end-to-end Pearl multisig custody path: public
    quote acceptance can request `multisig` custody, capture buyer/seller
    Pearl pubkeys, require BIP340 signer-ownership proofs bound to the accept
    terms, select preauthorized-vs-manual release signing, and show custody/
    signing policy plus release intent status on checkout. The API now
    supports `PEARL_ESCROW_ALLOCATOR=p2tr_multisig`, requires
    `PEARL_ESCROW_ARBITER_PUBKEY`, derives trade-id-committed 2-of-3 P2TR
    escrows, and exposes a public release-intent template only after Pearl
    funding is indexed.
- [x] 9.8.13 Add ops monitoring for deadline breaches, stale watches, failed
  broadcasts, duplicate events, manual-review backlog, and mismatched
  backend/on-chain terms.
  - See `docs/operations/otc-monitoring.md`.

### 9.9 Admin Control Plane Hardening

- [ ] 9.9.1 Add real operator identity and RBAC for admin APIs instead of a
  single shared bearer token.
  - Added a multi-token RBAC compatibility layer via `OTC_ADMIN_API_TOKENS`;
    a real identity provider/session layer is still required before broader
    support rollout.
  - [x] 9.9.1.a Define roles for support read-only, support note writer,
    operator/manual-review, and admin maintainer.
  - [x] 9.9.1.b Bind the authenticated operator identity to audit records.
- [x] 9.9.2 Add rate limits and abuse controls for the public
  `POST /otc/trades/:tradeId/support-alerts` endpoint.
  - [x] 9.9.2.a Rate-limit by trade ID, IP/client fingerprint, and severity.
  - [x] 9.9.2.b Reject alert spam without blocking the original trade state.
- [x] 9.9.3 Add pagination and cursor/limit controls to
  `GET /otc/admin/trades`.
- [x] 9.9.4 Expand admin query filters for severity, failed side effects,
  deadline breaches, blocker type, updated age, and alert-delivery status.
- [x] 9.9.5 Move admin audit actor source from request body to authenticated
  auth context.
- [x] 9.9.6 Define and enforce redaction tiers for admin debug output before
  exposing it to broader support roles.
- [x] 9.9.7 Add alert retry/replay tooling for failed
  `support_alert_delivery` side effects.
- [x] 9.9.8 Add structured admin API tests for auth edge cases: missing token,
  wrong token, insufficient role, actor spoof attempts, redaction behavior, and
  public support-alert abuse limits.

### 9.10 Oyster App Deployment

- [x] 9.10.1 Add Docker image contracts for `services/otc-api` and
  `apps/otc-web`.
- [x] 9.10.2 Add OTC API database migration entrypoint for Kubernetes
  init-container execution.
- [x] 9.10.3 Add CI/CD workflow that tests, builds, pushes dev/main Oyster API
  and web images, and updates ArgoCD image tags.
  - 2026-05-18: dev workflow run `26049304569` passed on
    `fe0873e0213dc557dd27db55ae16438f3bf3c151`, pushed dev API/web ECR
    images, and committed dev Argo image tags.
  - Main/prod image build has not run yet; prod ECR repos are still empty until
    the main release path is executed.
- [x] 9.10.4 Add ArgoCD manifests for `dev-oyster.kaspa.com`,
  `dev-api-oyster.kaspa.com`, `oyster.kaspa.com`, and
  `api-oyster.kaspa.com`.
- [x] 9.10.5 Document required GitHub secrets, runtime ExternalSecret keys,
  and the deployment/mainnet gate in `docs/operations/oyster-deployment.md`.
- [ ] 9.10.6 Create/populate AWS Secrets Manager keys.
  - [x] 9.10.6.a Create/populate `dev/oyster-otc-api` in `eu-central-1`.
    - 2026-05-18: secret is synced by ExternalSecrets; dev-only escrow custody
      xprv is stored separately in `dev/oyster-otc-escrow-custody`.
  - [ ] 9.10.6.b Add `PEARL_ESCROW_ARBITER_PUBKEY` to the dev secret before
    switching `PEARL_ESCROW_ALLOCATOR=p2tr_multisig`.
  - [ ] 9.10.6.c Create/populate `prod/oyster-otc-api` in `us-east-1`.
- [x] 9.10.7 Confirm ECR repositories exist for Oyster API/web dev and prod.
  - 2026-05-18: dev repos contain image tag
    `fe0873e0213dc557dd27db55ae16438f3bf3c151`; prod repos exist but have no
    images yet.
- [x] 9.10.8.a Merge ArgoCD manifests and dev image-tag update.
- [x] 9.10.8.b Bootstrap the dev Argo Application CRs into the dev cluster.
- [x] 9.10.8.c Confirm Argo sync creates healthy dev API and web pods.
  - 2026-05-18: `oyster-otc-web` and `oyster-otc-api` are both 1/1 Running;
    API uses Postgres persistence, Base Sepolia reader, Pearl watch registrar,
    and Telegram alert notifier.
- [ ] 9.10.8.d Package and deploy a dev settlement-worker runtime.
  - 2026-05-23: Verified the current dev namespace only has
    `oyster-otc-api` and `oyster-otc-web`; `services/settlement-worker` has
    decision/signing/broadcast adapters and tests but no Kubernetes runtime
    deployment yet.
- [ ] 9.10.8.e Execute the main/prod deploy path and confirm prod API and web
  images/pods.
- [x] 9.10.9.a Configure dev DNS/Cloudflare records and HTTPS for
  `dev-oyster.kaspa.com` and `dev-api-oyster.kaspa.com`.
- [ ] 9.10.9.b Configure prod DNS/Cloudflare records for `oyster.kaspa.com`
  and `api-oyster.kaspa.com`.
- [ ] 9.10.10 Run live `/healthz`, quote, support-alert, and admin-auth smoke
  checks against dev, then main.
  - [x] 9.10.10.a Dev `/healthz` smoke passed over HTTPS.
  - [x] 9.10.10.b Dev quote creation smoke passed over HTTPS.
  - [x] 9.10.10.c Dev quote accept smoke passed and registered a Pearl watch.
  - [x] 9.10.10.d Dev admin-auth smoke passed with the generated admin token.
  - [x] 9.10.10.e Dev support-alert smoke passed with Telegram delivery
    confirmed in admin diagnostics.
  - [ ] 9.10.10.f Switch dev API secret to `PEARL_ESCROW_ALLOCATOR=p2tr_multisig`
    with `PEARL_ESCROW_ARBITER_PUBKEY`, deploy the new API/web images, and
    smoke quote -> multisig accept with buyer/seller signer proofs -> Pearl
    funding/proof -> Base create/deposit -> release intent from the browser.
  - [ ] 9.10.10.g Main/prod smoke after prod release path is executed.
- [x] 9.10.11 Wire Oyster API runtime config to the live Pearl watched-address
  indexer on `65.21.206.46` and smoke `PEARL_INDEXER_WATCH_URL` from the API
  runtime network.
  - 2026-05-18: dev cluster egress `3.77.60.57` is allowlisted to
    `65.21.206.46:8088`; in-cluster curl to `/healthz` returned `{"ok":true}`.
- [x] 9.10.12 Expose simnet node/indexer access for external agents without
  SSH tunneling.
  - 2026-05-18: nginx proxies `http://65.21.206.46:18088` to the local
    simnet indexer as read-only `GET /healthz` and `GET /watches/:id`; public
    `POST /watches` returns `403`.
  - 2026-05-18: nginx proxies `http://65.21.206.46:18556` to simnet `pearld`
    RPC; unauthenticated calls return `401`, authenticated `getblockcount`
    returned `145`.

## 10. PRL Igra Bridge And wPRL/USDC Pool

- [x] 10.1 Define the bridge-first product track and record that OTC remains the manual safety layer.
- [x] 10.2 Define the MVP trust model as federated custodial, not fully non-custodial.
- [x] 10.3 Define entry flow: Pearl PRL deposit, indexer confirmation, relayer/federation verification, Igra `wPRL` mint.
- [x] 10.4 Define exit flow: Igra `wPRL` burn/lock, exit request, operator review, Pearl PRL release, proof record.
- [x] 10.5 Define `wPRL` token decimals, symbol/name, conversion rules, mint authority, and owner/multisig controls.
- [x] 10.6 Design Igra bridge contract interface and events for deposit claims, minting, exit requests, processing, refunds, pause, caps, and replay protection.
  - 2026-05-18: Added `WrappedPearl` and `PearlBridge` under `contracts/usdc-escrow/src`. The bridge is federated/custodial by design: relayers submit Pearl outpoint claims, the contract enforces replay protection and caps, operators record globally unique Pearl release txids for exits, and cap reductions cannot go below active supply plus pending exit liabilities.
- [x] 10.7 Build Igra bridge contract tests for mint replay protection, exit burn/lock, min/max limits, rolling caps, pause, and processed-exit idempotency.
  - 2026-05-18: Added `PearlBridge.t.sol` covering bridge-only minting, deposit replay rejection, min/max/pilot/rolling caps, separate entry/exit pauses, burn-and-record exit requests, operator-only processing, idempotent processed exits, conflicting and reused release txid rejection, refunds/double-refund rejection, cap reductions below active liabilities, and two-step ownership.
- [x] 10.8 Extend Pearl indexer support for bridge deposit watches, reserve addresses, confirmed deposits, reserve spends, pending exits, and reconciliation gaps.
- [x] 10.8.1 Add shared watched-addresses migration for bridge deposit/reserve watches and address observations.
- [x] 10.8.2 Add `bridge_exit_requests` table for mirrored Igra burn/lock events.
- [x] 10.8.3 Implement repository/API support for bridge deposit watches and reserve watches via the shared `/watches` API. Completed in PR #12.
- [x] 10.8.4 Track Pearl deposit observations by txid/vout, amount, block, confirmations, match status, consumed mint tx, and reorg state.
  - [x] 10.8.4.a Add bridge-service deposit observation projection for outpoint, amount, confirmations, match status, consumed claim spend, unsafe classification, and reorg blockers.
- [x] 10.8.5 Track reserve spends and classify each spend as exit release, consolidation, ops transfer, fee/change, or unknown.
  - [x] 10.8.5.a Add bridge-service reserve spend projection that separates known spends from unknown spends before relayer decisions.
- [x] 10.8.6 Expose reconciliation views for confirmed reserves, pending deposits, pending exits, minted `wPRL` supply, reserve surplus/deficit, stale requests, and unknown reserve spends.
  - [x] 10.8.6.a Add bridge-service reconciliation snapshot for reserves, known spends, pending exits, minted supply, surplus/deficit, stale watches, and unknown reserve-spend blockers.
  - [x] 10.8.6.b Add canonical event IDs, event hashes, relayer attestation counts, and quorum requirements to public bridge proof projections.
  - [x] 10.8.6.c Persist reconciliation snapshots so operators can compare reserve health across blocks, not only read the latest in-memory projection.
  - [x] 10.8.6.d Wire the persisted snapshot source into an admin/read-only API.
- [x] 10.8.7 Poll Igra `PearlBridge` events and mirror deposit claims, exit requests, processed exits, refunds, cap changes, pause changes, relayer changes, and operator changes.
  - [x] 10.8.7.a Add Igra event mirror helpers for all `PearlBridge` event types keyed by `(chainId, txHash, logIndex)`.
  - [x] 10.8.7.b Connect the mirror helpers to a real Igra RPC/event poller and checkpointed block cursor.
    - 2026-05-19 hardening: the poller now sorts returned logs, validates log address, replays already-persisted events into exit projections before checkpointing, and stores Postgres checkpoints monotonically so overlapping pollers cannot rewind the cursor.
- [x] 10.8.8 Write Igra exit events into `bridge_exit_requests` with idempotent upsert semantics keyed by `(igra_burn_txid, igra_burn_log_index)`.
  - [x] 10.8.8.a Convert mirrored `ExitRequested` events into idempotent bridge exit rows in the bridge-state repository.
  - [x] 10.8.8.b Back the exit mirror with Postgres `bridge_exit_requests` writes in the live service.
    - 2026-05-19 hardening: mirrored exits preserve terminal rows, preserve processed rows against stale pending replays, and enforce unique `exit_id` plus unique non-null Pearl release txids through migration `005_bridge_exit_uniqueness.sql`.
- [x] 10.8.9 Classify Pearl reserve spends against mirrored exits, mark exact release txids once, and route mismatches or unknown spends to manual review.
  - [x] 10.8.9.a Add reserve-spend matcher for exact exit release matches, amount mismatch, recipient mismatch, duplicate release txid, and unknown spend blockers.
  - [x] 10.8.9.b Wire reserve-spend matching into the live Pearl spend scanner and update `bridge_exit_requests` on exact matches.
    - 2026-05-19 hardening: Igra `ExitProcessed` is treated as `processed`, not `released`; it remains an exit liability until the Pearl reserve spend scanner observes and matches the actual release txid.
  - [x] 10.8.9.c Harden reserve-spend matching so an `exit_release` only counts
    as known when both `amount_grains` and `pearl_recipient` are present and
    match one unique pending exit; amount-only, malformed, mismatched, or
    ambiguous duplicate cases remain reconciliation blockers.
  - [x] 10.8.9.d Harden reconciliation so it reuses the reserve-spend matcher
    before counting known reserve spends, blocks unmatched release-shaped spends,
    rejects wrong-purpose reserve watches as backing, and normalizes grain
    amounts plus Pearl recipient casing before exact matching.
- [x] 10.8.10 Run a bridge simnet rehearsal with real Pearl deposit txids, Igra mint receipts, Igra burn events, Pearl release txids, and reserve reconciliation evidence.
  - 2026-05-19: Added `npm --workspace @kaspacom/bridge-service run rehearse:simnet-bridge`, which builds the bridge contracts, deploys fresh local `WrappedPearl`/`PearlBridge` receipts on Anvil chain `19416`, claims real public Pearl simnet deposit txid `442ea8d4fe37cb58e7946bec2cae7a9b3197e751188b3bdf0c143a6edc374164:0`, mirrors the Igra exit request/process logs through the bridge poller, matches real Pearl release txid `22bc370a13dcd0f3c4dfdf5c3ddd29323146a78b478157115debc846f855e7b1`, and records clean reserve reconciliation evidence in `docs/operations/bridge-simnet-rehearsal-evidence-20260519.md`.
  - [ ] 10.8.10.a Repeat the rehearsal with freshly-created writable Pearl simnet deposit/release txids once `pearld`/wallet credentials are available; this is the remaining pre-pilot live-infra confidence gate.
  - [x] 10.8.10.b Add `PEARL_REQUIRE_BRIDGE_EXIT_RELEASE=1` to the multisig
    simnet proof so the proof fails unless the scanner classifies the reserve
    spend as `exit_release`.
  - [x] 10.8.10.c Redeploy/update the simnet scanner classifier and rerun the
    proof with `PEARL_REQUIRE_BRIDGE_EXIT_RELEASE=1`; this is the hard
    fail-closed gate before any low-cap PRL mainnet pilot.
    - 2026-05-20: Redeployed `kaspacom-pearl-indexer-simnet` from `origin/dev`,
      mined fresh writable simnet source funds, and reran
      `npm run prove:simnet-multisig` with
      `PEARL_REQUIRE_BRIDGE_EXIT_RELEASE=1`. Evidence:
      `docs/operations/pearl-multisig-funded-simnet-evidence-20260520.md`.
  - [x] 10.8.10.d Rerun the bridge-service rehearsal against the fresh writable
    Pearl simnet multisig evidence instead of the older public simnet txids.
    - 2026-05-20: Updated `bridge-simnet-rehearsal.mjs` to consume
      `docs/operations/pearl-multisig-funded-simnet-evidence-20260520.json` and
      recorded `docs/operations/bridge-simnet-rehearsal-evidence-20260520.md`.
      The run matched reserve release txid
      `8dfcc3c78c839fe9954d553bb9b7ffd76dfb8471d61a5a7b7d14747d536c517a`
      to the mirrored exit, with no reserve reconciliation blockers.
- [x] 10.9 Build relayer/federation service plan with manual approval mode, quorum rules, idempotency, and operator runbook.
  - [x] 10.9.1 Add bridge relayer decision policy for manual approval, idempotent mint/release prepare actions, pilot caps, rolling caps, and clean-reconciliation gates.
  - [x] 10.9.2 Harden bridge relayer guardrails after PR #65 strategy review:
    fail closed on wrong-watch observations, observations outside watch
    history, multiple live deposit outputs, insufficient confirmations,
    missing/out-of-range expected amount bounds, and non-`on_time`
    classifications.
  - [x] 10.9.3 Add KAT-style canonical deposit/exit event identity, deterministic event hashing, independent relayer quorum evaluation, finality wait state, and fail-closed blockers for unknown relayers, mismatched event hashes, duplicate attestations, and impossible quorum policies.
  - [x] 10.9.4 Require approved relayer quorum plus manual operator approval before bridge-service mint/release prepare decisions.
- [x] 10.10 Add bridge API/proof contracts for deposit status, exit status, reserve backing, and public audit trail.
  - [x] 10.10.1 Add bridge public proof DTOs for deposit status, exit status, reserve backing, blockers, and public audit fields.
  - [x] 10.10.2 Extend bridge public proof contracts with canonical event IDs, event hashes, relayer attestation counts, quorum requirements, and reserve-backing blockers.
  - [x] 10.10.3 Add public `GET /bridge/deposits/:depositId`, `GET /bridge/exits/:exitId`, and `GET /bridge/proof` routes backed by persisted bridge state.
  - [x] 10.10.4 Add operator/admin routes for manual approval, rejection, replay, pause recommendation, and decision audit reads.
  - [ ] 10.10.5 Add proof-page/frontend model support only after the API shape is stable.
- [ ] 10.11 Add low-cap pilot gates: min/max amounts, rolling window caps, hot-wallet cap, monitoring, and emergency pause test.
  - [x] 10.11.1 Add service-side low-cap pilot gates for deposit min/max, max exit, supply cap, rolling mint cap, and reserve-available checks.
  - [x] 10.11.2 Require clean reserves, relayer quorum, finality, and manual operator approval before prepare actions.
  - [ ] 10.11.3 Add hot-wallet reserve tier cap checks, monitoring alerts, and an emergency pause drill once live reserve addresses and signer policy are selected.
  - [x] 10.11.4 Add reserve-deficit, stale-indexer, unknown-spend, quorum-failure, and cap-near-limit alerts.
  - [x] 10.11.5 Record a pilot runbook for pause, unpause, stuck mint, stuck exit, release-tx mismatch, and reserve-deficit response.
  - [x] 10.11.6 Add guarded Igra bridge deployment tooling for `WrappedPearl`/`PearlBridge` with chain ID checks, mainnet approval gates, explicit relayer/operator/final-owner requirements, Igra legacy gas pricing, and deployment evidence output.
    - 2026-05-19: Added `npm --workspace @kaspacom/prl-usdc-escrow-contracts run deploy:pearl-bridge` and local validation evidence in `contracts/usdc-escrow/deployments/local-pearl-bridge-20260519141615.json`. Mainnet deployment is prepared but blocked unless `PEARL_BRIDGE_MAINNET_APPROVED=1`, `PEARL_BRIDGE_MAINNET_READY_CHECKLIST=1`, chain ID `38833`, final owner, relayer, and operator are explicit.
    - 2026-05-19: Attempted Galleon deployment through the configured `IGRA_RPC_URL` (`38836`), but the RPC rejected the deployment before broadcast because the underlying Kaspa transaction fee was below standardness minimum. Evidence and next fix path are in `docs/operations/bridge-galleon-deploy-attempt-20260519.md`; Igra mainnet stays blocked until Galleon deployment succeeds or a replacement deploy path is proven.
  - [x] 10.11.7 Draft the bridge reserve custody policy for the low-cap pilot.
    - 2026-05-20: Added
      `docs/operations/bridge-reserve-custody-policy.md` with the hot/warm/cold
      tier model, 2-of-3 P2TR hot-tier proof boundary, required live fields,
      authorization boundary, and the pause-drill sequence. Live addresses,
      signer identities, cap values, and pause authority remain unapproved.
- [ ] 10.12 After bridge entry/exit pilot passes, create `wPRL/USDC` pool plan with initial liquidity, price assumptions, and max bridge exposure approval.
  - [ ] 10.12.1 Do not seed a `wPRL/USDC` pool until one low-cap entry and one low-cap exit have passed with public proof and clean reserve reconciliation.
  - [ ] 10.12.2 Define pool initial liquidity source, max bridge exposure, LP ownership, withdrawal authority, and emergency liquidity removal procedure.
- [ ] 10.13 Upgrade from pilot federation to stronger KAT-style release authorization.
  - [ ] 10.13.1 Finalize federation membership, relayer independence requirements, signer custody boundaries, and quorum threshold.
  - [ ] 10.13.2 Replace plain relayer attestations with threshold/FROST-style release authorization or an equivalent reviewed threshold-signing boundary.
  - [ ] 10.13.3 Add public reserve proof snapshots and an audit endpoint for reserve addresses, confirmed reserves, pending exits, minted supply, and cap usage.

## 11. Bridge/OTC Pearl-Side Remaining Work After PR #81

This section is a roll-up view after PR #81 merged. The detailed owning tasks
remain in sections 9 and 10; this keeps the current Pearl-side bridge/OTC
blockers visible for planning. See
`docs/operations/bridge-otc-gap-review-20260519.md`.

- [x] 11.1 Record the post-#81 bridge/OTC gap review and split remaining work
  by bridge, OTC, pool, and shared Pearl infra blockers.
- [ ] 11.2 Resolve the Galleon/Igra deployment path for `WrappedPearl` and
  `PearlBridge`.
  - PR #81 proved local deployment and mainnet refusal gates. The 2026-05-19
    Galleon attempt failed before broadcast on the underlying Kaspa standardness
    fee. Next proof must either raise the accepted fee/gas path or replace the
    deploy route and record evidence.
- [x] 11.3 Repeat the bridge rehearsal with freshly-created writable Pearl
  simnet deposit/release txids.
  - 2026-05-20: `npm --workspace @kaspacom/bridge-service run
    rehearse:simnet-bridge` passed using
    `docs/operations/pearl-multisig-funded-simnet-evidence-20260520.json`.
    Evidence is in
    `docs/operations/bridge-simnet-rehearsal-evidence-20260520.md`.
- [ ] 11.4 Select and document live reserve addresses, signer policy,
  hot/warm/cold reserve tiers, cap limits, and emergency pause authority.
  - [x] 11.4.a Draft the low-cap reserve custody policy and authorization
    boundary in `docs/operations/bridge-reserve-custody-policy.md`.
  - [ ] 11.4.b Select live reserve addresses, signer identities, cap values, and
    pause authority.
- [ ] 11.5 Decide whether the first mainnet OTC pilot uses the current
  coordinator-signed P2TR escrow model or waits for true PRL multisig escrow.
  - Current code derives one P2TR escrow address per trade from
    `PEARL_ESCROW_XPUB` and signs through a policy-gated coordinator signer.
    It is not the final non-custodial 2-of-3 buyer/seller/arbiter Taproot
    multisig design.
  - [x] 11.5.a Add simnet 2-of-3 P2TR escrow address/package construction with
    buyer/seller/arbiter script-path leaves and timeout-refund metadata. See
    `docs/operations/pearl-multisig-simnet-evidence-20260519.md`.
    - Review-loop hardening: multisig escrow construction uses the BIP341 NUMS
      internal key for script-path-only custody and rejects invalid or duplicate
      role keys before producing an address.
  - [x] 11.5.b Prove a funded simnet multisig release/refund spend through
    `pearld` and the watched-address indexer before treating multisig custody
    as live-ready.
    - 2026-05-19 funded proof: `d96e430379ec1a47ee616ed2241ce12c636023aadc1b745776fb7448a3fc5882`
      funded two 2-of-3 P2TR escrow outputs; `c653f1363e7ae80a6ef1005dc715e9020b635b1ff9b569c4f76bff64202f6574`
      spent the release path and the watched-address indexer classified it as
      `release`; `0bfccc7207f778a6ab86cb2dacd2bf13311108eae1371203b55afad818998b19`
      spent the CLTV timeout refund path and the watched-address indexer
      classified it as `refund`. See
      `docs/operations/pearl-multisig-funded-simnet-evidence-20260519.md`.
- [ ] 11.6 Select and prove bridge reserve custody.
  - The bridge service can watch reserve addresses and reconcile reserve
    spends, but live Pearl reserve addresses, multisig/threshold construction,
    and release signing custody are not implemented or approved yet.
  - [x] 11.6.a Prove a simnet bridge reserve can be funded and released through
    the 2-of-3 P2TR script-path signer policy. Evidence:
    `84c8559efc60456f87b4ceae889d3c47102c111201a9fa4119de0149aeb21f8a`
    spent reserve outpoint
    `d96e430379ec1a47ee616ed2241ce12c636023aadc1b745776fb7448a3fc5882:2`.
  - [x] 11.6.b Deploy or verify the current `bridge_reserve` spend classifier
    on the simnet scanner and record `exit_release` evidence.
    - 2026-05-20: Redeployed the simnet indexer and reran
      `npm run prove:simnet-multisig` with
      `PEARL_REQUIRE_BRIDGE_EXIT_RELEASE=1`; bridge reserve release txid
      `8dfcc3c78c839fe9954d553bb9b7ffd76dfb8471d61a5a7b7d14747d536c517a`
      was classified as `exit_release` with `amount_grains` and
      `pearl_recipient` metadata.
  - [x] 11.6.b.1 Keep `exit_release` classification as a reserve-spend shape
    signal only. Mainnet release authorization still requires bridge-service
    matching against an approved pending exit by recipient, amount, unique Pearl
    release txid, clean reconciliation, and cap limits.
  - [x] 11.6.b.2 Prove the bridge service can consume the fresh writable simnet
    reserve evidence and reconcile a matched exit release with no blockers.
    Evidence: `docs/operations/bridge-simnet-rehearsal-evidence-20260520.md`.
  - [ ] 11.6.c Select approved live reserve addresses, signer ownership,
    custody tiers, cap limits, and emergency pause authority before any
    mainnet release path is enabled.
- [ ] 11.7 Execute and record an emergency pause/unpause drill against the
  deployed low-cap bridge path.
- [ ] 11.8 Add bridge proof-page/frontend support for deposit status, exit
  status, reserve backing, blockers, event hashes, quorum counts, and cap usage.
- [x] 11.9 Complete the OTC full-flow live evidence run with real Base Sepolia
  `createTrade`, `deposit`, and terminal `release` or `refund` receipts plus a
  real PRL signing/broadcast path.
  - [x] 11.9.a Connect the OTC frontend checkout to real OTC API data,
    injected-wallet connect/switch, USDC approve, and escrow deposit calls.
  - [x] 11.9.b Connect the OTC admin frontend to the server-authoritative Base
    `createTrade` intent and operator wallet broadcast path.
  - [x] 11.9.c Harden the OTC admin frontend/API testing path against public
    token leakage, actor spoofing, stale side-effect evidence, and unverified
    `createTrade` receipts.
  - [x] 11.9.d Run the live Base Sepolia browser deposit against an
    operator-created escrow and record the `TradeCreated`/`Deposited` txids.
    - 2026-05-21 evidence: testnet2/Base Sepolia run
      `trade_f674c08e2d0a278abed79e3e` recorded Base `createTrade`, `approve`,
      `deposit`, and `release` txids plus Pearl funding/release txids. See
      `docs/operations/full-otc-testnet2-evidence-20260521.md`.
  - [ ] 11.9.e Productize the one-off live proof runner into a durable
    Postgres-backed API/worker/verifier path so the evidence can be rerun from
    public routes after process shutdown.
- [x] 11.10 Record the testnet2/Base Sepolia escrow-run evidence.
  - 2026-05-21: `trade_f674c08e2d0a278abed79e3e` proves the full testnet2/Base
    Sepolia release path. The next gate is productizing repeatable proof replay
    from durable API state, then explicitly approved low-cap mainnet with real
    Pearl mainnet and Base/Igra txids, public proof, and clean reconciliation.
- [ ] 11.11 Finish production Oyster release: prod secrets, prod image path,
  prod DNS, and prod `/healthz`, quote, support-alert, admin-auth smoke checks.
- [ ] 11.12 Replace shared bearer-token admin auth with a real operator
  identity/session layer before broader support rollout.
- [ ] 11.13 Produce the `wPRL/USDC` pool plan only after one low-cap bridge
  entry and one low-cap bridge exit have public proof and clean reserve
  reconciliation.
- [ ] 11.14 Finalize the post-pilot federation/threshold-signing design:
  federation membership, relayer independence, custody boundary, quorum
  threshold, and threshold/FROST-style release authorization or equivalent.

## 12. Oysters Market UX, Users, Referrals, and Notifications

This section tracks the product layer above the settlement-grade quote/trade
pipeline. Persistent data for these tasks lives in the OTC API Postgres
database configured by `OTC_API_DATABASE_URL`; wallet ownership is proven
through one-time wallet challenges before creating user/profile records.

- [x] 12.1 Add persistent user, wallet, profile, referral-code,
  referral-attribution, and wallet-challenge tables.
  - 2026-05-24: Added `004_users_referrals.sql` for `otc_users`,
    `otc_user_wallets`, `otc_user_profiles`, `otc_referral_codes`,
    `otc_referral_attributions`, and `otc_user_wallet_challenges`.
- [x] 12.2 Add API support for wallet-owned users and referral-link capture.
  - 2026-05-24: Added wallet challenge creation, user registration,
    `ref=` URL attribution, referral-code lookup, and wallet-proved profile
    update routes. EVM challenges verify `personal_sign`-style signatures;
    Pearl challenges verify BIP340 signatures against the submitted signer
    public key.
  - 2026-05-24 hardening pass: referral codes and user ids are random
    non-derived identifiers, wallet challenges are consumed once, and users
    retain both their own referral code and their immutable referred-by
    attribution.
  - 2026-05-24: Pearl wallet-as-user registration now supports single-key P2TR
    wallets by requiring a BIP340 challenge signature from the submitted pubkey
    and proving that pubkey derives the exact challenged Pearl address.
- [x] 12.3 Add frontend referral capture so `?ref=<code>` is persisted through
  quote/order/user registration and shown in the profile referral panel.
  - 2026-05-24: Profile registration captures `ref=` into local storage,
    submits it during wallet-owned registration, and shows both own referral
    code and referred-by attribution.
  - 2026-05-24: Referral capture now runs globally on every app route, stores
    the original source URL with the referral code, keeps legacy string storage
    readable, and reuses that attribution when profile or market flows later
    create the wallet-owned user.
- [x] 12.4 Add user profile UX for linked wallets, optional email,
  notification preferences, referral code, and referred-by status.
  - 2026-05-24: Added `/profile` for wallet-owned account creation, optional
    email/profile update, referral panel, points summary, my offers, and my
    trades.
  - 2026-05-24: Added email verification request/verify UX, exact-email
    verification binding, and granular email notification preference controls.
- [x] 12.5 Add order book persistence and public market APIs for active orders,
  filters, sorting, recent trades, market stats, and volume counters.
  - 2026-05-24: Added `005_orders_points.sql`, `POST /otc/orders`,
    `GET /otc/orders`, `GET /otc/market/stats`, `GET
    /otc/market/recent-trades`, and wallet-proved user dashboard routes.
  - 2026-05-24 hardening pass: market stats now count partially-filled
    orders as active order volume instead of dropping residual liquidity.
- [x] 12.6 Add the public order book and market dashboard UI: best price,
  size, active volume, total volume, total successful trades, and verified
  user count.
  - 2026-05-24: Added `/market` with buy/sell open offers, funding-asset
    labels, recent trades, total volume, active order volume, successful
    trade count, and verified user count.
- [ ] 12.7 Add notification preferences and delivery jobs for trade status,
  deadline warnings, new matching orders, price alerts, and referral events.
  - 2026-05-24: Added `otc_email_verification_tokens`,
    `otc_notification_preferences`, `otc_notification_deliveries`, wallet-proved
    preference APIs, public unsubscribe API, admin delivery audit/status APIs,
    and email verification queueing.
  - 2026-05-24 hardening pass: profile email changes clear verification and
    disable email notifications, notification preferences cannot enable email
    delivery until the exact email is verified, signup cannot pre-enable email
    notifications, and notification delivery queue read/update is restricted to
    operator/admin credentials.
  - 2026-05-24: Added webhook-backed email provider delivery, retry/backoff
    processing, notification templates, notification worker runtime, taker-user
    attribution on order quote links, and automatic queueing for trade-status,
    deadline-warning, order-matched, new-order, and referral point events.
  - 2026-05-24 audit hardening: delivery processing now re-checks the current
    verified recipient and preference before sending, redacts verification and
    unsubscribe tokens from provider webhook payloads, processes due retries
    before future-scheduled rows, and keeps order/trade/points writes successful
    if non-critical notification enqueueing fails.
  - Missing: explicit user price-alert rule storage/evaluation, provider secret
    deployment, and production smoke evidence for the notification worker.
- [ ] 12.8 Upgrade Telegram from operator alerts to user self-service:
  wallet-linked account binding, `/orders`, `/trades`, `/trade <id>`,
  price alerts, new-order alerts, and private trade-status notifications.
  - Missing: Telegram account-link challenge flow, wallet-bound bot sessions,
    private per-user authorization checks, `/orders`, `/trades`, `/trade <id>`
    command handlers, price alert rules, new-order alert rules, and delivery
    audit/retry handling.
- [x] 12.9 Add activity points for signup, order creation, completed trades,
  direct referrals, and 10% referred-user activity bonuses.
  - 2026-05-24: Added `otc_points_ledger`, deterministic point-event
    idempotency, profile point summaries, referral signup points, and 10%
    upstream referral activity bonuses.
- [x] 12.10 Bind public order quote acceptance to maker signer ownership and
  atomic order fills.
  - 2026-05-24: Added order-linked quote creation, maker accept prefill,
    maker order signer proofs bound to amount/price/min fill/expiry/addresses,
    order-linked multisig accept checks, taker quote signer proof regression
    coverage, and Postgres atomic trade/event/order-fill persistence.
  - 2026-05-24 loophole hardening: order creation and order-quote creation now
    require the submitted USDC address to match the user's verified Base EVM
    wallet. Pearl-only users stay profile-capable, but market trading remains
    fail-closed until multi-wallet account linking exists.
- [ ] 12.11 Add user management/admin views for wallet users.
  - Missing: admin/search view for users, linked wallets, referred-by tree,
    points ledger, profile/contact status, order history, trade history, and
    support-safe account actions.
- [x] 12.12 Build the taker trading UX from `/market` into order quote
  creation and quote acceptance, including open-trade/my-trade status views
  for order-linked trades.
  - 2026-05-24: Added `/market` fill tickets that connect/register the taker
    wallet, create order-backed quotes through `POST /otc/orders/:orderId/quotes`,
    store server maker prefill for the accept page, and route takers into
    quote acceptance with only the taker signer proof required.
  - 2026-05-24 audit: Persisted taker settlement fields on order quote links,
    added `GET /otc/quotes/:quoteId/order-context` for server-authoritative
    accept-page prefill, clear stale local drafts when no server context
    exists, and sort merged open/partially-filled offers by best price.
- [ ] 12.13 Add multi-wallet account linking so one user can prove both a Base
  EVM wallet and one or more Pearl wallets/signers.
  - Missing: wallet-link challenge route, additional wallet rows per user,
    primary wallet/profile selection, UI for linked wallet management, and
    trading flows that accept a Pearl account identity plus verified Base EVM
    payment wallet without weakening USDC ownership checks.
