# Pearl Indexer Service

Service that turns a KaspaCom-owned `pearld` node into marketplace-ready escrow proof state.

## Responsibility

- Ingest blocks and mempool data from primary `pearld`.
- Register and monitor escrow watches.
- Detect funding outpoints and spends.
- Handle reorgs and confirmation thresholds.
- Serve proof data to `services/otc-api`.

## Source Policy

Primary source for OTC MVP: KaspaCom-owned `pearld`.

Fallback/cross-check source: Pearl Research Labs Blockbook.

No release/refund decision should use public Blockbook as the sole source.

## Current Implementation Slice

- Minimal `pearld` block polling loop.
- Mocked block-source tests.
- Initial Postgres migration for block and escrow-watch state.
- Dockerfile intended for the single-machine Compose stack in `ops/indexer/docker-compose.yml`.

The current sink is in-memory only. The next implementation task is a restart-safe Postgres sink that persists `next_height` in `indexer_state`.
