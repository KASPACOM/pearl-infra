# PRL/USDC Escrow Contracts

Solidity contracts for the Arbitrum USDC leg of the Pearl OTC settlement desk.

## Responsibility

- Hold USDC by `tradeId`.
- Release seller proceeds and fees after Pearl release is authorized.
- Refund buyer on expiry or failed PRL release.
- Emit one event per state transition.

## Status

Skeleton only. Before production:

- Replace inline ownership/pausing with reviewed OpenZeppelin modules or equivalent.
- Add Foundry/Hardhat tests.
- Add local fork tests against Arbitrum USDC.
- Add deployment scripts and multisig ownership.
