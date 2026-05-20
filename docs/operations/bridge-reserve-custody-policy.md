# Pearl Bridge Reserve Custody Policy

Status: pilot policy, not mainnet approval.

This policy keeps the Pearl bridge reserve path usable for a low-cap pilot while
Galleon is unavailable. It does not authorize broad mainnet liquidity or a
`wPRL/USDC` pool.

## Current Proof

- Fresh writable Pearl simnet reserve proof:
  `docs/operations/pearl-multisig-funded-simnet-evidence-20260520.md`
- Bridge rehearsal using that proof:
  `docs/operations/bridge-simnet-rehearsal-evidence-20260520.md`
- Reserve funding outpoint:
  `f1a315b9fb9d3a220e5ec097bfb3e8633f458fb256fe42e4f6ad063d9825a02e:2`
- Reserve release txid:
  `8dfcc3c78c839fe9954d553bb9b7ffd76dfb8471d61a5a7b7d14747d536c517a`
- Reserve release classification: `exit_release`
- Bridge-service spend match: `matched_exit_release`
- Reserve reconciliation blockers: none

## Pilot Custody Shape

For the first low-cap pilot, use one dedicated Pearl reserve address per reserve
tier. The hot tier is the only tier allowed to release automatically after
bridge-service approval.

| Tier | Purpose | Release policy | Cap policy |
| --- | --- | --- | --- |
| Hot | Low-cap pilot entry/exit tests | 2-of-3 P2TR script-path reserve spend | Must stay at or below the approved pilot cap. |
| Warm | Manual replenishment or withdrawal staging | 2-of-3 or stronger multisig/threshold policy | No automatic release. |
| Cold | Long-term custody | Approved multisig/threshold custody only | No bridge-service release path. |

The simnet proof currently validates the hot-tier shape only: a 2-of-3 P2TR
script-path reserve spend with two reserve signers required for release.

## Required Live Fields

Before enabling any mainnet release path, record these values in a reviewed
deployment note:

- Pearl reserve address for each active tier;
- signer identities and custody owner for each signer slot;
- final EVM bridge owner;
- bridge relayer address;
- bridge operator address;
- hot-tier max reserve grains;
- per-exit max grains;
- rolling-window mint cap;
- pilot supply cap;
- emergency pause owner and backup;
- explicit decision that Pearl testnet2 is skipped because no usable liquidity
  exists, and that the path is simnet proof followed by approved low-cap mainnet.

## Authorization Boundary

`exit_release` is only a Pearl scanner shape signal. A reserve spend can count
as authorized only when all of these are true:

- the Pearl indexer classifies the reserve spend as `exit_release`;
- classification data contains `amount_grains` and `pearl_recipient`;
- bridge-service matches the spend to exactly one mirrored exit by amount and
  recipient;
- the release txid is unique and matches the processed Igra exit;
- reserve reconciliation has no blockers;
- cap checks pass;
- relayer quorum is approved;
- a manual operator approval exists.

## Emergency Pause Drill

The next live test after Galleon/Igra deployment returns is a low-cap
pause/unpause drill:

1. Deploy `WrappedPearl` and `PearlBridge` on the available Igra testnet path.
2. Confirm relayer and operator are separate addresses.
3. Pause entry, exit request, and exit processing.
4. Verify mint and exit prepare actions fail closed while paused.
5. Unpause only the required path for one low-cap entry/exit.
6. Record transaction hashes and the final public proof.

## Open Decisions

- Final live reserve addresses are not selected yet.
- Final signer identities are not selected yet.
- Hot/warm/cold cap values are not approved yet.
- Emergency pause authority is not assigned yet.
- Post-pilot federation or FROST-style release authorization remains future work.
