# Pearl Igra Bridge Product Contract

## Scope

The bridge MVP wraps Pearl L1 PRL into an ERC-20 asset on Igra so users can trade `wPRL/USDC` while the OTC desk remains the manual safety path for larger or stuck settlements.

This document defines the token-level controls for OpenSpec `10.5`. The bridge contract interface, events, replay protection, and tests are implemented by `WrappedPearl` and `PearlBridge` under `contracts/usdc-escrow/src` for `10.6` and `10.7`.

## Wrapped Token

| Field | Value |
|---|---|
| ERC-20 name | `Wrapped Pearl` |
| ERC-20 symbol | `wPRL` |
| ERC-20 decimals | `8` |
| Unit mapping | `1 wPRL base unit = 1 Pearl grain` |
| Human conversion | `1 PRL = 100,000,000 wPRL base units` |
| Network | Igra EVM chain |

Use 8 decimals to match Pearl's grain precision exactly. The bridge must reject amounts with precision below one Pearl grain and must never mint dust that cannot be redeemed on Pearl L1.

## Conversion Rules

Entry:

1. User requests a deposit address with Igra recipient and amount bounds.
2. Pearl indexer observes a PRL output to the watched deposit address.
3. Federation/relayer verifies confirmations, deadline, amount, and uniqueness.
4. Bridge mints exactly `amount_grains` `wPRL` base units to the Igra recipient.

Exit:

1. User submits an exit request on Igra by burning or locking `amount_grains` `wPRL` base units.
2. Bridge emits a unique `exit_id`.
3. Operator/federation verifies the event, rate limits, reserve availability, and recipient Pearl address.
4. Pearl reserve releases exactly `amount_grains` grains minus any explicitly configured exit fee.
5. Bridge service records the Pearl release txid against the `exit_id`.

Fees must be explicit bridge fields, not hidden in token precision. If a fee is charged, the proof page must show gross amount, fee amount, and net Pearl release amount.

## Mint Authority

`WrappedPearl` should not have human EOA minters.

Required control split:

- token admin: approved multisig or DAO-controlled timelock;
- minter: bridge contract only;
- bridge owner/admin: approved multisig during pilot;
- relayers/federation: may submit claims, but cannot mint without bridge validation;
- deployer: must renounce or transfer admin after deployment evidence is recorded.

Recommended implementation:

- `WrappedPearl` uses `Ownable2Step` with one explicit `bridge` minter/burner address. This keeps the pilot control surface smaller than a general role graph while preserving transferable admin ownership for the later multisig handoff.
- `WrappedPearl` does not expose public mint or owner-mint functions.
- `WrappedPearl` exposes bridge-only burn support so `PearlBridge.requestExit` can atomically burn user `wPRL` and record the exit request in one transaction.
- Token transfer pause should be avoided for the pool phase unless the pilot explicitly accepts the risk of freezing secondary-market users. Prefer pausing bridge entry/exit in the bridge contract.

## Igra Contract Interface And Events

`PearlBridge` deliberately does not verify Pearl L1 consensus. It accepts only federation/relayer-submitted deposit claims and operator-submitted exit release records after off-chain Pearl indexer/federation checks.

Entry / mint:

```solidity
function claimDeposit(bytes32 pearlTxid, uint32 vout, address recipient, uint256 amountGrains)
  external returns (bytes32 claimId);
```

- Replay key: `claimId = keccak256(abi.encodePacked(pearlTxid, vout))`.
- Reused claims are rejected before mint.
- Amount must satisfy min/max deposit, rolling-window mint cap, and pilot supply cap.
- Mint amount is exactly `amountGrains`; no fees are hidden in token precision.

Exit:

```solidity
function requestExit(string calldata pearlRecipient, uint256 amountGrains)
  external returns (bytes32 exitId);
function processExit(bytes32 exitId, bytes32 pearlReleaseTxid) external;
function refundExit(bytes32 exitId) external;
```

- `requestExit` burns `amountGrains` from the requester before storing the exit.
- `processExit` is operator-only and idempotent for the same release txid on the same exit.
- A conflicting release txid for an already processed exit is rejected.
- A Pearl release txid can only be recorded once globally, which catches duplicate operator bookkeeping across different exits.
- `refundExit` is operator-only and mints the burned amount back to the requester when Pearl release cannot happen.
- Cap reductions must keep `totalSupply + pendingExitGrains <= pilotSupplyCapGrains`, so already-minted supply and refundable exits cannot be configured above the pilot cap.

Events:

- `DepositClaimed(claimId, pearlTxid, vout, recipient, amountGrains)`
- `ExitRequested(exitId, requester, pearlRecipient, amountGrains)`
- `ExitProcessed(exitId, pearlReleaseTxid, operator)`
- `ExitRefunded(exitId, requester, amountGrains, operator)`
- `CapsUpdated(caps)`
- `RelayerUpdated(relayer, enabled)`
- `OperatorUpdated(operator, enabled)`
- `EntryPaused(actor, paused)`
- `ExitRequestPaused(actor, paused)`
- `ExitProcessingPaused(actor, paused)`

## Supply Controls

The bridge contract should enforce a pilot supply cap denominated in Pearl grains. Raising the cap requires multisig action and a recorded reserve reconciliation snapshot.

Supply invariant:

```text
minted_wprl_base_units <= confirmed_reserve_grains - pending_exit_grains + locked_exit_grains
```

The EVM contract cannot independently verify Pearl L1 reserves, so the bridge service and operator runbook must reconcile:

- confirmed Pearl reserve observations;
- minted `wPRL` total supply;
- pending Igra exits;
- Pearl reserve spends;
- unknown reserve spends;
- surplus/deficit by reserve tier.

If reserve deficit, unknown reserve spend, stale indexer, or replay ambiguity is detected, pause bridge minting and exits until reconciliation is clean.

## Ownership Checklist

Before any non-toy pilot:

- token admin is an approved multisig or timelock, not deployer EOA;
- bridge owner/admin is an approved multisig;
- bridge contract is the only token minter;
- pilot max supply cap is set and recorded;
- min deposit, max deposit, max exit, and rolling-window caps are configured;
- emergency pause path is tested;
- replay protection is tested for deposit claims and exit processing;
- public proof fields cover deposit txid/outpoint, mint tx, exit event, release tx, reserves, and cap usage.
- bridge service decisions require canonical event IDs / event hashes, distinct
  authorized relayer attestations, finality thresholds, and manual operator
  approval before mint or release preparation.

## KAT-Style Phase-2 Direction

The first `PearlBridge` contract is acceptable only for a low-cap custodial
pilot. The next bridge phase should converge toward the KAT control model:

- independent relayers observe Pearl deposits and Igra exits separately;
- every mint/release decision is keyed by a canonical event ID and event hash;
- relayers must reach quorum over exactly the same event hash before the bridge
  service prepares an action;
- Pearl-side releases should move from operator-only recording to
  threshold/FROST-style authorization once signer custody is finalized;
- public proof must show deposit, mint, exit, release, reserves, cap usage,
  event hashes, finality, and relayer quorum counts;
- replay rules must be global for both Pearl deposit outpoints and Pearl
  release txids.

Before a `wPRL/USDC` pool:

- run at least one low-cap entry and one low-cap exit on Igra;
- reconcile total minted supply against Pearl reserves;
- document initial liquidity source, max bridge exposure, and operator ownership;
- get explicit approval for the pool's initial liquidity and cap.
