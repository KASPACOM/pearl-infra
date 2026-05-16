# Pearl OTC Settlement Desk Contracts

This document turns the settlement-desk plan into implementation contracts for the MVP. It is intentionally backend-first: the UI should consume these contracts rather than inventing state.

## Success Criteria

This task is complete when:

- RFQ quote and trade lifecycle APIs are defined.
- Pearl escrow package fields are defined.
- Base USDC escrow interface/events are defined.
- Pearl indexer proof APIs are defined.
- Security gates block accidental mainnet custody or unverified escrow code.

## RFQ And Trade APIs

### Create Quote

`POST /otc/quotes`

Request:

```json
{
  "side": "buy_prl",
  "amountPrl": "1000.00000000",
  "settlementAsset": "USDC",
  "settlementNetwork": "base",
  "buyerPearlAddress": "prl1p...",
  "usdcRefundAddress": "0x...",
  "clientRequestId": "uuid"
}
```

Response:

```json
{
  "quoteId": "quote_...",
  "side": "buy_prl",
  "amountPrl": "1000.00000000",
  "amountUsdc": "170.00",
  "feePrl": "20.00000000",
  "feeUsdc": "0.00",
  "priceUsdcPerPrl": "0.170000",
  "expiresAt": "2026-05-16T12:15:00Z",
  "status": "active"
}
```

Rules:

- Quote is immutable once issued.
- Quote fill must fail after `expiresAt`.
- Amounts are strings, never floats.
- `clientRequestId` makes retries idempotent.

### Accept Quote

`POST /otc/quotes/:quoteId/accept`

Request:

```json
{
  "buyerPearlAddress": "prl1p...",
  "buyerUsdcAddress": "0x...",
  "sellerPearlRefundAddress": "prl1p...",
  "sellerUsdcReceiveAddress": "0x..."
}
```

Response:

```json
{
  "tradeId": "trade_...",
  "status": "pearl_escrow_pending",
  "pearlEscrow": {
    "network": "mainnet",
    "address": "prl1p...",
    "expectedAmountPrl": "1020.00000000",
    "requiredConfirmations": 3,
    "refundEligibleAfterHeight": 123456
  },
  "usdcEscrow": {
    "network": "base",
    "chainId": 8453,
    "contract": "0x...",
    "usdcToken": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "tradeKey": "0x...",
    "expectedAmountUsdc": "170.00",
    "requiredConfirmations": 6,
    "expiresAt": "2026-05-16T12:30:00Z"
  }
}
```

Rules:

- Accepting a quote creates one trade.
- Trade owns all settlement addresses and expected amounts.
- Payment instructions must come from backend state, not frontend calculation.

### Get Trade

`GET /otc/trades/:tradeId`

Response includes:

- quote terms
- current state
- Pearl escrow status
- USDC escrow status
- next required action
- release/refund eligibility
- public proof URL

### Public Proof

`GET /otc/trades/:tradeId/proof`

Public response:

```json
{
  "tradeId": "trade_...",
  "status": "released",
  "quote": {
    "side": "buy_prl",
    "amountPrl": "1000.00000000",
    "amountUsdc": "170.00"
  },
  "pearl": {
    "escrowOutpoint": "txid:vout",
    "escrowConfirmations": 3,
    "releaseTxid": "txid",
    "releaseConfirmations": 3
  },
  "base": {
    "depositTxHash": "0x...",
    "depositConfirmations": 6,
    "releaseTxHash": "0x..."
  },
  "observedAt": "2026-05-16T12:20:00Z"
}
```

Do not expose private user metadata on public proof pages.

## Trade State Transitions

Allowed MVP transitions:

```text
quoted -> quote_expired
quoted -> pearl_escrow_pending
pearl_escrow_pending -> pearl_escrow_seen
pearl_escrow_seen -> pearl_escrow_confirmed
pearl_escrow_confirmed -> usdc_escrow_pending
usdc_escrow_pending -> usdc_escrow_confirmed
usdc_escrow_confirmed -> release_pending
release_pending -> released
pearl_escrow_confirmed -> refund_available
refund_available -> refund_pending
refund_pending -> refunded
* -> disputed
* -> failed_manual_review
```

Transition rules:

- State transitions are append-only events.
- Current state is derived from the latest accepted event.
- Any chain reorg emits a correcting event rather than mutating history.
- Release/refund side effects require idempotency keys.

## Pearl Escrow Package

`PearlEscrowPackage`

```ts
interface PearlEscrowPackage {
  tradeId: string;
  network: 'mainnet' | 'testnet' | 'simnet' | 'regtest';
  escrowAddress: string;
  escrowScriptType: 'p2tr';
  expectedAmountGrains: string;
  requiredConfirmations: number;
  refundEligibleAfterHeight?: number;
  refundEligibleAfterUnixTime?: number;
  fundingOutpoint?: {
    txid: string;
    vout: number;
    amountGrains: string;
    confirmations: number;
  };
  releaseTemplate: PearlTxTemplate;
  refundTemplate: PearlTxTemplate;
  signatures: PearlEscrowSignature[];
  verification: {
    simnetVerified: boolean;
    verifiedAt?: string;
    verificationTxids?: string[];
  };
}
```

`PearlTxTemplate`

```ts
interface PearlTxTemplate {
  kind: 'release' | 'refund' | 'dispute_release';
  unsignedTxHex?: string;
  psbtBase64?: string;
  outputs: Array<{
    address: string;
    amountGrains: string;
    role: 'buyer' | 'seller' | 'fee' | 'refund';
  }>;
  lockTime?: number;
  sequence?: number;
}
```

`PearlEscrowSignature`

```ts
interface PearlEscrowSignature {
  signerRole: 'buyer' | 'seller' | 'arbiter' | 'desk';
  signerPubkey: string;
  templateKind: 'release' | 'refund' | 'dispute_release';
  signatureHex: string;
  signedAt: string;
}
```

Rules:

- Mainnet broadcast is disabled unless `verification.simnetVerified === true`.
- P2SH is not allowed in MVP.
- OP_CHECKXMSSSIG is not allowed in hot-wallet escrow.
- OP_CAT is not allowed in MVP escrow templates.

## Base USDC Escrow Contract Interface

MVP network config:

| Environment | Chain ID | Native USDC |
|---|---:|---|
| Base mainnet | 8453 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Base Sepolia | 84532 | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

Minimal Solidity-facing interface:

```solidity
interface IPrlUsdcEscrow {
    struct Trade {
        address buyer;
        address seller;
        uint256 amount;
        uint256 fee;
        uint64 expiry;
        uint8 status;
    }

    event TradeCreated(bytes32 indexed tradeId, address indexed buyer, address indexed seller, uint256 amount, uint256 fee, uint64 expiry);
    event Deposited(bytes32 indexed tradeId, address indexed payer, uint256 amount);
    event Released(bytes32 indexed tradeId, address indexed seller, uint256 sellerAmount, uint256 feeAmount);
    event Refunded(bytes32 indexed tradeId, address indexed buyer, uint256 amount);
    event Cancelled(bytes32 indexed tradeId);

    function usdcToken() external view returns (address);
    function createTrade(bytes32 tradeId, address buyer, address seller, uint256 amount, uint256 fee, uint64 expiry) external;
    function deposit(bytes32 tradeId) external;
    function release(bytes32 tradeId) external;
    function refund(bytes32 tradeId) external;
    function cancelExpired(bytes32 tradeId) external;
}
```

MVP authorization:

- `createTrade`, `release`, and emergency pause are coordinator/multisig only.
- `deposit` is buyer-only or allows any payer while crediting the buyer's trade.
- `refund` can be called by buyer after expiry or by coordinator on failed PRL release.

Security rules:

- Use OpenZeppelin `SafeERC20`, `Pausable`, and reviewed ownership/access control.
- No upgradeability in MVP unless there is an explicit governance decision.
- No arbitrary token support in MVP; USDC only.
- Every trade lifecycle event must include `tradeId`.
- Base Sepolia deployment uses native USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.
- Base mainnet deployment remains disabled until review, multisig ownership, and testnet evidence exist.
- Custody owner handoff must use two-step ownership transfer; ownership renounce is disabled.
- Emergency pause must not block expired buyer refunds or expired created-trade cleanup.
- Implementation PRs that add escrow code/tests are not deployment approval and must not be treated as evidence of a deployed contract.
- Deployment evidence must include contract address, deploy tx, owner/multisig acceptance tx, fee recipient, native USDC address, and verification link.

## Pearl Indexer APIs

### Register Escrow Watch

`POST /indexer/escrows/watch`

```json
{
  "tradeId": "trade_...",
  "network": "mainnet",
  "address": "prl1p...",
  "expectedAmountGrains": "102000000000",
  "requiredConfirmations": 3
}
```

### Get Escrow Proof

`GET /indexer/escrows/:tradeId/proof`

Returns:

- expected address/script
- funding outpoint
- spend txid if spent
- release/refund classification
- confirmation count
- reorg status
- latest indexed height

### Get Address UTXOs

`GET /indexer/address/:address/utxos`

Used by wallet/proof UI only. Trade logic should prefer registered escrow watches.

## Database Entities

Minimum MVP entities:

- `Quote`
- `Trade`
- `TradeEvent`
- `PearlEscrow`
- `PearlEscrowSignature`
- `UsdcEscrow`
- `IndexedPearlBlock`
- `IndexedPearlTransaction`
- `IndexedPearlOutput`
- `WebhookDelivery`
- `AdminAction`

Indexes:

- `Trade.tradeId`
- `Quote.clientRequestId`
- `PearlEscrow.escrowAddress`
- `PearlEscrow.fundingTxid/fundingVout`
- `UsdcEscrow.tradeKey`
- `TradeEvent.tradeId + createdAt`
- `IndexedPearlOutput.txid + vout`
- `IndexedPearlOutput.address`

## Security Gates

No mainnet code path is enabled until all are true:

- Pearl Taproot address derivation verified against upstream `chaincfg`.
- Pearl release and refund transactions pass simnet broadcast.
- Indexer observes funding, release, refund, and a synthetic reorg test.
- USDC escrow contract passes local fork tests.
- Arbiter/coordinator keys are loaded from environment or KMS, never source.
- Admin override requires audit event and role authorization.
- Proof page data is derived from indexed events, not manually entered fields.

## Verification Commands

Initial docs/spec verification:

```bash
git diff --check
```

Implementation verification once code exists:

```bash
npm run typecheck
npm test
npm run test:simnet
npm run test:base-fork
```

## Test Ladder

You do not need a running Pearl node for every MVP test.

Can run before `pearld`/indexer is live:

- quote and trade state-machine unit tests;
- API validation and idempotency tests;
- database migration/repository tests;
- Base USDC escrow contract unit tests;
- Base Sepolia or local EVM fork tests;
- mocked Pearl indexer proof fixtures;
- frontend checkout/proof views against mocked API responses.

Requires a real `pearld` plus marketplace indexer:

- detecting actual Pearl escrow funding outpoints;
- detecting Pearl release/refund spends;
- confirmation and reorg handling against real block data;
- broadcasting signed Pearl transactions;
- full quote-to-release integration tests involving PRL.
