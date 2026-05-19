# Pearl Bridge Service

This service owns the non-EVM side of the PRL -> Igra wPRL bridge. The Igra
contracts emit the canonical mint/exit events, but the bridge service is the
operator boundary that registers Pearl watches, reconciles Pearl reserves, and
prepares manual-review decisions before any mint or Pearl release is signed.

## Current Package

`services/bridge-service` exports testable primitives and live adapters:

- `buildBridgeDepositWatch` and `buildBridgeReserveWatch` create the shared
  Pearl indexer `/watches` payloads for `bridge_deposit` and `bridge_reserve`.
- `HttpPearlBridgeIndexerClient` posts those watches and reads typed watch
  histories from the Pearl indexer.
- `createBridgeReconciliationSnapshot` joins deposit watches, reserve watches,
  exit requests, minted supply, stale watches, unknown reserve spends, and
  unsafe deposit observations into one reserve-health snapshot.
- `createDepositBridgeEvent`, `createExitBridgeEvent`, and
  `evaluateBridgeAttestationQuorum` create deterministic KAT-style event IDs /
  event hashes and require distinct authorized relayer attestations before any
  mint or release can be prepared.
- `decideDepositMint` and `decideExitRelease` enforce manual approval, pilot
  caps, rolling caps, reserve availability, relayer quorum, finality, and clean
  reconciliation before returning a prepare action.
- `createBridgePublicProof` projects public deposit, exit, and reserve-backing
  proof data without exposing custody internals. Public proof rows include
  canonical event IDs, event hashes, and relayer attestation counts when those
  fields are present in bridge metadata.
- `InMemoryBridgeStateRepository` and `JsonFileBridgeStateRepository` persist
  reconciliation snapshots, mirrored Igra events, exit rows, and admin decisions
  idempotently for pilot operation and local rehearsals.
- `mirrorIgraBridgeEvent`, `bridgeExitFromIgraEvent`, and
  `applyExitLifecycleEvent` normalize `PearlBridge` logs into durable bridge
  state.
- `IgraBridgeEventPoller` and `IgraJsonRpcClient` read `PearlBridge` logs from
  a real Igra RPC endpoint, decode contract events, persist only newly observed
  events, mirror exits, and advance a checkpointed block cursor.
- `PgBridgeExitRequestRepository` writes mirrored Igra exits and matched Pearl
  releases into the shared Postgres `bridge_exit_requests` table.
- `matchReserveSpendToExit` matches Pearl reserve spends to pending exits by
  amount and recipient, and routes mismatches, duplicate release txids, or
  unknown spends to manual review.
- `applyReserveSpendMatchesToExits` applies exact Pearl reserve-spend matches
  to exit rows and returns manual-review blockers for unknown or mismatched
  spends.
- `createBridgeHttpServer` exposes read-only proof/status routes and
  bearer-gated admin decision routes for pilot operators.
- `evaluateBridgePilotAlerts` emits reserve-deficit, stale-watch,
  unknown-spend, quorum-failure, and cap-near-limit alerts from the current
  reconciliation state.

## Invariants

- Deposit mints never prepare from detached, late, underpaid, duplicate, spent,
  or out-of-cap Pearl observations.
- Deposit mints never prepare until the Pearl outpoint has met the configured
  finality threshold and enough independent relayers attest to the same
  canonical event hash.
- Exit releases never prepare while reconciliation has reserve deficits,
  unknown reserve spends, stale Pearl watches, or unsafe deposit observations.
- Exit releases never prepare until independent relayers attest to the same
  canonical Igra burn/exit event hash and the operator records a manual pilot
  approval.
- The service returns prepare decisions only. Signing and broadcasting remain
  separate boundaries.
- Public proofs include enough state for users to see deposit status, exit
  status, reserve backing, event hashes, and quorum counts, but not private
  operator notes or credentials.
- Igra event mirrors are idempotent by `(chainId, txHash, logIndex)`.
- Admin decisions are idempotent by explicit idempotency key or a stable hash of
  the decision fields.
- A Pearl release txid that has already been used is a hard blocker for any
  second reserve-spend match.

## KAT-Aligned Controls

The pilot bridge remains custodial/federated, but the service now follows the
same control shape as KAT-style bridge designs:

- canonical deposit event: Pearl network + txid + vout define `eventId`; amount,
  recipient, and watch metadata define `eventHash`;
- canonical exit event: Igra chain + burn tx + log index + exit id define
  `eventId`; amount, bridge address, and Pearl recipient define `eventHash`;
- all valid relayer attestations must be from the configured relayer set and
  must agree on the same `eventId` and `eventHash`;
- duplicate relayer attestations do not increase quorum;
- mismatched hashes, mismatched event IDs, unknown relayers, duplicate relayer
  entries in policy, and impossible quorum policies fail closed to manual
  review;
- insufficient finality keeps the decision in `wait`, even if enough relayers
  have signed early.

The current implementation validates attestation metadata and decision gates.
It does not implement threshold/FROST signing; that remains a later signing
boundary after the pilot proves reserve accounting and event mirroring.

## Still Needed

- Add frontend proof pages after the bridge API shape is stable.
- Select live reserve addresses, signer policy, and hot/warm/cold cap limits,
  then run the emergency pause drill.
- Replace plain relayer attestations with threshold/FROST release authorization
  once the federation membership and signer custody design are final.
- Run a simnet bridge rehearsal with real Pearl txids and local Igra receipts.
