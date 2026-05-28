# Oyster Dev End-to-End Testing Runbook

This document walks through a complete dev settlement on `dev-oyster.kaspa.com` /
`dev-api-oyster.kaspa.com` using the multisig + preauthorized-release path.

## Network: testnet2

Dev runs against the Hetzner testnet2 pearld via a docker-socat proxy at
`65.21.206.46:44110 → 127.0.0.1:44111` (UFW-whitelisted port that was free).
Indexer is the existing public-facing one at `65.21.206.46:8088` (restricted
to dev cluster egress IP). pearld RPC requires basic auth (`pearl_indexer_rpc`
creds shared with the indexer).

The proxy container is `pearl-testnet2-rpc-proxy` (`alpine/socat`,
`--restart=unless-stopped`) on the Hetzner host. It survives reboots.

## One-Time Setup (operator hands)

These steps unblock the worker and have to happen before the first dev settlement run.
They are not in any CI workflow — they touch AWS Secrets Manager, Argo Application CRs,
and dev cluster wiring.

1. **Generate the dev arbiter keypair.** Pick any 32-byte secp256k1 scalar (e.g.
   `openssl rand -hex 32`). Save:
   - the privkey as `OYSTER_WORKER_ARBITER_PRIVKEY_HEX` (32-byte hex, no `0x`)
   - the x-only pubkey as `PEARL_ESCROW_ARBITER_PUBKEY` (32-byte hex)
2. **Populate AWS Secrets Manager (eu-central-1):**
   - `dev/oyster-otc-api` — add field `PEARL_ESCROW_ARBITER_PUBKEY` (matching the
     pubkey from step 1).
   - `dev/oyster-otc-signer` — new secret with field
     `OYSTER_WORKER_ARBITER_PRIVKEY_HEX`. Restrict KMS access to the worker IAM role.
3. **Flip dev allocator to multisig** in
   `KASPACOM/argo-cd/dev/dev-a-eu1-cluster/oyster-otc-api/configmap.yaml`:
   - `PEARL_ESCROW_ALLOCATOR: "p2tr_multisig"`
4. **Register the settlement-worker Argo Application CR** in the dev cluster from
   `KASPACOM/argo-cd/dev/dev-a-eu1-cluster/oyster-otc-settlement-worker/application.yaml`.
5. **Wait for ArgoCD sync.** Confirm the pod `oyster-otc-settlement-worker` is
   `1/1 Running` in the `kaspa` namespace.

## Per-Trade Test Flow

The flow exercises every layer that ships to prod, swapping a browser wallet for the
CLI signing helper. Every step uses real HTTP and real signatures; the only thing
mocked is the buyer wallet UI.

### 1. Generate buyer + seller keypairs (one-time per test session)

```bash
openssl rand -hex 32 > /tmp/buyer-prl.privkey
openssl rand -hex 32 > /tmp/seller-prl.privkey
```

Derive x-only pubkeys with the `xOnlyPublicKey` helper or any BIP340 tool. You'll
need them for the accept request signer-ownership proofs.

### 2. Create a quote

```bash
curl -sX POST "https://dev-api-oyster.kaspa.com/otc/quotes" \
  -H 'content-type: application/json' \
  -d '{
    "side": "buy_prl",
    "amountPrl": "1.00000000",
    "settlementAsset": "USDC",
    "settlementNetwork": "base",
    "buyerPearlAddress": "<buyer testnet2 pearl address (tprl1p...)>",
    "usdcRefundAddress": "<buyer base sepolia address>",
    "clientRequestId": "test-quote-1"
  }'
```

### 3. Accept the quote with multisig + preauthorize_release

The accept payload must include buyer + seller BIP340 signer-ownership proofs bound
to the quote, role, addresses, pubkey, and release-signing mode. Construct each
proof with `createPearlSignerProofMessage` and sign with the role's privkey.

```bash
curl -sX POST "https://dev-api-oyster.kaspa.com/otc/trades" \
  -H 'content-type: application/json' \
  -d '{
    "quoteId": "<quote-id>",
    "pearlEscrowMode": "multisig",
    "pearlReleaseSigningMode": "preauthorize_release",
    "buyerPearlAddress": "<...>",
    "buyerUsdcAddress": "<...>",
    "sellerPearlRefundAddress": "<...>",
    "sellerUsdcReceiveAddress": "<...>",
    "buyerPearlPubkey": "<x-only hex>",
    "sellerPearlPubkey": "<x-only hex>",
    "buyerPearlPubkeyProof": "<64-byte schnorr hex>",
    "sellerPearlPubkeyProof": "<64-byte schnorr hex>",
    "clientRequestId": "test-accept-1"
  }'
```

### 4. Fund the Pearl escrow

Send testnet2 PRL to `pearlEscrow.address` from your funded testnet2 wallet
(Sione holds the test buyer privkey). Testnet2 mines on its own schedule
(~194s blocks) — wait for the watch
to observe + confirm. The trade state moves through
`pearl_escrow_pending → pearl_escrow_seen → pearl_escrow_confirmed`.

### 5. Buyer preauthorizes release

```bash
PEARL_API_BASE_URL=https://dev-api-oyster.kaspa.com \
TRADE_ID=<trade-id> \
BUYER_PEARL_PRIVKEY_HEX="$(cat /tmp/buyer-prl.privkey)" \
node packages/pearl-escrow/scripts/sign-buyer-preauthorize.mjs
```

The script fetches the unsigned PSBT template, signs in-process with the buyer
private key, and submits. On success it prints
`pearlEscrow.buyerReleasePresignature.signedAt`.

### 6. Base USDC deposit

Deposit Base Sepolia USDC into the escrow contract for this trade. Use the
returned trade's `usdcEscrow.contract` and `tradeKey` plus the standard escrow
ABI from `@kaspacom/usdc-escrow-client`.

### 7. Watch the worker release the trade

```bash
kubectl logs -n kaspa -l app=oyster-otc-settlement-worker --tail=200
```

Expect:
- `settlement worker iteration complete` log lines
- a `pearl release broadcast submitted` line with `broadcastTxid`
- a Pearl release tx observable on the testnet2 indexer (`http://65.21.206.46:8088`)
- trade transitions to `release_pending` then `released`

### 8. Settle the Base leg

The current dev worker defers the Base release leg to operator action; trigger it
with the existing OTC API `submitPearlSignedTransaction` flow or a manual
`Escrow.release()` call on Base Sepolia. (A Base-release worker is a follow-up.)

## Negative Path: Revoke a Preauthorization

To verify the revocation guard:

```bash
curl -sX DELETE "https://dev-api-oyster.kaspa.com/otc/trades/<trade-id>/pearl-release/preauthorize"
```

After revocation, the worker's next iteration should keep the trade in `wait` and
not broadcast.

## Worker Restart Behavior

The dev worker's broadcast-attempt ledger lives at `/data/pearl-broadcast-attempts.json`
inside an `emptyDir`. A pod restart loses the file and the worker re-signs on next
iteration. The re-signed bytes are deterministic (same inputs → same sig with the
zero-`aux_rand`), so the Pearl RPC rejects a duplicate broadcast as `tx already exists`;
the worker records the broadcast failure but does not double-spend. Prod must replace
the `emptyDir` with a PVC or Postgres-backed ledger before this becomes a real risk.

## Required Secret Keys

Before the worker pod starts cleanly, `dev/oyster-otc-api` and `dev/oyster-otc-signer`
must together cover:

| Key | Source secret | Purpose |
| --- | --- | --- |
| `OTC_API_DATABASE_URL` | `dev/oyster-otc-api` | shared Postgres |
| `BASE_RPC_URL` | `dev/oyster-otc-api` | Base Sepolia RPC |
| `PEARL_INDEXER_WATCH_URL` | `dev/oyster-otc-api` | Pearl indexer base URL |
| `PEARL_RPC_URL`, `PEARL_RPC_USER`, `PEARL_RPC_PASS` | `dev/oyster-otc-api` | for `sendrawtransaction` |
| `OYSTER_WORKER_ARBITER_PRIVKEY_HEX` | `dev/oyster-otc-signer` | 32-byte hex arbiter privkey |

If `PEARL_RPC_URL` is missing from `dev/oyster-otc-api`, the worker fails fast on startup
with a config error — that's the expected signal that the secret is incomplete.

## Known Limitations (dev-only)

These trade-offs are deliberately accepted to ship the dev test loop quickly. None are
acceptable in prod and they're tracked separately:

- **Iteration retry has no exponential backoff.** Pearl RPC outage → worker retries every
  `SETTLEMENT_WORKER_INTERVAL_MS`. Self-heals when RPC recovers.
- **Worker doesn't persist a `pearl_release` side-effect to Postgres** after successful
  broadcast. Public proof / admin views reflect the release via the Pearl indexer's
  observed spend, but worker-driven broadcast attempts are visible only in worker logs +
  the JSON ledger.
- **Trade row updates are not optimistic-concurrency-guarded.** If an admin cancels a
  trade between the worker's snapshot and its state write, the cancel can be clobbered.
  The same race exists in the pre-existing `transitionTrade` path and is tracked as a
  cross-cutting repo concern.
- **Base USDC release is a manual operator action.** The worker emits a deferred prepared
  action; the operator calls `Escrow.release(tradeKey)` on Base Sepolia after observing
  the Pearl release.
