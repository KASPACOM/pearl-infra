# Next Steps

## Current Status

The repo is now a clean Pearl infrastructure knowledge base and planning repo.

Completed:

- GitHub repo created/pushed: https://github.com/marciano147/Pearl-infra-ecosystem
- OpenSpec proposal/design/specs/tasks added under `docs/openspec/pearl-infra-ecosystem/`
- Resource hub added: `docs/resources.md`
- Upstream manifest added: `docs/upstream-manifest.md`
- App thesis added: `docs/research/pearl-app-thesis.md`
- Upstream Pearl source linked as pinned submodule at `upstream/pearl`
- Goal-based contribution checklist added in `CONTRIBUTING.md`

## Existing Pearl Explorer Finding

Pearl already has a public explorer:

- Mainnet UI: `https://explorer.pearlresearch.ai/?network=mainnet`
- Observed UI routes: `/`, `/blocks`, `/transactions`, `/block/:hash`, `/tx/:txid`

So KaspaCom should **not** build another generic explorer UI first. Build only:

1. reusable chain-data adapters;
2. SDK primitives for wallets/payments;
3. app-specific views/widgets where the existing explorer does not solve the business use case.

## Smart Contract Finding

Current evidence says Pearl is a Bitcoin-style UTXO chain, not an EVM/smart-contract L1. The repo and docs show:

- `pearld` full node forked from `btcd`;
- `oyster` wallet forked from `btcwallet`;
- UTXO transactions, Taproot, P2SH/multisig, and txscript-style scripts;
- no obvious Solidity/EVM/WASM contract deployment or call RPCs;
- the whitepaper mentions future/native settlement of compute contracts as a possible direction, not current deployed general-purpose smart contracts.

Practical implication: app ideas should center on wallets, payments, indexing, OTC/market data, mining/inference ops, and off-chain compute-marketplace workflows, not DeFi smart contracts.

## What We Still Need

### Must Decide

1. **First product track**
   - Recommended: **App-facing chain data layer + wallet SDK foundation**, not a duplicate explorer UI.
   - Reason: Pearl already has a public explorer at `https://explorer.pearlresearch.ai/?network=mainnet`. We only need our own chain-data service if existing public endpoints are not stable/app-friendly enough for payments, wallets, alerts, or KaspaCom dashboards.

2. **Runtime stack**
   - Recommended: TypeScript monorepo with packages/services:
     - `packages/pearl-sdk`
     - `packages/pearl-rpc`
     - `services/chain-data-api`
     - `services/market-data`
     - later app UIs only where Pearl does not already cover the use case

3. **Data source strategy**
   - Phase 1 for OTC: run our own Pearl node/indexer and keep Pearl's public Blockbook as fallback/cross-check.
   - Phase 1 for non-money apps: public explorer/Blockbook surfaces are acceptable while the node-backed adapter matures.
   - Phase 2: harden self-hosting into production deployment with monitoring, regional redundancy, and runbooks.

4. **Product order**
   - Chain data adapter/API, reusing existing explorer/Blockbook where possible
   - Wallet SDK + payment request schema
   - Pearl Pay
   - OTC market tools
   - AI compute marketplace
   - Browser extension only after web apps require wallet signing

## Recommended Implementation Phase 1

Build the **read-only app data foundation** first. This is not an explorer clone; it is the reusable backend/SDK layer that other apps need.

Deliverables:

1. TypeScript workspace scaffold.
2. `packages/pearl-rpc`:
   - network config
   - typed `pearld` RPC client
   - typed Blockbook client
   - mocked fixtures/tests
3. `services/chain-data-api`:
   - `/health`
   - `/chain/stats`
   - `/blocks/recent`
   - `/tx/:txid` contract stub
   - `/address/:address` contract stub
   - source adapters for self-hosted `pearld` first, Pearl explorer/Blockbook fallback second
4. CI:
   - install
   - typecheck
   - test

Success criteria:

- `npm install` works.
- `npm run typecheck` passes.
- `npm test` passes.
- README explains how to run the skeleton.
- No secrets or mainnet wallet material.

## Recommended Implementation Phase 2

Build wallet/app primitives:

1. `packages/pearl-sdk` address validation wrapper.
2. Pearl payment request schema.
3. Transaction lifecycle interfaces.
4. Future connector interface without implementing browser extension yet.

## Recommended Implementation Phase 3

Pick first app:

- **Pearl Pay** if we want transaction usage.
- **Wallet-connect style SDK / browser extension** once web apps need signing.
- **Explorer extension/widgets**, not a full explorer clone, if Pearl's existing explorer lacks embeddable analytics or app APIs.
- **OTC market tool** if we want immediate PRL market relevance.
- **AI compute marketplace** if we can line up GPU operators and user demand.

## Recommendation

Implement Phase 1 now: **chain data adapter/API + RPC SDK scaffold**. Do not build a competing explorer UI unless a clear gap appears. The use case is app infrastructure: payments, confirmations, wallet activity, alerts, OTC/market widgets, and later compute-marketplace settlement UX.
