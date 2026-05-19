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
  release/refund transaction tests, and an opt-in live `pearld` RPC smoke test.
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
  support/error alert form, while settlement execution controls stay absent.

Current delegation queue after PR #70:

- Bridge events/indexer owner: finish `10.8.7.b`, `10.8.8.b`, and `10.8.9.b`
  by wiring the Igra RPC event poller, checkpointed cursor, Postgres
  `bridge_exit_requests` writes, and live Pearl reserve-spend scanner updates.
- Bridge FE owner: implement `10.10.5` proof-page/frontend models for deposit
  status, exit status, reserve backing, blockers, public audit fields, event
  hashes, and quorum counts.
- Bridge rehearsal owner: execute `10.8.10` with real simnet Pearl deposit
  txids, Igra mint receipts, Igra burn events, Pearl release txids, and reserve
  reconciliation evidence.
- Bridge ops/custody owner: complete `10.11.3` by selecting live reserve
  addresses, signer policy, hot/warm/cold reserve caps, monitoring alerts, and
  an emergency pause drill.
- Threshold authorization owner: scope `10.13.1` through `10.13.3` for
  federation membership, signer custody, threshold/FROST-style authorization,
  and public reserve proof snapshots.
- EVM audit owner: re-audit `WrappedPearl` and `PearlBridge` before pilot
  rehearsal, covering ownership transfer, operator/relayer permissions, cap
  semantics, pause behavior, replay protection, exit liabilities, deployment
  scripts, and verification evidence.
- OTC evidence owner: finish `9.8.10.c`, `9.3.9`, and `9.8.11` for the full
  quote -> accept -> PRL funding -> Base deposit -> worker -> public proof path
  and later testnet2/Base Sepolia run with real txids.
- Base ops owner: finish `9.6.7`; keep `9.6.9` blocked until explicit Base
  mainnet approval.
- Oyster/prod ops owner: finish `9.10.6.b`, `9.10.8.d`, `9.10.9.b`, and
  `9.10.10.f` only when prod release is approved.
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
- [ ] 9.3.9 Run a testnet2 integration ingest once testnet PRL/access is available.

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
- [x] 9.4.6 Show all relevant deadlines and disable USDC deposit when the deposit cutoff has passed or when on-chain trade terms do not match backend terms.
  - [x] 9.4.6.a Add shared deadline models and deposit-action gating for wallet
    connection, chain mismatch, expired USDC deposit windows, and failed
    on-chain term verification.
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
- [ ] 9.6.7 Complete two-step ownership transfer to the approved multisig or approved testnet owner and record acceptance evidence.
  - `transferOwnership` is initiated to `0x35C76bF5A701A30629d9706F4c8f77a4a0cA5978`; acceptance tx and final `owner()` evidence are still required.
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

Status after admin FE wiring: API startup/idempotency, derivation
allocation safety, watch registration, Pearl funding/spend detection, reorg
hardening, Pearl proof projection, Base escrow event ingestion, the persistent
settlement-worker iteration, the Pearl signer boundary policy/request/audit
layer, explicit deployment environment/secret contracts, monitoring contracts,
and backend-driven RFQ/accept/checkout/proof/admin screens are implemented,
with Base Sepolia native-USDC stress evidence recorded. The remaining
production blockers are live simnet/testnet evidence, alert secret deployment,
and Base ownership acceptance evidence.

Open 9.8 items after admin FE wiring: `9.8.10` and `9.8.11`.

Loophole tracker after admin FE wiring:

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
- [ ] No full OTC simnet escrow evidence yet — PRL-side simnet release/refund
  evidence is recorded for `9.6.4`, but mainnet PRL paths remain blocked until
  `9.8.10` records quote, Base, worker, and proof coverage.
- [ ] No testnet2 Pearl + Base Sepolia end-to-end evidence yet — blocks
  production-like launch until `9.3.9` and `9.8.11` are recorded with txids.
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
- [ ] Base Sepolia ownership acceptance evidence is not recorded yet — blocks
  any Base mainnet path until `9.6.7` is completed.
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
- [ ] 9.8.10 Record a full simnet escrow run: quote -> accept -> PRL funding
  detection -> Base deposit -> PRL release/refund -> Base release/refund ->
  proof.
  - [x] 9.8.10.a Record live simnet watched-address evidence for the fixture
    escrow address via the external read-only indexer API.
  - [x] 9.8.10.b Record wallet-funded PRL-side simnet evidence with Oyster,
    unique escrow address, watched-address detection, release spend, and indexer
    spend classification.
  - [ ] 9.8.10.c Complete the full quote -> accept -> wallet-funded PRL ->
    Base deposit -> settlement-worker release/refund -> public proof path.
    - [x] Add automated full-flow coverage in
      `services/otc-api/test/full-otc-flow.test.ts` for quote acceptance,
      unique simnet escrow watch registration, wallet-funded PRL proof facts,
      Base deposit/release event projection, settlement-worker PRL
      release/refund decisions, and public proof projection.
    - [ ] Replace the simulated Base leg with real Base Sepolia txids and a
      non-Oyster raw signer path, or update Oyster once arbitrary raw tx
      signing is implemented.
- [ ] 9.8.11 Record a testnet2 escrow run with real Pearl and Base Sepolia
  txids before any mainnet PRL code path is enabled.
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
  - [ ] 9.10.6.b Create/populate `prod/oyster-otc-api` in `us-east-1`.
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
- [ ] 9.10.8.d Execute the main/prod deploy path and confirm prod API and web
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
  - [ ] 9.10.10.f Main/prod smoke after prod release path is executed.
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
- [ ] 10.8 Extend Pearl indexer support for bridge deposit watches, reserve addresses, confirmed deposits, reserve spends, pending exits, and reconciliation gaps.
- [x] 10.8.1 Add shared watched-addresses migration for bridge deposit/reserve watches and address observations.
- [x] 10.8.2 Add `bridge_exit_requests` table for mirrored Igra burn/lock events.
- [x] 10.8.3 Implement repository/API support for bridge deposit watches and reserve watches via the shared `/watches` API. Completed in PR #12.
- [ ] 10.8.4 Track Pearl deposit observations by txid/vout, amount, block, confirmations, match status, consumed mint tx, and reorg state.
  - [x] 10.8.4.a Add bridge-service deposit observation projection for outpoint, amount, confirmations, match status, consumed claim spend, unsafe classification, and reorg blockers.
- [ ] 10.8.5 Track reserve spends and classify each spend as exit release, consolidation, ops transfer, fee/change, or unknown.
  - [x] 10.8.5.a Add bridge-service reserve spend projection that separates known spends from unknown spends before relayer decisions.
- [ ] 10.8.6 Expose reconciliation views for confirmed reserves, pending deposits, pending exits, minted `wPRL` supply, reserve surplus/deficit, stale requests, and unknown reserve spends.
  - [x] 10.8.6.a Add bridge-service reconciliation snapshot for reserves, known spends, pending exits, minted supply, surplus/deficit, stale watches, and unknown reserve-spend blockers.
  - [x] 10.8.6.b Add canonical event IDs, event hashes, relayer attestation counts, and quorum requirements to public bridge proof projections.
  - [x] 10.8.6.c Persist reconciliation snapshots so operators can compare reserve health across blocks, not only read the latest in-memory projection.
  - [x] 10.8.6.d Wire the persisted snapshot source into an admin/read-only API.
- [ ] 10.8.7 Poll Igra `PearlBridge` events and mirror deposit claims, exit requests, processed exits, refunds, cap changes, pause changes, relayer changes, and operator changes.
  - [x] 10.8.7.a Add Igra event mirror helpers for all `PearlBridge` event types keyed by `(chainId, txHash, logIndex)`.
  - [ ] 10.8.7.b Connect the mirror helpers to a real Igra RPC/event poller and checkpointed block cursor.
- [ ] 10.8.8 Write Igra exit events into `bridge_exit_requests` with idempotent upsert semantics keyed by `(igra_burn_txid, igra_burn_log_index)`.
  - [x] 10.8.8.a Convert mirrored `ExitRequested` events into idempotent bridge exit rows in the bridge-state repository.
  - [ ] 10.8.8.b Back the exit mirror with Postgres `bridge_exit_requests` writes in the live service.
- [ ] 10.8.9 Classify Pearl reserve spends against mirrored exits, mark exact release txids once, and route mismatches or unknown spends to manual review.
  - [x] 10.8.9.a Add reserve-spend matcher for exact exit release matches, amount mismatch, recipient mismatch, duplicate release txid, and unknown spend blockers.
  - [ ] 10.8.9.b Wire reserve-spend matching into the live Pearl spend scanner and update `bridge_exit_requests` on exact matches.
- [ ] 10.8.10 Run a bridge simnet rehearsal with real Pearl deposit txids, Igra mint receipts, Igra burn events, Pearl release txids, and reserve reconciliation evidence.
- [x] 10.9 Build relayer/federation service plan with manual approval mode, quorum rules, idempotency, and operator runbook.
  - [x] 10.9.1 Add bridge relayer decision policy for manual approval, idempotent mint/release prepare actions, pilot caps, rolling caps, and clean-reconciliation gates.
  - [x] 10.9.2 Harden bridge relayer guardrails after PR #65 strategy review:
    fail closed on wrong-watch observations, observations outside watch
    history, multiple live deposit outputs, insufficient confirmations,
    missing/out-of-range expected amount bounds, and non-`on_time`
    classifications.
  - [x] 10.9.3 Add KAT-style canonical deposit/exit event identity, deterministic event hashing, independent relayer quorum evaluation, finality wait state, and fail-closed blockers for unknown relayers, mismatched event hashes, duplicate attestations, and impossible quorum policies.
  - [x] 10.9.4 Require approved relayer quorum plus manual operator approval before bridge-service mint/release prepare decisions.
- [ ] 10.10 Add bridge API/proof contracts for deposit status, exit status, reserve backing, and public audit trail.
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
- [ ] 10.12 After bridge entry/exit pilot passes, create `wPRL/USDC` pool plan with initial liquidity, price assumptions, and max bridge exposure approval.
  - [ ] 10.12.1 Do not seed a `wPRL/USDC` pool until one low-cap entry and one low-cap exit have passed with public proof and clean reserve reconciliation.
  - [ ] 10.12.2 Define pool initial liquidity source, max bridge exposure, LP ownership, withdrawal authority, and emergency liquidity removal procedure.
- [ ] 10.13 Upgrade from pilot federation to stronger KAT-style release authorization.
  - [ ] 10.13.1 Finalize federation membership, relayer independence requirements, signer custody boundaries, and quorum threshold.
  - [ ] 10.13.2 Replace plain relayer attestations with threshold/FROST-style release authorization or an equivalent reviewed threshold-signing boundary.
  - [ ] 10.13.3 Add public reserve proof snapshots and an audit endpoint for reserve addresses, confirmed reserves, pending exits, minted supply, and cap usage.
