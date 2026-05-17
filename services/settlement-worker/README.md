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

## Pearl Release/Refund Hooks

The Pearl escrow package exposes the settlement-worker handoff primitives:

- `createPearlEscrowUnsignedTx()` builds release/refund unsigned tx hex from an escrow package.
- `createPearlEscrowSignerRequest()` validates destination + fee cap and creates the signer policy package.
- `createPearlEscrowTxTemplateHash()` and `createPearlEscrowObservedStateHash()` provide stable audit hashes.
- `createPearlEscrowBroadcastAttempt()`, `markPearlEscrowBroadcastSubmitted()`, and `markPearlEscrowBroadcastFailed()` model retry state.
- `PearlRpcTransactionBroadcaster` wraps `sendrawtransaction` for the final broadcast call.

The worker must persist the signer request idempotency key before requesting a signature and reuse the same key for retries of the same trade/action/outpoint/template.
