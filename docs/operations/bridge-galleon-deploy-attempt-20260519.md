# Bridge Galleon Deploy Attempt - 2026-05-19

Purpose: validate the guarded `WrappedPearl` + `PearlBridge` deploy path on the
configured Igra RPC while Pearl-side testing remains on simnet.

Result: blocked before broadcast by the Galleon RPC / Kaspa wallet layer. No
contract address was created and no deployment evidence JSON was written.

Verified environment:

- configured `IGRA_RPC_URL` chain ID: `38836` / Galleon;
- deployer address: `0x537dB45aC71bf8e1f1e28530732FAeabD607778E`;
- deployer native balance before attempt: `14798377399831275721` wei.

Commands attempted:

```bash
PEARL_BRIDGE_DEPLOY_NETWORK=galleon \
PEARL_BRIDGE_DEPLOY_RUN_ID=20260519142000 \
npm --workspace @kaspacom/prl-usdc-escrow-contracts run deploy:pearl-bridge
```

Retry with higher legacy gas price:

```bash
PEARL_BRIDGE_DEPLOY_NETWORK=galleon \
PEARL_BRIDGE_DEPLOY_RUN_ID=20260519142000 \
PEARL_BRIDGE_GAS_PRICE_WEI=3000000000001 \
npm --workspace @kaspacom/prl-usdc-escrow-contracts run deploy:pearl-bridge
```

Both attempts failed before broadcast with the same class of node error:

```text
transaction is not standard: transaction has 392300 fees which is under the required amount of 510400 for normalized transient mass 5104
```

Interpretation:

- this is not a Solidity revert;
- this is not a bridge constructor/caps issue;
- the deployment transaction was rejected before it reached the chain;
- raising EVM legacy gas price did not affect the underlying Kaspa standardness
  fee reported by the RPC wallet layer.

Next fix path:

1. identify the Igra/Galleon RPC deployment parameter that controls the
   underlying Kaspa transaction fee, or use an RPC/provider that funds the
   wrapped EVM transaction with a sufficient Kaspa fee;
2. retry Galleon deployment before any Igra mainnet deployment;
3. keep Igra mainnet blocked until the same deployment path succeeds on
   Galleon or a documented replacement deployment path is proven.
