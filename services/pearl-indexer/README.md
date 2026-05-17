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

- `pearld` block polling loop (`block-poller.ts`).
- **Restart-safe Postgres sink** (`postgres-sink.ts`) — persists every block + `next_height` in a single transaction. On boot, `loadNextHeight(default)` resumes from `indexer_state.next_height`.
- **Reorg detection (detach + replay)** — before saving block `H`, the sink verifies its `previousHash` matches the indexed (non-detached) block at `H-1`. On mismatch it marks the stale parent detached and returns `{ kind: 'reorg', detachedFromHeight: H-1, ... }`. The poller rewinds `nextHeight` to that fork point and the next pass re-fetches; deeper reorgs unwind one block per pass until the chains converge.
- Initial Postgres migration for block + escrow-watch state (`migrations/001_initial.sql`).
- Dockerfile for the single-machine Compose stack in `ops/indexer/docker-compose.yml`.
- Mocked tests for both the poller (reorg-result handling) and the sink (save / duplicate / reorg / loadNextHeight).

## Configuration

| Env var | Default | Meaning |
|---|---|---|
| `PEARL_NETWORK` | `testnet2` | one of `mainnet`/`testnet`/`testnet2`/`simnet`/`regtest` |
| `PEARLD_RPC_URL` | `http://127.0.0.1:44111` | mainnet RPC is `:44107`; testnet2 is `:44111` |
| `PEARLD_RPC_USER` | — | required for authenticated RPC |
| `PEARLD_RPC_PASS` | — | required for authenticated RPC |
| `PEARL_INDEXER_POLL_INTERVAL_MS` | `10000` | ms between `pollOnce()` runs |
| `PEARL_INDEXER_START_HEIGHT` | `0` | initial height when no persisted state |
| `PEARL_INDEXER_DATABASE_URL` | unset | when set → `PgBlockSink`; when unset → `MemoryBlockSink` (dev only, no persistence) |

If `PEARL_INDEXER_DATABASE_URL` is unset the service still runs but **state is in-memory only** — every restart re-indexes from `PEARL_INDEXER_START_HEIGHT`. Set the URL for any deploy that needs durability.

## Restart-Safe State

On boot with `PEARL_INDEXER_DATABASE_URL` set:

1. `PgBlockSink.loadNextHeight(configured_start_height)` reads `indexer_state` where `key = 'next_height'`.
2. If a row exists, resume from that height; otherwise start from the configured value.
3. Each `saveBlock` advances `next_height` to `block.height + 1` in the same transaction as the block insert — `next_height` is never ahead of what's actually indexed.

The advance uses `GREATEST(existing, new)` so reorg rewinds never pull persisted `next_height` backward — only the in-memory poller cursor moves back, and it catches up by re-saving the corrected blocks.

## Reorg Semantics

Per `docs/operations/single-machine-indexer.md`:

- Every block is persisted with its hash + height.
- Before accepting block at `H`, `PgBlockSink` checks `pearl_blocks` for the canonical (non-detached) row at `H-1` and compares its hash to the incoming `previousHash`.
- On mismatch: mark the stale row `detached = true` and return `{ kind: 'reorg', detachedFromHeight: H-1, indexedHash, newPreviousHash }`. The new block is **not** inserted on this pass.
- The poller catches `reorg`, rewinds `nextHeight` to `detachedFromHeight`, and resumes. On the next pass it re-fetches that height — if its parent at `H-2` also mismatches, the same detach happens one level deeper. Unwinds reorgs of arbitrary depth one block at a time.
- External callbacks/effects keyed on a particular block **must** check `detached` before treating that block as final.

## Testing

```bash
npm --workspace @kaspacom/pearl-indexer-service test
```

Covered:

- block polling against a mocked RPC source;
- `PearlBlockPoller` reorg-result handling (rewinds `nextHeight` to fork point);
- `PgBlockSink.saveBlock`: brand-new block, matching-parent block, reorg detection, duplicate-skip;
- `PgBlockSink.loadNextHeight`: persisted value + default fallback.

The `PgBlockSink` tests use a fake `PgTransactionalClient` — no live Postgres required. Live-pg integration tests run against the compose stack and are part of deploy verification, not unit tests.
