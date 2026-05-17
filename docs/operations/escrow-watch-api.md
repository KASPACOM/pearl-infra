# Escrow Watch API (step 5 / OpenSpec 9.3.5)

The escrow watch API is the registration + read surface around the `escrow_watches` table. It is the handshake by which `otc-api` tells the Pearl indexer "watch this P2TR address for trade X", and by which the indexer's own block scanner (step 6) discovers which addresses to scan against incoming blocks.

This document defines the API shape, the status state machine, and the boundary between the Pearl (indexed) and Base (event-log) legs of an OTC trade. It does not ship code; the code lands in a follow-up PR per the spec → code → tests workflow.

## Why this lives in `pearl-indexer`, not `otc-api`

The indexer process already owns the Postgres connection that holds `escrow_watches`. Step 6's block scanner runs in the same process and needs cheap per-block reads of "all watches in `pending_funding` or `funded`" — making that an HTTP call to a different service would put a round-trip on the hot path. So:

- The repository layer (`EscrowWatchRepository`) is an in-process module the block scanner imports directly.
- The HTTP surface is a thin wrapper over the same repository, used only by cross-service callers (currently just `otc-api`).

## Base leg parity (no indexer needed)

`escrow_watches` rows model the **trade**, not just the Pearl leg. The Pearl-side fields (`address`, `funding_outpoint`, `release_txid`, `refund_txid`, `status`) are populated by the indexer. The Base-side equivalents will be populated by an `eth_getLogs` poller that lives inside `otc-api` (not the indexer) once funding/release watching is needed there — Base is a state-keyed EVM chain, so a full block-by-block indexer is unnecessary. That poller is out of scope for step 5; this doc only fixes the row shape so both legs can later share it.

## Endpoints

All endpoints are bound to the docker private network. Phase 1 has no auth; we add a shared bearer token once `otc-api` is hosted outside the indexer's network namespace.

### `POST /watches` — register

Idempotent registration. `otc-api` calls this when a quote is accepted.

```jsonc
// Request
{
  "trade_id":                "01HZW...XYZ",          // ULID, app-assigned
  "network":                 "testnet2",              // "mainnet" | "testnet2" | "simnet"
  "address":                 "pearl1p...",            // P2TR escrow address
  "expected_amount_grains":  "12500000000",           // string-encoded uint (grains)
  "required_confirmations":  6
}

// 201 Created — first registration
// 200 OK — re-registration with identical params (safe to retry)
// 409 Conflict — trade_id exists with different params
{
  "trade_id":                "01HZW...XYZ",
  "network":                 "testnet2",
  "address":                 "pearl1p...",
  "expected_amount_grains":  "12500000000",
  "required_confirmations":  6,
  "status":                  "pending_funding",
  "funding_outpoint":        null,
  "release_txid":            null,
  "refund_txid":             null,
  "created_at":              "2026-05-17T09:32:11Z",
  "updated_at":              "2026-05-17T09:32:11Z"
}
```

### `GET /watches/:trade_id` — read

```jsonc
// 200 OK — same body shape as POST response
// 404 Not Found
{ "error": "not_found", "message": "no watch for trade_id 01HZW..." }
```

### Not exposed over HTTP (step 5)

- **List by status** is an in-process repository call only. Step 6's block scanner will use it. We deliberately do not ship `GET /watches?status=...` because no external caller needs it today and exposing internal queue state widens the API surface for no win.
- **Mutation endpoints** (mark funded, record release/refund) do not exist as HTTP. Those state transitions are driven entirely by the indexer's block scanner observing chain events — never by an external caller. Tests against the repository will exercise the mutation methods directly.

## Status state machine

| Status | Set by | Meaning |
|---|---|---|
| `pending_funding` | `POST /watches` | row exists, no funding output observed |
| `funded` | step 6 scanner | funding output matched, < `required_confirmations` |
| `confirmed` | step 6 scanner | funding output reached `required_confirmations` — `otc-api` may release USDC |
| `released` | step 7 scanner | spend matched the release script template |
| `refunded` | step 7 scanner | spend matched the refund script template |
| `unknown_spend` | step 7 scanner | spend observed but no template matched — alerts |

Step 5 only writes `pending_funding`. The remaining transitions arrive with steps 6 and 7; the repository contract exposes the mutator methods now so the scanner can land without schema churn later.

## Repository contract

```ts
export interface EscrowWatchRepository {
  // Step 5 — implemented in this milestone
  register(input: RegisterEscrowWatch): Promise<EscrowWatch>;
  get(tradeId: string): Promise<EscrowWatch | null>;
  listByStatus(statuses: WatchStatus[]): Promise<EscrowWatch[]>;

  // Step 6/7 — defined now, no-op stub bodies until those milestones
  markFunded(tradeId: string, outpoint: string): Promise<EscrowWatch>;
  setConfirmations(tradeId: string, confirmations: number): Promise<EscrowWatch>;
  recordRelease(tradeId: string, txid: string): Promise<EscrowWatch>;
  recordRefund(tradeId: string, txid: string): Promise<EscrowWatch>;
  recordUnknownSpend(tradeId: string, txid: string): Promise<EscrowWatch>;
}
```

A `PgEscrowWatchRepository` implements the contract over the existing `escrow_watches` table. A `MemoryEscrowWatchRepository` provides the test/dev fallback (analogous to `MemoryBlockSink`).

## Idempotency rules

- `register` keys on `trade_id`. A re-register with byte-identical params returns the existing row (status `200`), not a duplicate or a `409`.
- A re-register with **any** differing param (network, address, amount, confirmations) returns `409`. We never silently overwrite — the caller bug is louder than a clobbered row.
- All POST writes happen inside `withTransaction` so a partial write cannot leave the row in a half-populated state.

## Error model

Same JSON shape as `services/otc-api/src/http.ts`:

```jsonc
{ "error": "<machine_code>", "message": "<human_readable>" }
```

- `400 bad_request` — schema validation failures (missing field, malformed address, non-integer amount)
- `404 not_found` — unknown trade_id on `GET /watches/:trade_id`
- `409 conflict` — re-register with differing params
- `500 internal_error` — unexpected exceptions

Address validation is a syntactic check only — we do not query `pearld` to confirm the address is reachable. The block scanner will simply never produce matches for an unreachable address; surfacing that as a registration-time failure would require a slow synchronous RPC call and we prefer a fast registration path.

## File layout

- `services/pearl-indexer/src/escrow-watch-repository.ts` — types + `PgEscrowWatchRepository` + `MemoryEscrowWatchRepository`
- `services/pearl-indexer/src/escrow-watch-http.ts` — HTTP handler (`createEscrowWatchHttpServer` mirrors `createOtcHttpServer`)
- `services/pearl-indexer/src/main.ts` — boots both the block poller and the new HTTP server on the existing process
- `services/pearl-indexer/test/escrow-watch-repository.test.ts` — repository tests with fake `PgQueryClient`
- `services/pearl-indexer/test/escrow-watch-http.test.ts` — handler tests with in-memory repository

No new tables, no schema migration. The `escrow_watches` table from `migrations/001_initial.sql` already has every column we need.

## Test plan

1. **Repository:** register inserts, register idempotent re-write returns existing row, register with different params returns conflict, get returns null on miss, listByStatus returns only matching rows, mutators flip status correctly.
2. **HTTP:** 201 on first POST, 200 on idempotent POST, 409 on differing params, 404 on missing GET, 400 on malformed body, 500 mapping for unexpected throws.
3. **Process boot:** main.ts starts the HTTP server alongside the block poller; both shut down cleanly on SIGTERM.

## Substeps (replaces OpenSpec 9.3.5)

- [ ] 9.3.5.a — Repository module + types + in-memory fake
- [ ] 9.3.5.b — Postgres implementation of repository
- [ ] 9.3.5.c — HTTP handler + server boot wiring into `main.ts`
- [ ] 9.3.5.d — Unit tests (repository + handler)
- [ ] 9.3.5.e — Integration smoke: register → get round-trip against a real postgres on the Hetzner box

## Not in this milestone

- Funding output detection (step 6 / 9.3.6).
- Spend classification (step 7 / 9.3.7).
- Base-side `eth_getLogs` poller for USDC events (lives in `otc-api`, separate work item).
- Bearer-token auth on the HTTP surface.
- A public proof endpoint — that consumes the watch row but lives in `otc-api`, not the indexer.
