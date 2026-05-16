# pearl-infra

KaspaCom infrastructure foundation for building Pearl ecosystem apps.

## Purpose

Pearl is a Bitcoin-style UTXO L1 with a working node (`pearld`), wallet daemon (`oyster`), desktop wallet, SPV/light client, JSON-RPC/wallet RPC surfaces, Taproot/P2TR addresses, OP_RETURN/null-data support, Blockbook-style endpoints, OTC market APIs, and Pearl-certified Hugging Face/vLLM models.

This repo is the planning and infrastructure base for KaspaCom Pearl apps:

- chain/node adapters
- wallet SDK primitives
- app-facing chain data APIs
- Pearl Pay/payment rails
- OTC/market-data rails
- AI compute marketplace control-plane interfaces
- future browser/mobile wallet connector interfaces

## Repository Layout

```text
apps/       Frontend apps, starting with the OTC checkout/proof UI
services/   Backend API, Pearl indexer, settlement workers
contracts/  Base Solidity contracts, starting with USDC escrow
packages/   Shared TypeScript libraries and typed domain contracts
ops/        Pearl node/indexer deployment templates and runbooks
docs/       Product specs, development guides, OpenSpec, research
```

See [`docs/architecture/repo-layout.md`](docs/architecture/repo-layout.md) for ownership boundaries.

## Fast Research Links

Start here before any Pearl task:

- **LLM / agent context** (single page): [`AGENTS.md`](AGENTS.md)
- **🛠 Build-on-Pearl quickstart** (agent build manual — deps, network config, copy-paste hello-world code): [`docs/development/quickstart.md`](docs/development/quickstart.md)
- **Team briefing** (meeting-ready, live numbers): [`docs/team-briefing.md`](docs/team-briefing.md)
- **Builder FAQ** ("can I build X on Pearl?"): [`docs/FAQ.md`](docs/FAQ.md)
- **Glossary** (Pearl-specific terms): [`docs/GLOSSARY.md`](docs/GLOSSARY.md)
- Resource hub: [`docs/resources.md`](docs/resources.md)
- Developer local setup: [`docs/development/local-dev-guide.md`](docs/development/local-dev-guide.md)
- Public endpoints / node strategy: [`docs/development/public-endpoints.md`](docs/development/public-endpoints.md)
- Pearl chain primer: [`docs/development/pearl-chain-primer.md`](docs/development/pearl-chain-primer.md)
- Pearl app development guide: [`docs/development/pearl-app-development.md`](docs/development/pearl-app-development.md)
- **Multisig & escrow on Pearl**: [`docs/development/escrow-multisig-on-pearl.md`](docs/development/escrow-multisig-on-pearl.md)
- **Covenants on Pearl** (what OP_CAT unlocks + what it's NOT needed for): [`docs/development/covenants-on-pearl.md`](docs/development/covenants-on-pearl.md)
- **🎯 Two-track product menu** (ecosystem grants vs profit — for team meeting): [`docs/product/two-track-product-menu.md`](docs/product/two-track-product-menu.md)
- **Pearl OTC settlement desk plan**: [`docs/product/pearl-otc-settlement-desk.md`](docs/product/pearl-otc-settlement-desk.md)
- **Pearl OTC API/contracts**: [`docs/product/pearl-otc-contracts.md`](docs/product/pearl-otc-contracts.md)
- Next steps: [`docs/next-steps.md`](docs/next-steps.md)
- Upstream manifest: [`docs/upstream-manifest.md`](docs/upstream-manifest.md)
- App thesis: [`docs/research/pearl-app-thesis.md`](docs/research/pearl-app-thesis.md)
- OpenSpec: [`docs/openspec/pearl-infra-ecosystem/`](docs/openspec/pearl-infra-ecosystem/)

## Pearl At A Glance

| | |
|---|---|
| Chain type | Bitcoin-style UTXO L1 (forked from `btcd`/`btcwallet`) |
| Consensus | Proof-of-Useful-Work — INT8 matrix multiplication + Plonky2 zkSNARK |
| Block time | 194 s target |
| Max supply | 2,100,000,000 PRL |
| Emission | Polynomial decay `R(t) = H/(t+H)` |
| Addresses | Taproot-only (`prl1p…`), Bech32m |
| Script | Bitcoin-style stack VM with `OP_CAT` + `OP_CHECKXMSSSIG` (post-quantum) |
| Smart contracts | **None** (no EVM/WASM/Solidity) |
| Native bridges | **None** |
| KaspaCom build stack | TypeScript (NestJS / Angular) over JSON-RPC + gRPC |

## Current Phase

**MVP scaffold.** This repo now contains planning docs plus the first shared package, service, ops, and contract scaffolds for the Pearl OTC settlement desk. No mainnet custody or production marketplace code should ship until simnet/testnet verification and security gates pass.

OpenSpec: `docs/openspec/pearl-infra-ecosystem/`

## Non-Goals

- Do not build a browser extension before there is a real web app/use case requiring wallet signatures.
- Do not assume EVM-style smart contracts, DeFi, or token mechanics unless Pearl support is verified.
- Do not fork/copy the full Pearl monorepo blindly.
- Do not commit secrets, wallet seeds, private keys, RPC passwords, or mainnet custody material.

## Build Checks

```bash
npm test
npm run typecheck
```

CI runs the same two checks on pull requests to `main`.

## Goal-Based Execution

Every implementation task must include:

1. success criteria
2. applicable skill(s)
3. verification command(s)
4. failure escalation path

A task is not complete until its deliverable exists and verification evidence is recorded.


## Upstream Source

Pinned upstream Pearl source is linked as a submodule:

```bash
git submodule update --init --recursive
```

Path: `upstream/pearl`
Commit: `0c8cef72da75d10ffd52ac20d3c0b075d9d9f1f7`
