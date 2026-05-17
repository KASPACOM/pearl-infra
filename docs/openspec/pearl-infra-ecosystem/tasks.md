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
- [ ] 9.2.6 Replace in-memory persistence with the shared database layer.
- [x] 9.2.7 Add explicit deadline fields to the trade model: `quote_expires_at`, `pearl_funding_deadline`, `usdc_deposit_deadline`, `settlement_deadline`, and `refund_available_at`.
- [ ] 9.2.8 Enforce that `createTrade()` on the EVM escrow is called only after quote acceptance / real match, never on page load or quote preview.
- [x] 9.2.9 Add internal statuses for edge cases: `late_prl_funding`, `usdc_refunded`, `prl_release_failed`, `amount_mismatch`, `reorged`, `stale_indexer`, and `unknown_spend`.
- [ ] 9.2.10 Verify on-chain USDC escrow terms match backend trade terms before the frontend is allowed to show the buyer the deposit action.
- [ ] 9.2.11 Persist every external side effect with idempotency key, source event ID, tx hash/outpoint, observed height/block, and actor.

### 9.3 Pearl Indexer

- [x] 9.3.1 Add single-machine indexer runbook and Docker Compose topology.
- [x] 9.3.2 Add minimal block polling loop with mocked `pearld` RPC tests.
- [x] 9.3.3 Add initial Postgres schema for blocks, indexer state, and escrow watches.
- [x] 9.3.4 Add restart-safe Postgres sink and `next_height` state.
- [ ] 9.3.5 Add escrow watch registration API and proof API. Generalized into a shared "watched addresses" primitive that also serves 10.8 (bridge deposits + reserves). See `docs/operations/escrow-watch-api.md` for the design.
  - [x] 9.3.5.a Migration `002_watched_addresses.sql` — drop `escrow_watches`, add `watched_addresses` + `address_observations` + `address_spends` + `bridge_exit_requests`.
  - [x] 9.3.5.b Repository module + types + in-memory fake. Completed in PR #12.
  - [x] 9.3.5.c Postgres implementation of repository. Completed in PR #12.
  - [x] 9.3.5.d HTTP handler (POST `/watches`, GET `/watches/:id`, POST `/watches/:id/close`) + server boot wiring into `main.ts`. Completed in PR #12.
  - [x] 9.3.5.e Unit tests (repository + handler).
  - [x] 9.3.5.f Integration smoke: register → close → read round-trip against postgres on the Hetzner box.
- [ ] 9.3.6 Add funding output detection for watched P2TR escrow addresses.
- [ ] 9.3.6.a Classify PRL funding as on-time, late, underpaid, overpaid, duplicate, or reorged using the trade/deposit deadlines supplied in watch metadata.
- [ ] 9.3.7 Add spend detection using resolved prevouts, with release/refund/unknown classification.
- [ ] 9.3.7.a Add `unknown_spend` handling that blocks settlement and requires manual review.
- [ ] 9.3.8 Add detach/replay reorg tests.
- [ ] 9.3.8.a Add regression test: confirmed PRL funding becomes detached after a reorg and settlement worker can no longer release USDC.
- [ ] 9.3.9 Run a testnet2 integration ingest once testnet PRL/access is available.

### 9.4 Frontend Checkout

- [ ] 9.4.1 Add RFQ buy/sell PRL page in `apps/otc-web`.
- [ ] 9.4.2 Add checkout status page using mocked API responses.
- [ ] 9.4.3 Add public proof page for Pearl and Base settlement legs.
- [ ] 9.4.4 Add admin/manual-review shell for stuck trades.
- [x] 9.4.5 Add typed OTC API client and Base USDC escrow ethers call builders using the shared ABI/config.
- [ ] 9.4.6 Show all relevant deadlines and disable USDC deposit when the deposit cutoff has passed or when on-chain trade terms do not match backend terms.
- [ ] 9.4.7 Display late funding, refunded, reorged, stale indexer, and manual-review states without offering release actions to users.
- [ ] 9.4.8 For proof pages, show quote terms, deadlines, PRL funding/release/refund txids, USDC deposit/release/refund txids, confirmations, and manual-review reason.

### 9.5 Settlement Worker

- [ ] 9.5.1 Join mocked Pearl proof state with mocked Base escrow events.
- [ ] 9.5.2 Implement idempotent release/refund decision records.
- [ ] 9.5.3 Fail closed to manual review on inconsistent, stale, or reorged observations.
- [ ] 9.5.4 Add tests for duplicate events and inconsistent settlement legs.
- [ ] 9.5.5 Enforce release guard: PRL release is allowed only when trade is active, USDC is still deposited, PRL funding was observed before the Pearl funding deadline, both legs meet confirmation thresholds, and no refund/reorg/manual-review flag exists.
- [ ] 9.5.6 Add regression test: buyer deposits USDC, expiry passes, buyer refunds, seller funds PRL late; worker must never release PRL to buyer.
- [ ] 9.5.7 Add regression test: PRL funded, buyer never deposits USDC; worker must choose PRL refund path after deadline.
- [ ] 9.5.8 Add regression test: both legs funded but PRL release broadcast fails; USDC must remain escrowed or be refunded, never released to seller.
- [ ] 9.5.9 Add regression test: PRL release confirmed and USDC release is submitted exactly once despite duplicate indexer/EVM events.

### 9.6 Ops And Release Gates

- [ ] 9.6.1 Add testnet2 node deployment checklist.
- [ ] 9.6.2 Add indexer environment contract and secrets checklist.
- [ ] 9.6.3 Add monitoring checks for node lag, indexer lag, failed broadcasts, and stale escrow watches.
- [ ] 9.6.4 Record one simnet escrow run before enabling any mainnet PRL code path.
- [ ] 9.6.5 Record one Base Sepolia escrow run before enabling any Base mainnet contract path.
- [x] 9.6.6 Deploy the Base Sepolia USDC escrow and record contract address, deploy tx, owner, fee recipient, and native USDC address.
- [ ] 9.6.7 Complete two-step ownership transfer to the approved multisig or approved testnet owner and record acceptance evidence.
- [ ] 9.6.8 Keep Base mainnet deployment blocked until contract review, Base Sepolia evidence, multisig ownership plan, and explicit Sione approval are all recorded.
- [ ] 9.6.9 If Base mainnet is approved later, record mainnet contract address, deploy tx, owner/multisig acceptance tx, fee recipient, native USDC address, and verification link before enabling production settlement.
- [x] 9.6.10 Add operator runbook for late PRL funding, refunded USDC, failed PRL release, unknown Pearl spend, stale indexer, and emergency pause.
- [ ] 9.6.11 Add monitoring checks for trades past deadline, deposits close to expiry, manual-review backlog, duplicate events, and mismatched on-chain/backend terms.

## 10. PRL Igra Bridge And wPRL/USDC Pool

- [x] 10.1 Define the bridge-first product track and record that OTC remains the manual safety layer.
- [x] 10.2 Define the MVP trust model as federated custodial, not fully non-custodial.
- [x] 10.3 Define entry flow: Pearl PRL deposit, indexer confirmation, relayer/federation verification, Igra `wPRL` mint.
- [x] 10.4 Define exit flow: Igra `wPRL` burn/lock, exit request, operator review, Pearl PRL release, proof record.
- [x] 10.5 Define `wPRL` token decimals, symbol/name, conversion rules, mint authority, and owner/multisig controls.
- [ ] 10.6 Design Igra bridge contract interface and events for deposit claims, minting, exit requests, processing, refunds, pause, caps, and replay protection.
- [ ] 10.7 Build Igra bridge contract tests for mint replay protection, exit burn/lock, min/max limits, rolling caps, pause, and processed-exit idempotency.
- [ ] 10.8 Extend Pearl indexer support for bridge deposit watches, reserve addresses, confirmed deposits, reserve spends, pending exits, and reconciliation gaps.
- [x] 10.8.1 Add shared watched-addresses migration for bridge deposit/reserve watches and address observations.
- [x] 10.8.2 Add `bridge_exit_requests` table for mirrored Igra burn/lock events.
- [x] 10.8.3 Implement repository/API support for bridge deposit watches and reserve watches via the shared `/watches` API. Completed in PR #12.
- [ ] 10.8.4 Track Pearl deposit observations by txid/vout, amount, block, confirmations, match status, consumed mint tx, and reorg state.
- [ ] 10.8.5 Track reserve spends and classify each spend as exit release, consolidation, ops transfer, fee/change, or unknown.
- [ ] 10.8.6 Expose reconciliation views for confirmed reserves, pending deposits, pending exits, minted `wPRL` supply, reserve surplus/deficit, stale requests, and unknown reserve spends.
- [ ] 10.9 Build relayer/federation service plan with manual approval mode, quorum rules, idempotency, and operator runbook.
- [ ] 10.10 Add bridge API/proof contracts for deposit status, exit status, reserve backing, and public audit trail.
- [ ] 10.11 Add low-cap pilot gates: min/max amounts, rolling window caps, hot-wallet cap, monitoring, and emergency pause test.
- [ ] 10.12 After bridge entry/exit pilot passes, create `wPRL/USDC` pool plan with initial liquidity, price assumptions, and max bridge exposure approval.
