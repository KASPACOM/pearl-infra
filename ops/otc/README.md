# Pearl OTC Ops Contracts

This folder contains non-secret deployment environment examples for the OTC
stack. Copy values into the deployment system or external-secret mappings; do
not use these files as live `.env` files without replacing placeholders.

- `.env.testnet2-base-sepolia.example` — production-like testnet evidence
  environment.
- `.env.simnet.example` — local/simnet escrow rehearsal environment.

Canonical secret names and deployment gates are documented in
[`docs/operations/otc-deployment-env-contract.md`](../../docs/operations/otc-deployment-env-contract.md).
