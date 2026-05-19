# Full OTC Live Evidence Verifier

This verifier is the next gate for `9.8.10.c` and `9.8.11`. It does not create
or broadcast transactions. It verifies an already-run trade by reading:

- the OTC API public trade and proof routes;
- Base Sepolia transaction receipts for `TradeCreated`, `Deposited`, and
  `Released` or `Refunded`;
- the Pearl indexer watch history for the trade escrow.

The test is skipped by default in CI and local runs. It only runs when all
required environment variables are set.

## Required Inputs

```bash
export OTC_FULL_FLOW_API_URL=http://127.0.0.1:3000
export OTC_FULL_FLOW_TRADE_ID=otc_...
export OTC_FULL_FLOW_BASE_RPC_URL=https://base-sepolia.example
export OTC_FULL_FLOW_BASE_TX_HASHES=0xcreate,0xdeposit,0xrelease
export OTC_FULL_FLOW_PEARL_INDEXER_URL=http://127.0.0.1:8088
```

For a refund path, use the refund tx hash as the final hash and set:

```bash
export OTC_FULL_FLOW_EXPECTED_STATUS=refunded
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

## Still Blocked Until Live Inputs Exist

This verifier closes the repeatable evidence harness gap. It does not remove
the need for a real trade run with:

- wallet-funded PRL into a unique escrow address;
- real Base Sepolia `createTrade`, `deposit`, and `release` or `refund` txids;
- a real PRL signing/broadcast path. The current Oyster build still cannot
  arbitrary-sign raw transactions, so the next run must use either a non-Oyster
  signer path or the controlled Oyster `sendmany` workaround documented in the
  wallet-backed simnet evidence.
