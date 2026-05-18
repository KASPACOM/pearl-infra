# Pearl Bridge Service

This service owns the non-EVM side of the PRL -> Igra wPRL bridge. The Igra
contracts emit the canonical mint/exit events, but the bridge service is the
operator boundary that registers Pearl watches, reconciles Pearl reserves, and
prepares manual-review decisions before any mint or Pearl release is signed.

## Current Package

`services/bridge-service` exports pure, testable primitives:

- `buildBridgeDepositWatch` and `buildBridgeReserveWatch` create the shared
  Pearl indexer `/watches` payloads for `bridge_deposit` and `bridge_reserve`.
- `HttpPearlBridgeIndexerClient` posts those watches and reads typed watch
  histories from the Pearl indexer.
- `createBridgeReconciliationSnapshot` joins deposit watches, reserve watches,
  exit requests, minted supply, stale watches, unknown reserve spends, and
  unsafe deposit observations into one reserve-health snapshot.
- `decideDepositMint` and `decideExitRelease` enforce manual approval, pilot
  caps, rolling caps, reserve availability, and clean reconciliation before
  returning a prepare action.
- `createBridgePublicProof` projects public deposit, exit, and reserve-backing
  proof data without exposing custody internals.

## Invariants

- Deposit mints never prepare from detached, late, underpaid, duplicate, spent,
  or out-of-cap Pearl observations.
- Exit releases never prepare while reconciliation has reserve deficits,
  unknown reserve spends, stale Pearl watches, or unsafe deposit observations.
- The service returns prepare decisions only. Signing and broadcasting remain
  separate boundaries.
- Public proofs include enough state for users to see deposit status, exit
  status, and reserve backing, but not private operator notes or credentials.

## Still Needed

- Poll the Igra bridge contract events once the EVM contract interface is final.
- Persist bridge deposit requests, exit requests, approvals, and decisions.
- Wire the `bridge_exit_requests` table writer and reserve-spend classifier.
- Add HTTP/admin routes for operator approval, manual review, and public proof.
- Run a simnet bridge rehearsal with real Pearl txids and local Igra receipts.
