# Full OTC Live Evidence Verifier

This verifier is the next gate for `9.8.10.c` and `9.8.11`. It does not create
or broadcast transactions. It verifies an already-run trade by reading:

- the OTC API public trade and proof routes;
- Base Sepolia transaction receipts for `TradeCreated`, `Deposited`, and
  `Released` or `Refunded`;
- the Pearl indexer watch history for the trade escrow.

The test is skipped by default in CI and local runs. It only runs when all
required environment variables are set. Base transaction hashes can be supplied
directly through the environment or read from the OTC API durable live evidence
route.

## Required Inputs

```bash
export OTC_FULL_FLOW_API_URL=http://127.0.0.1:3000
export OTC_FULL_FLOW_TRADE_ID=otc_...
export OTC_FULL_FLOW_BASE_RPC_URL=https://base-sepolia.example
export OTC_FULL_FLOW_BASE_TX_HASHES=0xcreate,0xdeposit,0xrelease
export OTC_FULL_FLOW_PEARL_INDEXER_URL=http://127.0.0.1:8088
```

`OTC_FULL_FLOW_BASE_TX_HASHES` is optional when the API has durable evidence at
`GET /otc/trades/:tradeId/live-proof-evidence`.

For a refund path, use the refund tx hash as the final hash and set:

```bash
export OTC_FULL_FLOW_EXPECTED_STATUS=refunded
```

`OTC_FULL_FLOW_EXPECTED_STATUS` is optional when the durable evidence route
returns `expectedStatus`.

## Record Durable Evidence

After a terminal live run, an operator records the Base lifecycle tx hashes on
the durable OTC side-effect ledger:

```bash
curl -X POST "$OTC_FULL_FLOW_API_URL/otc/admin/trades/$OTC_FULL_FLOW_TRADE_ID/live-proof-evidence" \
  -H "authorization: Bearer $OTC_ADMIN_API_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "idempotencyKey": "live-proof-2026-05-24-release-1",
    "expectedStatus": "released",
    "baseTxHashes": ["0xcreate...", "0xdeposit...", "0xrelease..."]
  }'
```

The public replay route returns the expected terminal status, normalized Base
tx hashes, the public proof path, and the current public proof:

```bash
curl "$OTC_FULL_FLOW_API_URL/otc/trades/$OTC_FULL_FLOW_TRADE_ID/live-proof-evidence"
```

## Run

```bash
npm --workspace @kaspacom/settlement-worker run typecheck
npm --workspace @kaspacom/otc-api run typecheck
node --test services/otc-api/test/live-full-otc-evidence.test.ts
```

The full repo test command also includes the verifier, but it will remain
skipped unless the environment variables above are present:

```bash
npm test
```

## Pass Criteria

The verifier must prove:

- public proof trade ID, status, Base trade key, Base contract, and Pearl escrow
  address match the OTC trade;
- Base RPC chain ID matches the OTC trade chain ID;
- Base receipts exist, succeeded, and contain `TradeCreated`, `Deposited`, and
  exactly one terminal `Released` or `Refunded` event for the exact trade key;
- normalized Base event state is safe for the settlement worker and does not
  become `stale`;
- Base deposit and release/refund tx hashes in public proof match the observed
  receipts;
- indexed Pearl escrow outpoint, release/refund txid, and required
  confirmations match public proof.

## Recorded Testnet2 Run

The first successful real cross-chain run is recorded in
[`full-otc-testnet2-evidence-20260521.md`](full-otc-testnet2-evidence-20260521.md).
It used real Pearl testnet2 funding/release transactions and real Base Sepolia
native-USDC escrow create/deposit/release transactions.

Important follow-up: the proof runner used a local in-memory OTC API process, so
this verifier cannot be rerun after that process exits unless the trade is
persisted in Postgres or replayed through a live API instance.

## Remaining Productization

The verifier and durable evidence route close the repeatable evidence harness
gap for trades persisted in Postgres or another live API repository. The
successful testnet2 run also exposed one remaining productization requirement:

- include release/refund destination metadata in Pearl watches, preferably with
  distinct release and refund addresses, so fee-adjusted spends classify as
  `release` or `refund` instead of `unknown_spend`.
