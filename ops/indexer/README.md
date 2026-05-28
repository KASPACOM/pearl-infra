# Pearl Indexer MVP Runbook

## Goal

The indexer is the marketplace truth layer for Pearl-side escrow state. It should ingest from KaspaCom-owned `pearld` first and use public Blockbook only as a fallback/cross-check.

## MVP Sources

Primary:

- `PEARLD_RPC_URL=http://127.0.0.1:44107`
- `PEARLD_RPC_USER`
- `PEARLD_RPC_PASS`

Fallback:

- `https://blockbook.pearlresearch.ai`

## Single-Machine Start

The MVP deployable shape is one Linux VM with `pearld`, Postgres, and the Pearl indexer service in one Docker Compose project.

```bash
cd ops/indexer
docker compose up -d
```

Required environment:

```bash
PEARLD_RPC_USER=...
PEARLD_RPC_PASS=...
PEARLD_MINING_ADDRESS=tprl1p...
PEARL_INDEXER_POSTGRES_PASSWORD=...
```

See [`docs/operations/single-machine-indexer.md`](../../docs/operations/single-machine-indexer.md) for sizing, failure modes, and the implementation sequence.
See [`docs/operations/otc-deployment-env-contract.md`](../../docs/operations/otc-deployment-env-contract.md) for canonical secret names and required environment by service.

## MVP Responsibilities

- Track chain tip and detect stalled sync.
- Register escrow watches by trade ID and P2TR address.
- Detect funding outpoint and confirmations.
- Detect spend and classify as release/refund/unknown.
- Revert or mark unsafe state when a block detaches.
- Serve proof API data to the OTC backend.

## Escrow Decision Rule

Release/refund decisions must use the primary node-backed indexer. Public Blockbook can confirm a result, but it cannot be the sole source of truth for a trade transition.

## Health Checks

Minimum checks:

- latest indexed height is within configured lag of node tip;
- node RPC responds to `getblockcount`;
- fallback Blockbook responds;
- escrow watch queue has no stuck jobs above threshold.

Detailed monitoring thresholds, SQL checks, and operator actions are defined in
[`docs/operations/otc-monitoring.md`](../../docs/operations/otc-monitoring.md).
