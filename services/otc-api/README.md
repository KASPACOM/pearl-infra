# OTC API Service

Backend API for the Pearl OTC settlement desk.

## Responsibility

- Quote creation and acceptance.
- Trade lifecycle API.
- User/session boundary.
- Public proof endpoint.
- Admin/dispute API.
- Persistence for quotes, trades, events, and audit log.

## Should Not Own

- Pearl chain ingestion. Use `services/pearl-indexer`.
- Base log ingestion. Use the USDC escrow client/worker path.
- Frontend state decisions. Expose canonical state from backend events.

## Current Implementation Slice

- Framework-free TypeScript service core for quote creation, quote acceptance, trade transition, and public proof projection.
- Node HTTP routes for quote creation, quote acceptance, trade reads, proof reads, user support alerts, admin diagnostics, USDC create-trade intents, USDC term verification, side-effect records, and health checks.
- Postgres repository for quotes, trades, events, and side effects. The in-memory repository remains for API/state-machine tests and local no-DB runs.
- Pluggable Pearl escrow allocator so the real Pearl escrow service can replace mocked escrow instructions later.
- Optional Base RPC reader for verifying contract `trades(tradeKey)` terms before the frontend enables buyer deposit.
- Configured Pearl escrow allocation. Local runs default to mock addresses; set `PEARL_ESCROW_ALLOCATOR=p2tr_xpub` and `PEARL_ESCROW_XPUB=<xpub/tpub>` to derive one non-hardened P2TR child address per accepted trade.

## Persistence

Apply `migrations/001_otc_state.sql` to the OTC database, then run with:

```bash
OTC_API_DATABASE_URL=postgres://...
BASE_RPC_URL=https://...
BASE_USDC_ESCROW_CONTRACT=0x...
npm start --workspace @kaspacom/otc-api
```

If `OTC_API_DATABASE_URL` is unset, the service starts with in-memory state and logs that persistence is disabled. If `BASE_RPC_URL` is unset, USDC term verification returns unavailable and the frontend must not offer buyer deposit.

For production-like runs, set `OTC_API_REQUIRE_PRODUCTION_CONFIG=true` or
`NODE_ENV=production`. Startup then fails unless all settlement-critical
dependencies are configured:

- `OTC_API_DATABASE_URL`
- `BASE_RPC_URL`
- `BASE_USDC_ESCROW_CONTRACT`
- `PEARL_ESCROW_ALLOCATOR=p2tr_xpub`
- `PEARL_ESCROW_XPUB`
- `OTC_ADMIN_API_TOKEN`
- at least one operator alert sink:
  - `OTC_ALERT_WEBHOOK_URL`
  - or `OTC_ALERT_TELEGRAM_BOT_TOKEN` plus `OTC_ALERT_TELEGRAM_CHAT_ID`

Quote creation, quote acceptance, and side-effect writes store canonical
request hashes. Reusing the same idempotency key with a different payload is a
hard error instead of returning the original object.

Admin routes under `/otc/admin/*`, USDC `create-intent`, and side-effect writes
require `Authorization: Bearer $OTC_ADMIN_API_TOKEN` or a matching
`OTC_ADMIN_API_TOKENS` credential with the required role. User-facing
support/error reports use the narrow public
`POST /otc/trades/:tradeId/support-alerts` endpoint and cannot mark manual
review, prepare Base escrow creation, write side effects, or read admin
diagnostics. When an alert sink is configured, new support/error reports are
posted to the operator webhook and/or Telegram chat; the delivery result is
audited as a `support_alert_delivery` side effect.
