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
