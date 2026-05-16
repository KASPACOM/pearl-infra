# Repository Layout

Pearl infra is organized as a monorepo because the OTC product crosses frontend, backend, chain indexing, and Base contracts.

## Top-Level Folders

| Path | Owns | Notes |
|---|---|---|
| `apps/` | User-facing frontends | `otc-web` starts as the checkout/proof/admin UI shell |
| `services/` | Backend processes | API, Pearl indexer service, settlement worker |
| `contracts/` | Solidity contracts | Base USDC escrow lives here |
| `packages/` | Shared TypeScript libraries | SDK, RPC, indexer models, script helpers, USDC client ABI/types |
| `ops/` | Runtime/runbooks | Pearl node and indexer deployment notes |
| `docs/` | Product/spec/research docs | OpenSpec, build guides, product architecture |
| `upstream/pearl/` | Pinned Pearl source | Submodule/reference only |

## Product Boundaries

### Frontend

`apps/otc-web`

- RFQ flow.
- Checkout.
- Proof page.
- Admin/dispute views until they deserve a separate app.

### Backend

`services/otc-api`

- Quotes.
- Trades.
- Public proof endpoint.
- Admin/dispute API.

`services/pearl-indexer`

- Node-backed Pearl ingestion.
- Escrow watch/proof state.
- Reorg handling.

`services/settlement-worker`

- Joins Pearl and Base state.
- Broadcasts releases/refunds.
- Fails closed into manual review.

### Contracts

`contracts/usdc-escrow`

- Base USDC escrow contract.
- Holds USDC by trade ID.
- Releases/refunds only through explicit state transitions.

### Shared Packages

`packages/pearl-sdk`

- Address validation.
- Amount parsing.
- OTC quote/trade state types.

`packages/pearl-rpc`

- Typed `pearld` JSON-RPC client.

`packages/pearl-indexer`

- Indexer data models and proof helpers.

`packages/pearl-script`

- Taproot/script/escrow package types.

`packages/usdc-escrow-client`

- TypeScript ABI and event helpers for the Solidity contract.

## Rules

- Shared domain types go in `packages/`, not copied into apps/services.
- Chain side effects go through services/workers, not frontend code.
- The OTC MVP uses our own `pearld` as the primary Pearl source.
- Public Blockbook is fallback/cross-check only for escrow decisions.
- Solidity contracts live in `contracts/`; TS clients for those contracts live in `packages/`.
