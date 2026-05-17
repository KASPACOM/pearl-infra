# PRL/USDC Escrow Contracts

Solidity contracts for the Base USDC leg of the Pearl OTC settlement desk.

## Responsibility

- Hold USDC by `tradeId`.
- Release seller proceeds and fees after Pearl release is authorized.
- Refund buyer on expiry or failed PRL release.
- Emit one event per state transition.

## Status

Foundry setup exists for local contract tests and Base Sepolia deployment dry runs.
Base mainnet deployment is intentionally not configured yet.
The Base Sepolia testnet escrow deployment is recorded in `deployments/base-sepolia.json`.

## Implementation

- `PrlUsdcEscrow` has one immutable `usdcToken` set at deployment.
- Ownership, pausing, and ERC-20 transfers use OpenZeppelin `Ownable2Step`, `Pausable`, and `SafeERC20`.
- `createTrade`, `release`, `pause`, and `unpause` are owner-only.
- `renounceOwnership` is disabled so custody/admin authority cannot be accidentally burned.
- `deposit` is buyer-only.
- `refund` is owner-only before expiry, or buyer-only after expiry.
- `cancelExpired` is permissionless cleanup for created-but-undeposited expired trades.
- Emergency pause blocks new creates, deposits, and releases, but does not block refunds or expired cleanup.

## Commands

From the repository root:

```bash
npm test --workspace @kaspacom/prl-usdc-escrow-contracts
```

From this package:

```bash
npm test
npm run build
```

The package script uses `scripts/forge.sh`, which resolves `FORGE_BIN`, `forge` on `PATH`, or the standard Foundry install paths.

## Base Sepolia Deployment

The deploy script hardcodes native Base Sepolia USDC:

```text
0x036CbD53842c5426634e7929541eC2318f3dCF7e
```

Current testnet deployment:

| Field | Value |
| --- | --- |
| Network | Base Sepolia |
| Chain ID | `84532` |
| Contract | `0x7edf75ceB2441d80aBC6599CeB4E62Eeb23BB2a9` |
| Deploy tx | `0x450b48091ea67a46de25d3d40ab394e621011f7c099f01237052797eb730a981` |
| Owner | `0x35C76bF5A701A30629d9706F4c8f77a4a0cA5978` |
| Pending owner | `0x0000000000000000000000000000000000000000` |
| Fee recipient | `0x537dB45aC71bf8e1f1e28530732FAeabD607778E` |
| Native USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Explorer | `https://sepolia.basescan.org/address/0x7edf75ceB2441d80aBC6599CeB4E62Eeb23BB2a9` |

Base Sepolia native-USDC lifecycle evidence is recorded in `deployments/base-sepolia-native-run.json`.
That run used the original Base Sepolia escrow above with native Base Sepolia USDC, then executed:

1. `createTrade`;
2. native USDC approval;
3. buyer deposit;
4. owner release;
5. `transferOwnership` to the requested testnet owner.

The native-USDC run ended with trade status `Released`, seller receiving `10000000`, fee recipient receiving `1000000`, escrow balance `0`, `owner()` set to `0x35C76bF5A701A30629d9706F4c8f77a4a0cA5978`, and `pendingOwner()` cleared to zero.

Secondary mock-token lifecycle evidence is recorded in `deployments/base-sepolia-mock-run.json`.
That run deployed a mock USDC-style ERC-20 for isolated contract lifecycle proof, then executed:

1. mock token deploy;
2. mock-token escrow deploy;
3. mock token mint;
4. `createTrade`;
5. buyer approval;
6. buyer deposit;
7. owner release;
8. `transferOwnership` to the requested testnet owner.

The mock run ended with trade status `Released`, seller balance `100000000`, fee recipient balance `1000000`, escrow balance `0`, and `pendingOwner()` set to `0x35C76bF5A701A30629d9706F4c8f77a4a0cA5978`.

Dry-run / simulate with:

```bash
BASE_SEPOLIA_RPC_URL=...
USDC_ESCROW_FEE_RECIPIENT=0x...
BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY=...
npm run test:base-sepolia-dry-run
npm run test:base-sepolia-native-run
```

Private keys and RPC URLs must stay in the local environment only.

## Mainnet Gate

No Base mainnet deployment script is included. Mainnet stays disabled until:

- contract review is complete;
- ownership is transferred to the approved multisig;
- Base Sepolia deployment evidence is recorded;
- Sione explicitly approves the mainnet run.

## Ownership And Role Decision

Current decision:

- Keep the deployed MVP contract on `Ownable2Step` instead of adding role
  separation before the first testnet settlement runs.
- Treat the owner as the settlement coordinator for `createTrade`, `release`,
  early `refund`, `pause`, and `unpause`.
- Require the owner to be an approved multisig or approved testnet owner before
  production-like usage.
- Revisit role separation before Base mainnet if automation needs narrower
  permissions than a multisig-owned coordinator can safely provide.

Role separation candidates, if needed later:

- `TRADE_CREATOR` for opening USDC escrow slots after quote acceptance.
- `RELEASER` for releasing seller proceeds after Pearl release proof.
- `REFUNDER` for pre-expiry refunds on failed PRL release.
- `PAUSER` for emergency pause.
- `ADMIN` or multisig owner for role management, upgrades if any, and fee
  recipient changes if introduced.

Production ownership checklist:

- Record intended owner/multisig address before deployment.
- Verify `owner()` immediately after deployment.
- If the deployer is not the final owner, call `transferOwnership(multisig)`.
- Record `pendingOwner()` after transfer.
- Have the multisig call `acceptOwnership()`.
- Record acceptance transaction hash and final `owner()`.
- Confirm `renounceOwnership()` still reverts.
- Confirm `feeRecipient` and native USDC address.
- Do not enable mainnet settlement until the ownership evidence is committed to
  the repo and linked in the release checklist.

Required deployment evidence:

- deployed contract address;
- deployment transaction hash;
- `owner()` and `pendingOwner()` after deployment;
- two-step ownership acceptance transaction for the approved multisig/owner;
- configured `feeRecipient`;
- configured native USDC token address;
- block explorer verification link.
