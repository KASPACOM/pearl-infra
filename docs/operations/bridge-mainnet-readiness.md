# Pearl Bridge Mainnet Readiness

This is the bridge path while Pearl testnet liquidity is unavailable: prepare
the Igra-side deployment for mainnet, but keep proof/reconciliation testing on
Pearl simnet until mainnet custody is explicitly approved.

## Current Decision

- Do not wait for Pearl testnet PRL.
- Use Pearl simnet for deposit/release rehearsals and reserve-accounting proof.
- Prepare Igra mainnet deployment tooling now.
- Do not deploy to Igra mainnet until the explicit mainnet approval gates below
  are satisfied.

The currently configured `IGRA_RPC_URL` in the operator environment points to
Galleon chain `38836`, not Igra mainnet chain `38833`.

## Deployment Tooling

Use the guarded deployment script:

```bash
npm --workspace @kaspacom/prl-usdc-escrow-contracts run deploy:pearl-bridge
```

Local validation:

```bash
npm --workspace @kaspacom/prl-usdc-escrow-contracts run deploy:pearl-bridge:local
```

The script deploys:

1. `WrappedPearl`;
2. `PearlBridge`;
3. `WrappedPearl.setBridge(PearlBridge)`;
4. `PearlBridge.setRelayer(relayer, true)`;
5. `PearlBridge.setOperator(operator, true)`;
6. optional two-step ownership transfer start to `PEARL_BRIDGE_FINAL_OWNER`.

It writes deployment evidence under
`contracts/usdc-escrow/deployments/<network>-pearl-bridge-<run-id>.json`.

## Environment Contract

| Variable | Required | Notes |
| --- | --- | --- |
| `PEARL_BRIDGE_DEPLOY_NETWORK` | yes | `local`, `galleon`, or `igra-mainnet`. |
| `PEARL_BRIDGE_RPC_URL` | mainnet/galleon | Preferred RPC URL. Falls back to `IGRA_RPC_URL`. |
| `PEARL_BRIDGE_DEPLOYER_PRIVATE_KEY` | mainnet/galleon | Preferred deployer key. Falls back to `IGRA_DEPLOYER_KEY`. |
| `PEARL_BRIDGE_OWNER` | optional | Defaults to deployer for setup. Mainnet should use deployer first, then transfer. |
| `PEARL_BRIDGE_FINAL_OWNER` | mainnet | Final multisig/approved owner that must later call `acceptOwnership()`. |
| `PEARL_BRIDGE_RELAYER` | mainnet | Relayer address. Must be explicit on mainnet. |
| `PEARL_BRIDGE_OPERATOR` | mainnet | Operator address. Must be explicit and separate from relayer on mainnet. |
| `PEARL_BRIDGE_MAINNET_APPROVED` | mainnet | Must be `1`; otherwise mainnet deployment aborts. |
| `PEARL_BRIDGE_MAINNET_READY_CHECKLIST` | mainnet | Must be `1`; confirms this runbook/checklist is complete. |
| `PEARL_BRIDGE_GAS_PRICE_WEI` | optional | Legacy Igra gas price override. Defaults to `2000000000001`. Raise if Galleon/mainnet rejects a deployment for minimum fee. |
| `PEARL_BRIDGE_*_GRAINS` | optional | Pilot caps: min/max deposit, min/max exit, rolling cap, supply cap. |

Default caps are intentionally tiny for guarded pilot deployments:

- min deposit: `1` grain;
- max deposit: `100000000` grains;
- min exit: `1` grain;
- max exit: `100000000` grains;
- rolling window: `86400` seconds;
- rolling mint cap: `100000000` grains;
- pilot supply cap: `100000000` grains.

## Mainnet Abort Gates

The deployment script refuses `PEARL_BRIDGE_DEPLOY_NETWORK=igra-mainnet` unless:

- RPC chain ID is exactly `38833`;
- `PEARL_BRIDGE_MAINNET_APPROVED=1`;
- `PEARL_BRIDGE_MAINNET_READY_CHECKLIST=1`;
- `PEARL_BRIDGE_FINAL_OWNER` is set and differs from the deployer owner;
- `PEARL_BRIDGE_RELAYER` and `PEARL_BRIDGE_OPERATOR` are explicit and separate.

Operationally, mainnet remains blocked until:

- one low-cap entry and one low-cap exit pass using Pearl simnet proof and clean
  reserve reconciliation;
- the final owner/multisig address is selected;
- reserve addresses, signer policy, hot/warm/cold limits, and pause drill are
  recorded;
- a deployment evidence JSON is committed after the live run;
- ownership acceptance evidence is committed after `acceptOwnership()`.

## Simnet Test Path

Use the existing bridge rehearsal:

```bash
npm --workspace @kaspacom/bridge-service run rehearse:simnet-bridge
```

This keeps Pearl on simnet while exercising:

- real Pearl simnet deposit/release txids from the indexer;
- Igra bridge mint and exit events;
- bridge-service Igra poller mirroring;
- Pearl reserve-spend matching;
- public proof and reserve reconciliation.

Latest evidence:

- `docs/operations/bridge-simnet-rehearsal-evidence-20260519.md`
- `docs/operations/bridge-simnet-rehearsal-evidence-20260519.json`

## Live Igra Testnet Option

The configured operator RPC currently points to Galleon chain `38836`. A Galleon
deployment can be run with:

```bash
PEARL_BRIDGE_DEPLOY_NETWORK=galleon \
PEARL_BRIDGE_RELAYER=0x... \
PEARL_BRIDGE_OPERATOR=0x... \
npm --workspace @kaspacom/prl-usdc-escrow-contracts run deploy:pearl-bridge
```

This is useful for Igra log-poller testing, but it does not remove the need for
Pearl simnet proof because no Pearl testnet liquidity is available.

Current status: a Galleon deploy attempt on 2026-05-19 was rejected before
broadcast by the RPC wallet layer because the underlying Kaspa transaction fee
was below the node's standardness minimum. See
`docs/operations/bridge-galleon-deploy-attempt-20260519.md`. Igra mainnet
deployment remains blocked until Galleon deployment succeeds or the replacement
deployment path is proven.

## Do Not Do

- Do not point bridge signing or reserve release at Pearl mainnet during simnet
  rehearsal.
- Do not deploy Igra mainnet from the generic `IGRA_RPC_URL`; verify chain ID
  `38833` first.
- Do not use the deployer as relayer/operator on mainnet.
- Do not seed a `wPRL/USDC` pool until a low-cap entry and exit are proven with
  public proof and clean reserve reconciliation.
