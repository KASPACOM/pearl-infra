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

## Implementation

- `PrlUsdcEscrow` has one immutable `usdcToken` set at deployment.
- Ownership, pausing, and ERC-20 transfers use OpenZeppelin `Ownable`, `Pausable`, and `SafeERC20`.
- `createTrade`, `release`, `pause`, and `unpause` are owner-only.
- `deposit` is buyer-only.
- `refund` is owner-only before expiry, or buyer-only after expiry.
- `cancelExpired` is permissionless cleanup for created-but-undeposited expired trades.

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

Dry-run / simulate with:

```bash
BASE_SEPOLIA_RPC_URL=...
USDC_ESCROW_FEE_RECIPIENT=0x...
BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY=...
npm run test:base-sepolia-dry-run
```

Private keys and RPC URLs must stay in the local environment only.

## Mainnet Gate

No Base mainnet deployment script is included. Mainnet stays disabled until:

- contract review is complete;
- ownership is transferred to the approved multisig;
- Base Sepolia deployment evidence is recorded;
- Sione explicitly approves the mainnet run.
