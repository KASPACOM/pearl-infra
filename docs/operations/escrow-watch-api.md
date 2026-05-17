# Watched Addresses API (shared infra for OTC + Bridge)

The Pearl indexer's address-watching layer is shared infrastructure consumed by **two** product surfaces, not just one:

| Consumer | OpenSpec | Uses watched addresses to … |
|---|---|---|
| OTC settlement desk | 9.3.5 | watch each P2TR trade escrow; detect funding and release/refund spends |
| Igra `wPRL` bridge | 10.8 | watch every bridge deposit address and every reserve address; detect deposits and reserve spends |

We design the API and schema as a generic primitive layer now. Without that, OTC and the bridge would each build their own watcher and the indexer would have two scanners, two schemas, and two sets of reorg semantics. This document supersedes the original "escrow watch" framing.

## Where this lives

In `pearl-indexer`, in-process. The block scanner (step 6) reads the watch queue and writes observations directly via the repository; the HTTP surface is a thin wrapper for cross-service writes (`otc-api` registering trade escrows, the future bridge service registering deposits and reserves).

## Base / Igra parity (no indexer needed)

`watched_addresses` covers the Pearl leg only. The Base USDC leg (OTC) and the Igra `wPRL` mint/burn leg (bridge) are both state-keyed EVM contracts queryable by `eth_call` + `eth_getLogs` — the contracts are their own indexes. Those event polls live inside `otc-api` and the future bridge service, not here.

## Schema (migration `002_watched_addresses.sql`)

`escrow_watches` is replaced with three tables that model the watch → funding observation → spend relationship as 1:N. `escrow_watches` had zero rows in every environment, so the migration drops it rather than backfilling.

### `watched_addresses` — the interest declaration

A product-layer-owned row declaring "watch this Pearl address." Multiple products may watch the same address; we never deduplicate by address.

| Column | Type | Notes |
|---|---|---|
| `watch_id` | `TEXT PK` | product-assigned: OTC `trade_id`, bridge `deposit_id`, reserve label |
| `purpose` | `TEXT NOT NULL` | `otc_escrow` \| `bridge_deposit` \| `bridge_reserve` |
| `network` | `TEXT NOT NULL` | `mainnet` \| `testnet2` \| `simnet` |
| `address` | `TEXT NOT NULL` | P2TR address |
| `required_confirmations` | `INTEGER NOT NULL` | confirmations before `match_status='confirmed'` |
| `status` | `TEXT NOT NULL` | `active` \| `closed` — watch lifecycle, not deposit lifecycle |
| `metadata` | `JSONB NOT NULL DEFAULT '{}'` | purpose-specific (see below) |
| `created_at`, `updated_at` | `TIMESTAMPTZ` | |

**`metadata` conventions per purpose:**

| Purpose | Required fields |
|---|---|
| `otc_escrow` | `expected_amount_grains`, `release_template_hash`, `refund_template_hash`, `expiry_height` |
| `bridge_deposit` | `igra_recipient`, `expected_amount_min_grains`, `expected_amount_max_grains`, `expiry_height` |
| `bridge_reserve` | `custody_tier` (`hot`\|`warm`\|`cold`), `active_from_height`, `active_to_height` (nullable) |

The indexer does not validate `metadata` schemas — it just round-trips them. Products own their own metadata validation.

### `address_observations` — funding outputs

Every output the block scanner matches against a watched address. One watch → many observations (a reserve address receives many deposits; an OTC escrow normally one but modeled the same way).

| Column | Type | Notes |
|---|---|---|
| `outpoint` | `TEXT PK` | `txid:vout`, globally unique |
| `watch_id` | `TEXT NOT NULL FK → watched_addresses` | ON DELETE CASCADE |
| `block_hash` | `TEXT NOT NULL FK → pearl_blocks(hash)` | inherits detached-on-reorg semantics by join |
| `height` | `BIGINT NOT NULL` | denormalized for indexed range scans |
| `amount_grains` | `NUMERIC(40,0) NOT NULL` | |
| `confirmations` | `INTEGER NOT NULL DEFAULT 0` | refreshed by the scanner each tip move |
| `match_status` | `TEXT NOT NULL` | `pending` \| `confirmed` \| `spent` \| `detached` |
| `observed_at` | `TIMESTAMPTZ` | |

### `address_spends` — spends of observed outputs

Every spend the scanner detects of an output we previously observed. One observation can have at most one canonical spend; reorgs are handled by marking the parent observation `detached` and cascading.

| Column | Type | Notes |
|---|---|---|
| `spend_txid` | `TEXT NOT NULL` | part of PK |
| `spent_outpoint` | `TEXT NOT NULL FK → address_observations(outpoint)` | part of PK; ON DELETE CASCADE |
| `block_hash` | `TEXT NOT NULL FK → pearl_blocks(hash)` | |
| `height` | `BIGINT NOT NULL` | |
| `classification` | `TEXT NOT NULL` | free-form per purpose (see below) |
| `classification_data` | `JSONB` | matched template parameters |
| `observed_at` | `TIMESTAMPTZ` | |

**Classifications per purpose** (the indexer records the string; the product interprets it):

| Purpose | Allowed classifications |
|---|---|
| `otc_escrow` | `release`, `refund`, `unknown` |
| `bridge_deposit` | `claim`, `expiry_refund`, `unknown` |
| `bridge_reserve` | `exit_release`, `consolidation`, `ops_transfer`, `fee_change`, `unknown` |

## Step 5 scope (what this milestone ships)

Step 5 is the registration + read surface. Funding detection (step 6) and spend classification (step 7) populate `address_observations` and `address_spends` in later milestones. This milestone only writes `watched_addresses`.

### `POST /watches` — register

Idempotent registration keyed on `watch_id`. Re-registering with byte-identical params returns the existing row; differing params return `409`.

```jsonc
// Request
{
  "watch_id":                "01HZW...XYZ",
  "purpose":                 "otc_escrow",
  "network":                 "testnet2",
  "address":                 "pearl1p...",
  "required_confirmations":  6,
  "metadata": {
    "expected_amount_grains":  "12500000000",
    "release_template_hash":   "0x...",
    "refund_template_hash":    "0x...",
    "expiry_height":           5500000
  }
}

// 201 Created (or 200 OK on idempotent re-write)
{
  "watch_id":                "01HZW...XYZ",
  "purpose":                 "otc_escrow",
  "network":                 "testnet2",
  "address":                 "pearl1p...",
  "required_confirmations":  6,
  "status":                  "active",
  "metadata":                { ... },
  "observations":            [],
  "spends":                  [],
  "created_at":              "2026-05-17T09:32:11Z",
  "updated_at":              "2026-05-17T09:32:11Z"
}
```

### `GET /watches/:watch_id` — read

Returns the same shape as the POST response, with `observations` and `spends` arrays populated by joining the related tables. `404` on missing.

### `POST /watches/:watch_id/close` — lifecycle close

Sets `status='closed'`. Idempotent. The scanner stops refreshing confirmations for closed watches but historical observations/spends remain queryable. Useful for OTC trades that complete and for retired bridge reserves.

### Not over HTTP

- **List by status / purpose / address.** In-process repository call only. The block scanner reads `purpose IN (...) AND status='active'` per block.
- **Mutation of observations/spends.** Driven entirely by the scanner. No external write path.

## Repository contract

```ts
export interface WatchedAddressRepository {
  // Step 5
  register(input: RegisterWatch): Promise<WatchedAddress>;
  get(watchId: string): Promise<WatchedAddressWithHistory | null>;
  close(watchId: string): Promise<WatchedAddress>;
  listActive(purposes: WatchPurpose[]): Promise<WatchedAddress[]>;

  // Step 6 — defined now, no-op stubs until then
  recordObservation(obs: NewObservation): Promise<AddressObservation>;
  refreshConfirmations(outpoint: string, confirmations: number): Promise<void>;
  markObservationDetached(outpoint: string): Promise<void>;

  // Step 7
  recordSpend(spend: NewSpend): Promise<AddressSpend>;
  markSpendDetached(spendTxid: string, spentOutpoint: string): Promise<void>;
}
```

`PgWatchedAddressRepository` implements the contract over the three new tables. `MemoryWatchedAddressRepository` is the dev/test fallback.

## Idempotency rules

- `register` keys on `watch_id`. Identical params → 200 + existing row. Any differing param → 409.
- `close` is idempotent on `status='closed'`. Calling close on an already-closed watch is a no-op 200.
- All writes inside `withTransaction`.

## Error model

Same JSON shape as `services/otc-api/src/http.ts`:

```jsonc
{ "error": "<machine_code>", "message": "<human_readable>" }
```

- `400 bad_request` — validation
- `404 not_found` — unknown watch_id
- `409 conflict` — diff-params re-register
- `500 internal_error` — fallback

## File layout (step 5 implementation)

- `services/pearl-indexer/migrations/002_watched_addresses.sql` — ships in this PR
- `services/pearl-indexer/src/watched-address-repository.ts` — types + `PgWatchedAddressRepository` + `MemoryWatchedAddressRepository`
- `services/pearl-indexer/src/watched-address-http.ts` — HTTP handler
- `services/pearl-indexer/src/main.ts` — boots the HTTP server alongside the block poller
- `services/pearl-indexer/test/watched-address-repository.test.ts`
- `services/pearl-indexer/test/watched-address-http.test.ts`

## Cross-chain bridge exit mirror (OpenSpec 10.8.5)

The bridge's exit flow is cross-chain by definition: a wPRL burn happens on Igra, then a PRL release happens on Pearl. Joining the two tx ids requires a mirror table the indexer can both read (for reconciliation) and write to (when the spend scanner classifies a Pearl reserve spend as `exit_release`).

Migration `002_watched_addresses.sql` therefore also creates `bridge_exit_requests`:

| Column | Type | Notes |
|---|---|---|
| `igra_burn_txid`, `igra_burn_log_index` | `(TEXT, INTEGER) PK` | one tx may emit multiple burns |
| `igra_burn_block`, `igra_chain_id` | `BIGINT` | Igra chain coordinates |
| `exit_id` | `TEXT` | contract-emitted identifier the bridge service deduplicates on |
| `requested_amount_grains` | `NUMERIC(40,0)` | |
| `pearl_recipient` | `TEXT` | P2TR address the user wants PRL at |
| `status` | `TEXT` | `pending` \| `released` \| `refunded` \| `cancelled` \| `unknown` |
| `pearl_release_txid` | `TEXT NULL` | populated when the spend scanner matches |
| `pearl_release_block` | `BIGINT NULL` | |
| `released_at` | `TIMESTAMPTZ NULL` | |
| `metadata` | `JSONB` | relayer signatures, federation quorum proofs, etc. |

Three things this PR explicitly does **not** ship for the bridge mirror:

1. **The writer.** Rows are written by the future bridge service polling Igra contract events. We do not yet know the exact event shape (no Igra contract written), so designing the writer ahead of that is guesswork.
2. **A repository module / HTTP API.** The bridge service can read/write this table directly via SQL; no need to wrap it in the indexer's repository surface until both services are co-located in the same DB and need a shared abstraction.
3. **Spend scanner cross-table updates.** Step 7's spend scanner will, when it classifies a reserve spend as `exit_release`, update the matching `bridge_exit_requests` row by `pearl_recipient` + amount. That join logic is part of step 7, not step 5.

What this PR does ship: the table itself, with indexes on `status`, `pearl_recipient`, `exit_id`, and a partial index on `pearl_release_txid` for the join hot path.

## How OTC and the bridge each consume this

**OTC (9.3.5, this track):**
- On `quote.accept`, `otc-api` calls `POST /watches` with `purpose='otc_escrow'` and the template hashes in `metadata`.
- Settlement worker calls `GET /watches/:trade_id` to read `observations` (funding) and `spends` (release/refund) and decide whether to release the Base USDC leg.

**Bridge (10.8, separate track but reuses the same primitive):**
- On bridge deposit request, the bridge service calls `POST /watches` with `purpose='bridge_deposit'`, the user's Igra recipient, and amount range.
- On reserve provisioning, it calls `POST /watches` with `purpose='bridge_reserve'`, the custody tier, and height window.
- Bridge relayer queries `listActive(['bridge_deposit'])` (via direct repository call from inside the bridge service if co-located, or a small read-only endpoint if separate) for mint-decision input.
- Bridge reconciliation views (10.8.6 — confirmed reserves, pending exits, surplus/deficit) are computed by SQL joins across `watched_addresses` + `address_observations` + `address_spends`, all owned by the indexer.

The bridge does not need a new schema. It writes new `purpose` values and reads the same tables.

## Substeps (replaces OpenSpec 9.3.5)

- [ ] 9.3.5.a — Migration `002_watched_addresses.sql` (drops `escrow_watches`, adds three new tables) — ships in this design PR
- [ ] 9.3.5.b — Repository module + types + in-memory fake
- [ ] 9.3.5.c — Postgres implementation of repository
- [ ] 9.3.5.d — HTTP handler + server boot wiring into `main.ts`
- [ ] 9.3.5.e — Unit tests (repository + handler)
- [ ] 9.3.5.f — Integration smoke: register → close → read round-trip against postgres on the Hetzner box

## Not in this milestone

- Funding output detection (step 6 / 9.3.6) — populates `address_observations`.
- Spend classification (step 7 / 9.3.7) — populates `address_spends`.
- Bridge-side HTTP endpoints (10.8) — separate work item, same schema.
- Base / Igra event pollers — live in `otc-api` and bridge service, not the indexer.
- Bearer-token auth on the HTTP surface.
