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
