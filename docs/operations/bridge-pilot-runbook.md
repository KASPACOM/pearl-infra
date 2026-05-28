# Pearl Bridge Pilot Runbook

This runbook is for the low-cap federated pilot only. It does not authorize a
public `wPRL/USDC` pool or mainnet custody.

## Normal Pilot Loop

1. Register bridge deposit and reserve watches in the Pearl indexer.
2. Mirror Igra `PearlBridge` events into bridge state.
3. Build a reconciliation snapshot from Pearl watches, mirrored exits, and
   current minted supply.
4. Require clean reconciliation, finality, relayer quorum, and manual operator
   approval before preparing any mint or Pearl release.
5. Publish public proof fields for deposits, exits, reserves, cap usage, event
   hashes, and quorum counts.

## Pause Conditions

Pause bridge entry and exit processing when any of these are true:

- reserve deficit;
- unknown reserve spend;
- duplicate Pearl release txid;
- stale Pearl indexer watches;
- relayer quorum hash mismatch;
- cap near limit without a recorded cap-raise approval;
- operator cannot prove the Pearl release tx matches the Igra exit.

## Incident Actions

| Incident | Action |
|---|---|
| Stuck mint | Keep entry paused for that deposit, inspect Pearl outpoint, event hash, and relayer attestations, then either approve replay or reject. |
| Stuck exit | Keep exit processing paused for that exit, compare Igra burn event with reserve availability and Pearl recipient, then approve release or refund. |
| Release tx mismatch | Do not process another exit with the same txid. Treat as critical until reserve spend classification and operator note agree. |
| Reserve deficit | Pause minting and exit processing, publish proof snapshot, reconcile reserve addresses, and do not resume until surplus is non-negative. |
| Unknown reserve spend | Pause exits, classify the spend, and only resume after the spend is tied to an approved release, consolidation, ops transfer, or explicit loss record. |

## Before Pool Creation

- One low-cap entry must complete with public proof.
- One low-cap exit must complete with public proof.
- Reserve reconciliation must show no blockers.
- Initial liquidity source, LP ownership, max bridge exposure, withdrawal
  authority, and emergency liquidity removal must be approved in writing.
