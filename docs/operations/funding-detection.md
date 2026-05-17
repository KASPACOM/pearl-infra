# Funding Output Detection (Step 6 / OpenSpec 9.3.6 + 9.3.6.a)

The indexer's funding scanner watches every block written by the block-poller for outputs that pay any active `watched_addresses` row. Each match becomes a row in `address_observations` with a confirmation count and a classification (on-time / late / underpaid / overpaid / unknown) that downstream consumers (settlement worker, otc-api proof page) read directly.

This document fixes the architecture, the schema delta, and the classification taxonomy before any code lands. Code + tests follow in stacked PRs per the project workflow.

## What's in this milestone

| OpenSpec | Scope |
|---|---|
| 9.3.6 | Match P2TR outputs from new blocks against active watches; write `address_observations`; advance `match_status` (`pending` → `confirmed` → `spent`); detach observations on reorg via `pearl_blocks.detached` cascade. |
| 9.3.6.a | Classify each observation as `on_time`, `late`, `underpaid`, `overpaid`, `duplicate`, or `unknown_funding` per the deadline/amount metadata on the originating watch. |

Out of scope (deferred):
- Retro-scanning historical blocks when a new watch is registered. Watches are normally registered before funding lands; ops can manually trigger a backfill if needed.
- Persisting full block outputs to a `pearl_block_outputs` table. We hold outputs in memory long enough to match against watches and then drop them; step 7 may reconsider for spend resolution.
- Multi-watch matches in a single tx output (rare; the schema unique constraint on `outpoint` would force collision resolution we don't need yet).

## Architecture: composite sink pattern

The funding scanner is a `PearlBlockSink` that **wraps** `PgBlockSink`. It is the only sink the poller talks to; internally it delegates the block-save to `PgBlockSink` first, then runs match logic against the block's outputs.

```text
PearlBlockPoller
    │
    │ saveBlock(block)
    ▼
FundingScannerSink ──── 1. delegate saveBlock to PgBlockSink (atomic block save)
    │
    │                   2. if saved: for each output in block:
    │                        - lookup active watch by address
    │                        - if match: write to address_observations + classify
    │
    │                   3. for each `funded` observation reaching threshold:
    │                        - bump match_status to 'confirmed'
    │
    ▼
PgBlockSink ─── writes pearl_blocks + indexer_state
```

Why a composite sink rather than a separate poller:
- Single source of truth for "current height": the block-poller already drives it.
- Avoids a second `next_height` tracker drifting behind block storage.
- One transaction per block: block save + observations write together. Failure on the funding side rolls back the block save and the poller retries at the same height on the next tick — no partial state.
- Re-using the existing reorg semantics: when `PgBlockSink` returns `kind: 'reorg'`, no match logic runs; on the next pollOnce the detached parent's observations cascade-detach via the FK.

## Block-poller verbosity bump

The poller currently calls `getblock <hash> 1` which returns only txids. The scanner needs output scripts and amounts. Bump to verbosity 2:

```ts
// services/pearl-indexer/src/block-poller.ts (createPearldBlockSource)
const block = await client.call<PearldVerboseBlock>('getblock', [hash, 2]);
```

`getblock 2` returns each tx with `vout[]` already including the decoded P2TR address in `scriptPubKey.address`. We do not need our own bech32m decoder — pearld has already done the work.

`PearlBlockSummary` grows a new field:

```ts
export interface PearlBlockOutput {
  txid: string;
  vout: number;
  amountGrains: string;          // BigInt-encoded
  scriptPubKey: {
    hex: string;
    type?: string;               // 'witness_v1_taproot' for P2TR
    address?: string;            // bech32m; absent for non-standard scripts
  };
}

export interface PearlBlockSummary {
  hash: string;
  height: number;
  previousHash?: string;
  txids: string[];                // kept for back-compat with PgBlockSink writes
  outputs: PearlBlockOutput[];    // NEW: all outputs in this block
  timestamp: string;
}
```

Payload impact: full mainnet blocks are typically tens of KB at the current testnet2 size; production blocks would be larger but well within reason for a 10-second poll cadence.

## Address matching

For each output where `scriptPubKey.address` is set:

```ts
const watch = await repo.findActiveByAddress(output.scriptPubKey.address);
if (!watch) continue;          // not one of ours
```

`findActiveByAddress` is a new repository method on `WatchedAddressRepository` that returns the single active watch (status='active') matching `(address, network)`. Since we run a separate indexer container per network with a separate Postgres, network filtering is implicit — the indexer can only see its own network's watches.

If multiple `active` watches share the same address (rare; only happens if ops manually registers duplicate purposes), we observe under each of them. This is intentional — the schema allows it and reflects truth on the chain.

## Classification (9.3.6.a)

Each observation is classified at insert time and the result stored in a new `address_observations.classification` column. Classification is one of:

| Classification | When |
|---|---|
| `on_time` | observed at height H, `H <= watch.metadata.pearl_funding_deadline_height` AND `amount == watch.metadata.expected_amount_grains` |
| `late` | `H > pearl_funding_deadline_height`, amount matches |
| `underpaid` | `H <= deadline`, `amount < expected_amount_grains` |
| `overpaid` | `H <= deadline`, `amount > expected_amount_grains` |
| `duplicate` | unique-constraint collision on `outpoint`; observation already exists. Scanner logs + skips. |
| `unknown_funding` | watch has no `expected_amount_grains` or no `pearl_funding_deadline_height` in metadata (e.g. bridge reserve). Observation recorded, no classification possible. |

Deadlines can come as either a block height (`pearl_funding_deadline_height`) or a unix timestamp (`pearl_funding_deadline_ts`). The scanner prefers height when present (deterministic on-chain measure); falls back to timestamp comparison against `block.timestamp`.

`classification` is **orthogonal to `match_status`**:
- `match_status` is the **lifecycle** of the observation: `pending` → `confirmed` → `spent` (or `detached`).
- `classification` is the **funding correctness verdict** at observation time. It does not change after the observation is written (a `late` observation stays `late` even after reaching confirmations).

The settlement worker (9.5.x) reads both fields: it only authorizes PRL release if `match_status='confirmed'` AND `classification='on_time'`. All other combinations fail closed to manual review.

### Mapping to `pearl-otc-contracts.md` invariants

The product invariants doc states: "PRL funding was observed before `pearl_funding_deadline`". `classification='on_time'` is the operational expression of that invariant. `late`/`underpaid`/`overpaid` map directly to the doc's edge-case test matrix and force manual review.

## Confirmation advancement

The scanner does **not** lazily compute confirmations at read time. Instead, on each new block save:

1. Insert any new observations for the new block at `match_status='pending'`, `confirmations=0`.
2. UPDATE all `match_status='pending'` observations whose `(new_block.height - observation.height + 1) >= watched_addresses.required_confirmations` → set `match_status='confirmed'`, set `confirmations = new_block.height - observation.height + 1`.
3. Periodically (every N blocks, e.g. N=10) refresh `confirmations` on still-`pending` rows so the proof page shows a fresh count.

Costs: one UPDATE-WHERE per block tick. With the expected scale (hundreds of watches max in MVP), this is negligible. The alternative — lazy compute at read time — would push the `confirmed` threshold check into every settlement worker decision call and into every proof-page render, which is wasted work.

## Schema delta (migration `003_observation_classification.sql`)

```sql
ALTER TABLE address_observations
  ADD COLUMN IF NOT EXISTS classification TEXT;

CREATE INDEX IF NOT EXISTS address_observations_classification_idx
  ON address_observations (classification);
```

Nullable on existing rows (there are none on dev/prod). Future inserts always populate it.

No change to `address_spends` — spend classification (release/refund/unknown) is step 7's concern.

## Reorg behavior (inherited, no new code)

When `PgBlockSink` marks a `pearl_blocks` row as detached:
- All `address_observations` referencing that block via `block_hash` cascade-update through application-level logic: scanner detects the detach result and sets `match_status='detached'` on the affected observation rows.
- Cascade-detach is application-level (a single UPDATE statement) rather than a FK trigger because we want it tied to the scanner's deterministic event flow, not a side effect of writes elsewhere.

Step 8 / 9.3.8.a will exercise this with a regression test: PRL funding observed, then the funding block is reorged out, then the settlement worker is asked to release — assertion: release must not authorize.

## Network awareness

Each indexer container sees only its own network's data:
- `pearl-indexer` (testnet2) → `postgres` → testnet2 `watched_addresses`, testnet2 `pearl_blocks`.
- `pearl-indexer-mainnet` → `postgres-mainnet` → mainnet `watched_addresses`, mainnet `pearl_blocks`.

The scanner code is network-agnostic. Operators run one container per network. The watched-addresses HTTP API on each container only registers watches scoped to its own network (validated by `network` field on POST — if a caller POSTs `network='mainnet'` to the testnet2 indexer at 8088, the scanner would never match because there are no mainnet blocks coming in; we could add input validation at API time, but for now the misuse fails closed naturally).

## File layout

- `services/pearl-indexer/migrations/003_observation_classification.sql` — schema delta (ships in this design PR).
- `services/pearl-indexer/src/block-poller.ts` — verbosity bump + `PearlBlockOutput` type addition (code PR).
- `services/pearl-indexer/src/funding-scanner.ts` — new module. `FundingScannerSink` class, `classifyFunding` pure function, `findActiveByAddress` repository extension (code PR).
- `services/pearl-indexer/src/main.ts` — boot wiring: wrap `PgBlockSink` with `FundingScannerSink` (code PR).
- `services/pearl-indexer/test/funding-scanner.test.ts` — unit tests for matching, classification matrix, confirmation advancement, reorg cascade (tests PR).

## Substeps (replaces OpenSpec 9.3.6 / 9.3.6.a)

- [ ] 9.3.6.a-1 Migration `003_observation_classification.sql` — adds the `classification` column.
- [ ] 9.3.6.a-2 Verbosity bump in `block-poller.ts`; `PearlBlockSummary.outputs` typed addition; existing `PgBlockSink` keeps writing the same columns (block-level changes only).
- [ ] 9.3.6.a-3 `FundingScannerSink` composite sink + repository `findActiveByAddress` + classification pure function.
- [ ] 9.3.6.a-4 Boot wiring in `main.ts` + Hetzner rebuild + apply migration 003 on both postgres instances.
- [ ] 9.3.6.a-5 Unit tests across the classification matrix and reorg-cascade detach.
- [ ] 9.3.6.a-6 Live smoke: register a mainnet watch with a small `expected_amount_grains`, send a real PRL output to that address, confirm `address_observations` populates with `classification='on_time'` and `match_status` advances to `confirmed` after `required_confirmations` blocks.

## Test plan

1. **Unit (`funding-scanner.test.ts`):**
   - Output that matches active watch → observation inserted, classification computed correctly across all six categories.
   - Output that matches NO watch → no DB write.
   - Multiple outputs in one block matching the same watch → multiple observations.
   - New block at `height = obs.height + required_confirmations - 1` → match_status advances `pending → confirmed`.
   - Reorg detach result from inner `PgBlockSink` → no match logic runs; on next pollOnce, observations referencing the detached block transition to `detached`.

2. **Live smoke (mainnet, post-deploy):**
   - POST `/watches` to `http://127.0.0.1:8089/watches` with a real mainnet P2TR address controlled by us, `expected_amount_grains` = small probe amount, `pearl_funding_deadline_height` = current_tip + 100.
   - Send small PRL probe to the address from the Pearl desktop wallet.
   - Wait for inclusion. Confirm `address_observations` row appears with `classification='on_time'`, `match_status='pending'`, `confirmations` advancing each block.
   - After required_confirmations blocks: `match_status='confirmed'`.

## Open questions for reviewer

1. **Classification as enum or free-form string?** I'm leaning string for forward-compat (step 7 + bridge may add more), but if you prefer a constrained set we can `CHECK (classification IN (...))`.
2. **Should the API expose `classification` on `GET /watches/:id`?** Yes — settlement worker and proof page both need it. The repository's `getWithHistory` join already returns full observation rows; this just means the JSON shape gains a field.
3. **Block output payload size on mainnet** — verbosity 2 blocks at scale may exceed 1 MB. Not a concern for current testnet2 sizes; flagging for future mainnet load testing.
