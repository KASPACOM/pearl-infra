# Settlement Worker

Worker that joins Pearl escrow state and Base USDC escrow state into final trade transitions.

## Responsibility

- Watch for trades ready to release.
- Broadcast signed Pearl release/refund transactions through our node.
- Trigger USDC escrow release/refund.
- Emit idempotent trade events.
- Pause on inconsistent chain observations.

## Safety Rule

The worker should fail closed. If Pearl and Base state disagree, the trade goes to manual review instead of broadcasting.

Release preparation is not terminal completion. A `prepare_usdc_release` decision only authorizes the USDC release side effect after PRL release confirmation; the trade is marked released only after the Base release is observed.

## Pearl Release/Refund Hooks

The Pearl escrow package exposes the settlement-worker handoff primitives:

- `createPearlEscrowUnsignedTx()` builds release/refund unsigned tx hex from an escrow package.
- `createPearlEscrowSignerRequest()` validates destination + fee cap and creates the signer policy package.
- `createPearlEscrowTxTemplateHash()` and `createPearlEscrowObservedStateHash()` provide stable audit hashes.
- `PearlSignerBoundary` persists request state before calling the signer, enforces fee caps, expected template hash, destination/output policy, allowed signer key id, pause state, and append-only audit records.
- `createPearlEscrowBroadcastAttempt()`, `markPearlEscrowBroadcastSubmitted()`, and `markPearlEscrowBroadcastFailed()` model retry state.
- `PearlRpcTransactionBroadcaster` wraps `sendrawtransaction` for the final broadcast call.

The worker must call the signer boundary before any Pearl broadcast. The boundary returns signed transaction material only; it does not broadcast. The worker then records broadcast attempts separately and reuses the same signer idempotency key for retries of the same trade/action/outpoint/template.
