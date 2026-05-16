# OTC Web App

Frontend for the Pearl OTC settlement desk.

## Responsibility

- RFQ buy/sell PRL flow.
- Trade checkout page.
- Pearl escrow proof display.
- Arbitrum USDC escrow payment status.
- Public proof page.
- Admin/dispute views can start here, but should split once they grow.

## Dependencies

The app should consume shared contracts from:

- `@kaspacom/pearl-sdk`
- `@kaspacom/pearl-indexer`
- `@kaspacom/usdc-escrow-client`

## Status

Scaffold only. Build actual UI after the backend contracts and first end-to-end test flow are stable.
