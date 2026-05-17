# Pearl Single-Machine Indexer

## Goal

Run the first Pearl marketplace indexer like the KASPACOM single-service indexers: one VM, one Docker Compose project, one database, and a narrow API surface for backends.

This is the OTC MVP truth layer for Pearl-side escrow state. Public Blockbook can cross-check data, but release/refund decisions must come from the KaspaCom-owned node-backed indexer.

## Topology

The single docker compose file at `ops/indexer/docker-compose.yml` runs **two parallel network stacks** on the same Linux VM: testnet2 and mainnet. Each network gets its own pearld, its own postgres volume, and its own indexer container so a re-sync or schema migration on one network never touches the other. Either stack can be brought up alone via `docker compose up -d pearld postgres pearl-indexer` (testnet2) or `docker compose up -d pearld-mainnet postgres-mainnet pearl-indexer-mainnet` (mainnet); `docker compose up -d` brings up both.

```text
Linux VM
  |
  | docker compose
  v
+-- testnet2 stack ----------------------+   +-- mainnet stack ----------------------+
| pearld (RPC :44111, P2P :44112)        |   | pearld-mainnet (RPC :44107, P2P :44108)|
|   |                                    |   |   |                                   |
|   | JSON-RPC over private docker net   |   |   | JSON-RPC over private docker net  |
|   v                                    |   |   v                                   |
| pearl-indexer (HTTP :8088 → 127.0.0.1) |   | pearl-indexer-mainnet (HTTP :8089)    |
|   |                                    |   |   |                                   |
|   v                                    |   |   v                                   |
| postgres (:5432 localhost)             |   | postgres-mainnet (:5433 localhost)    |
+----------------------------------------+   +---------------------------------------+
                |                                              |
                +------------------------+---------------------+
                                         v
            otc-api / settlement-worker / proof page
                  (routes per-network by HTTP base URL)
```

Mainnet pearld P2P is exposed on `0.0.0.0:44108` for peer connectivity; mainnet RPC stays on `127.0.0.1:44107` and the watched-addresses API on `127.0.0.1:8089`. Same loopback discipline as testnet2.

## Resource Sizing

| Process | RAM | Disk | CPU |
|---|---:|---:|---:|
| `pearld` | 4 GB | 100 GB NVMe with `txindex` | 1-2 cores |
| Postgres | 2-4 GB | 50-200 GB depending on indexed detail | 1 core |
| `pearl-indexer` | 1 GB | minimal | 1 core |
| API surface | 512 MB | minimal | shared |

Dev VM target:

- 2 vCPU
- 8 GB RAM
- 200 GB SSD

Production MVP target:

- 4 vCPU
- 16 GB RAM
- 500 GB NVMe SSD

No GPU is required unless the same host also runs Pearl useful-work mining or inference services.

## V1 Indexing Strategy

Start with polling, not websocket dependency:

1. `getblockcount`
2. `getblockhash(height)`
3. `getblock(hash, true)`
4. persist block hash, height, previous hash, timestamp, txids
5. advance `indexer_state.next_height`

Websocket block notifications can be added after we verify Pearl reconnect semantics.

## Reorg Rules

Pearl is sequential, so the indexer does not need Kaspa BlockDAG virtual-chain logic. It still needs deterministic detach/replay behavior:

- Persist every block by hash and height.
- Before accepting a new block at height `H`, verify its `previousHash` matches the indexed block at `H - 1`.
- If it does not match, mark detached blocks unsafe from the fork point and replay the replacement chain.
- Escrow proofs that depend on detached blocks become `reorged` or unconfirmed.
- External callbacks and settlement events must be idempotent so replays do not double-release funds.

## Scanner Lessons To Carry Over

Do not copy a pure output-only scanner pattern.

For escrow, the indexer needs:

- outputs paying the watched escrow address;
- resolved inputs that spend those outputs;
- spend classification as `release`, `refund`, or `unknown`;
- prevout backfill before trusting spend classification.

For future inscriptions/KRP protocols, validate the full script/envelope shape and parsed payload instead of matching raw substrings.

## Test Ladder

Can test before a live Pearl node:

- block polling against mocked `pearld` RPC;
- Postgres migration shape;
- escrow watch registration;
- proof model generation;
- reorg detach/replay state transitions;
- API responses against fixtures.

Requires `pearld`:

- real block ingestion;
- real tx lookup and `txindex` behavior;
- escrow funding/spend detection;
- broadcast tests;
- confirmation/reorg tests against real block data.

## Implementation Sequence

1. Single-machine runbook and compose file.
2. Minimal block poller with mocked RPC tests.
3. Postgres schema for blocks, indexer state, and escrow watches.
4. Real Postgres sink and restart-safe `next_height`.
5. Escrow watch API.
6. Funding output detection.
7. Spend detection with resolved prevouts.
8. Reorg detach/replay tests.
9. Proof API consumed by `otc-api`.
10. Testnet2 integration run once testnet PRL is available.

## Operational Checks

- `pearld` RPC responds to `getblockcount`.
- latest indexed height is within configured lag of node tip.
- Postgres migrations applied.
- escrow watch queue has no stale rows beyond threshold.
- no public exposure of `pearld` RPC or Postgres.
- Blockbook cross-check lag is recorded but not used as the primary decision source.
