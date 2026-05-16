# Pearl OTC Settlement Desk

## Goal

Build a checkout-grade OTC venue for PRL/USDC that is smoother and safer than the current Pearl OTC marketplace by combining:

- Pearl Taproot escrow and partial-signed recovery transactions.
- Base USDC escrow instead of direct buyer-to-seller payment.
- A KaspaCom trade coordinator that never needs unilateral control of PRL.
- A Pearl indexer that makes trade state independently verifiable.

The first product should feel like a settlement desk/RFQ checkout, not a generic exchange. The order book can come later once settlement is proven.

## Why This Beats Existing Pearl OTC

Existing Pearl OTC already appears to use per-trade Pearl escrow. The product gap is the full settlement experience:

- USDC is observed as a direct payment to the seller, not escrowed as a controlled trade leg.
- Trade state is harder to prove end-to-end because PRL and USDC settlement are coordinated off-chain.
- Disputes and accounting depend on the marketplace worker's interpretation of external payment events.
- The flow still feels like an OTC board instead of a fast checkout.

KaspaCom should differentiate on two-sided escrow, proof, speed, and liquidity:

- Buyer sees PRL escrow proof before paying.
- Buyer pays USDC into a Base escrow contract, not straight to the seller.
- Seller pre-signs Pearl release/refund paths once, then can leave.
- Indexer-backed status page shows both legs, confirmations, release/refund txs, and audit events.
- RFQ/liquidity-provider mode gives users a firm "buy/sell now" price without hunting offers.

## Product Modes

### Mode 1: RFQ Settlement Desk (MVP)

User asks to buy or sell PRL. The desk returns a firm quote for a fixed window.

Best for:

- Faster UX.
- KaspaCom-controlled liquidity and spreads.
- Smaller trades.
- Manual risk controls during early mainnet pilots.

### Mode 2: Maker Offers

Verified sellers post sell offers and optionally pre-fund Pearl escrow. Buyers take an offer through the same checkout state machine.

Best for:

- Public marketplace liquidity.
- Lower operational load once escrow is proven.

### Mode 3: Full P2P Escrow

Buyer and seller coordinate directly, with KaspaCom as arbiter/coordinator.

Best for:

- Larger tickets.
- Dispute-resolution value.
- Non-custodial positioning.

MVP should implement Mode 1 first and keep the state machine compatible with Modes 2 and 3.

## Core Components

### Frontend Apps

1. **Trade checkout**
   - Shows quote, expiry, Pearl escrow proof, USDC payment instructions, confirmation state, final release/refund state.
   - Supports buy PRL and sell PRL.

2. **Seller/liquidity dashboard**
   - Shows offers, escrow funding status, pre-signed recovery packages, settlement history, fee totals.

3. **Public proof page**
   - Read-only page per trade with Pearl outpoint, USDC escrow tx, release/refund tx, confirmations, and status.

4. **Admin/dispute console**
   - Reviews stuck trades, confirms external evidence, triggers arbiter signing path, pauses risky flows.

### Backend Services

1. **Trade API**
   - Owns authenticated user actions.
   - Creates quotes, trades, offers, and checkout sessions.
   - Exposes read-only public trade proof data.

2. **Quote engine**
   - Computes firm quotes from configured liquidity, spread, fee policy, and risk limits.
   - Locks quote terms for a short TTL.
   - Rejects stale or out-of-range fills.

3. **Trade state machine**
   - Canonical trade lifecycle.
   - Drives transitions from quote to funded to paid to released/refunded.
   - Makes every external side effect idempotent.

4. **Pearl indexer**
   - Scans Pearl blocks/mempool from KaspaCom-owned `pearld` for MVP and production escrow state.
   - Uses public Blockbook only as a fallback/cross-check source.
   - Tracks outputs, spends, addresses, confirmations, reorgs, and OP_RETURN receipts if used.
   - Provides escrow-specific views by outpoint and script/address.

5. **Pearl escrow service**
   - Builds Taproot escrow addresses and PSBT/transaction templates.
   - Coordinates partial signatures.
   - Stores signed release/refund packages.
   - Broadcasts release/refund transactions when the state machine authorizes them.

6. **Base USDC escrow service**
   - Deploys or calls a minimal USDC escrow contract.
   - Tracks deposits, releases, refunds, and fee collection.
   - Emits events keyed by `tradeId`.

7. **Base indexer**
   - Watches USDC escrow contract events.
   - Confirms deposit finality.
   - Feeds the trade state machine.

8. **Settlement worker**
   - Joins Pearl and Base state.
   - Broadcasts PRL release after USDC escrow is confirmed.
   - Releases/refunds USDC after PRL state is confirmed.

9. **Notification service**
   - Sends email/Telegram/webhook updates for payment needed, funded, paid, released, expired, dispute, refund-ready.

10. **Risk and limits service**
   - Enforces min/max trade size, daily limits, address denylist, stuck-trade pauses, manual-review thresholds.

11. **Audit ledger**
   - Append-only record of quotes, signatures, deposits, releases, refunds, admin actions, and indexer observations.

### Packages

1. `packages/pearl-rpc`
   - Typed `pearld` JSON-RPC client.
   - Blockbook fallback client for cross-checking.
   - Network config.

2. `packages/pearl-sdk`
   - Address validation.
   - Amount parsing/formatting.
   - Payment request schema.
   - Transaction lifecycle types.

3. `packages/pearl-script`
   - Pearl Taproot network wrapper around Bitcoin Taproot tooling.
   - Tap-tree/address construction.
   - CLTV/CSV encoding helpers.
   - Script fixtures verified against simnet.

4. `packages/pearl-escrow`
   - Escrow templates.
   - Release/refund transaction builders.
   - PSBT/partial-signing coordinator types.
   - Mainnet-disabled until simnet verification passes.

5. `packages/usdc-escrow-client`
   - Contract ABI/types.
   - Event decoder.
   - Client helpers for deposit/release/refund.

## Settlement Model

### Buy PRL With USDC

1. Buyer requests quote.
2. Quote engine locks `amountPrl`, `amountUsdc`, `fee`, `expiresAt`.
3. Seller/liquidity desk funds Pearl Taproot escrow.
4. Pearl indexer confirms the escrow outpoint.
5. Buyer pays USDC into Base escrow contract for `tradeId`.
6. Base indexer confirms USDC escrow deposit.
7. Settlement worker broadcasts pre-signed PRL release to buyer.
8. Pearl indexer confirms PRL release.
9. USDC escrow releases seller proceeds and KaspaCom fee.
10. Public proof page marks trade complete.

### Sell PRL For USDC

1. Seller requests quote.
2. Seller funds Pearl Taproot escrow to the generated address.
3. Pearl indexer confirms PRL escrow.
4. Desk/buyer funds USDC escrow.
5. Settlement worker releases USDC to seller and PRL to buyer according to the same state machine.

The implementation should use one generalized trade state machine for both directions.

## Pearl Escrow Pattern

MVP should avoid P2SH. Pearl's current standard output policy is Taproot/P2MR/OP_RETURN oriented, and P2SH appears to be legacy inherited code.

Use Taproot:

- Cooperative/key-path spend for cheapest release where possible.
- Script-path fallback for dispute/refund.
- CLTV or CSV refund path.
- Optional OP_RETURN receipt only after size/policy is verified.

Minimum useful escrow package per trade:

- Escrow P2TR address.
- Funding amount and expected outpoint.
- Release transaction template.
- Refund transaction template.
- Signature metadata.
- Refund eligibility height/time.
- Verification record from simnet before mainnet use.

## Base USDC Escrow Contract

The contract should be deliberately small:

- `deposit(tradeId, seller, buyer, amount, fee, expiry)`
- `release(tradeId)`
- `refund(tradeId)`
- `cancelExpired(tradeId)`
- Events for every transition.

Rules:

- One USDC escrow per trade ID or one shared contract with isolated trade records.
- USDC amount and recipient are fixed before deposit.
- Only authorized coordinator/multisig can release in MVP.
- Expired deposits are refundable.
- Admin pause is available.

This contract is the main product improvement over the competitor's direct seller-payment flow.

## Trade State Machine

Canonical states:

- `quoted`
- `quote_expired`
- `pearl_escrow_pending`
- `pearl_escrow_seen`
- `pearl_escrow_confirmed`
- `usdc_escrow_pending`
- `usdc_escrow_confirmed`
- `release_pending`
- `released`
- `refund_available`
- `refund_pending`
- `refunded`
- `disputed`
- `cancelled`
- `failed_manual_review`

Every transition must record:

- source event ID
- source chain/network
- block number/height when applicable
- tx hash/outpoint
- confirmation count
- actor
- observed timestamp

## Indexer Requirements

The Pearl indexer is not a generic explorer clone. It exists to make marketplace state reliable.

MVP data:

- blocks: hash, height, time, previous hash
- transactions: txid, block hash/height, raw hex if needed
- outputs: txid, vout, value, script type, address/script key, spent state
- inputs: spent txid/vout
- address activity: received/spent outputs
- escrow watch records: expected script/address, expected amount, trade ID
- confirmations and reorg status

Indexer API:

- `GET /chain/tip`
- `GET /tx/:txid`
- `GET /address/:address/utxos`
- `GET /escrows/:tradeId`
- `GET /escrows/:tradeId/proof`
- `POST /watch/escrow`

Reorg handling:

- Never finalize a trade from mempool alone.
- Confirmation threshold is configurable by trade value.
- Revert state on detached block if the indexed tx disappears.
- External callbacks are idempotent and replay-safe.

## Data Model Sketch

Core tables:

- `users`
- `quotes`
- `trades`
- `trade_events`
- `pearl_escrows`
- `pearl_transactions`
- `pearl_outputs`
- `usdc_escrows`
- `offers`
- `liquidity_accounts`
- `fees`
- `webhook_deliveries`
- `admin_actions`

Keep financial accounting separate from chain observation. The indexer reports what happened; the ledger records what the marketplace decided.

## MVP Scope

Build only what proves the settlement advantage:

- RFQ quote creation.
- KaspaCom-owned Pearl node/indexer path.
- One buy-PRL checkout flow.
- Pearl escrow proof tracking.
- Base USDC escrow deposit tracking.
- Release/refund state machine.
- Public proof page.
- Admin/manual override with audit log.

Defer:

- Full public order book.
- Browser wallet extension.
- OP_CAT covenants.
- Automated dispute adjudication.
- Cross-chain PRL wrapping.
- Mobile app.

## Success Criteria

Planning phase is complete when:

- Architecture and component map exist.
- OpenSpec tasks define the MVP.
- Security gates are explicit.
- Simnet-first verification is required before mainnet.

MVP implementation is complete only when:

- Pearl escrow flow passes on simnet.
- USDC escrow flow passes on Base Sepolia or local fork.
- End-to-end trade completes from quote to release in a test environment.
- Reorg/confirmation handling has tests.
- No private keys, seeds, or RPC credentials are committed.
- Public proof page reconstructs trade state from indexed events.

## Immediate Next Steps

1. Add OpenSpec tasks for the settlement desk MVP.
2. Scaffold `packages/pearl-rpc`, `packages/pearl-sdk`, and `packages/pearl-script`.
3. Verify Pearl chain config and Taproot signing against upstream/simnet.
4. Design the USDC escrow contract interface before writing Solidity.
5. Build the Pearl indexer schema around marketplace proof needs.
