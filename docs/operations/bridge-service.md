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

- Poll the Igra bridge contract events once the EVM contract interface is final.
- Persist bridge deposit requests, exit requests, approvals, and decisions.
- Wire the `bridge_exit_requests` table writer and reserve-spend classifier.
- Add HTTP/admin routes for operator approval, manual review, and public proof.
- Replace plain relayer attestations with threshold/FROST release authorization
  once the federation membership and signer custody design are final.
- Run a simnet bridge rehearsal with real Pearl txids and local Igra receipts.
