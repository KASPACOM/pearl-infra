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
- In-memory repository for API/state-machine tests.
- Pluggable Pearl escrow allocator so the real Pearl escrow service can replace mocked escrow instructions later.

The next step is adding HTTP routes around this core and replacing in-memory persistence with the shared database layer.
