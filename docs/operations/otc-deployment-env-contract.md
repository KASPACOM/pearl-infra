# Pearl OTC Deployment Environment Contract

This contract defines the deployment-time configuration and Kubernetes/Docker
secret names for the Pearl OTC stack. It is intentionally explicit so production
startup cannot silently fall back to local mocks.

## Environments

| Environment | Pearl network | Base network | Purpose | Mainnet funds |
|---|---|---|---|---|
| `local` | `simnet` or `testnet2` | `base_sepolia` | developer smoke tests | no |
| `simnet` | `simnet` | local/mock Base or Base Sepolia | full escrow rehearsal | no |
| `testnet2-base-sepolia` | `testnet2` | `base_sepolia` | pre-mainnet evidence with real txids | no mainnet PRL |
| `mainnet-disabled` | `mainnet` | `base` | configuration preview only | blocked |

`mainnet` enablement is not a deploy target until `9.6.4`, `9.8.10`, `9.8.11`,
`9.6.7`, and explicit approval are recorded.

## Secret Names

Use these exact secret names in manifests, compose `.env` files, and external
secret mappings. Do not put literal secret values in this repository.

Non-secret environment examples live in `ops/otc/`.

| Secret name | Owner | Required keys |
|---|---|---|
| `pearl-node-testnet2-rpc` | `pearld` testnet2 | `PEARLD_RPC_USER`, `PEARLD_RPC_PASS`, `PEARLD_MINING_ADDRESS` |
| `pearl-node-mainnet-rpc` | `pearld` mainnet preview | `PEARLD_RPC_USER`, `PEARLD_RPC_PASS`, `PEARLD_MAINNET_MINING_ADDRESS` |
| `pearl-indexer-testnet2-db` | Pearl indexer | `PEARL_INDEXER_DATABASE_URL`, `PEARL_INDEXER_POSTGRES_PASSWORD` |
| `pearl-indexer-mainnet-db` | Pearl indexer mainnet preview | `PEARL_INDEXER_DATABASE_URL`, `PEARL_INDEXER_POSTGRES_PASSWORD` |
| `pearl-otc-api-db` | OTC API | `OTC_API_DATABASE_URL` |
| `pearl-otc-base-rpc` | OTC API and worker | `BASE_RPC_URL` |
| `pearl-otc-p2tr-xpub` | OTC API | `PEARL_ESCROW_XPUB` |
| `pearl-otc-admin-api` | OTC API admin surface | `OTC_ADMIN_API_TOKEN` |
| `pearl-otc-signer-policy` | settlement worker / signer boundary | `PEARL_SIGNER_KEY_ID`, `PEARL_SIGNER_ALLOWED_KEY_IDS`, `PEARL_SIGNER_RELEASE_FEE_CAP_GRAINS`, `PEARL_SIGNER_REFUND_FEE_CAP_GRAINS` |
| `pearl-otc-signer-store` | signer boundary | `PEARL_SIGNER_REQUEST_STORE_PATH`, `PEARL_SIGNER_AUDIT_LOG_PATH` |
| `pearl-otc-operator-alerts` | alerting | `OTC_ALERT_WEBHOOK_URL` and/or `OTC_ALERT_TELEGRAM_BOT_TOKEN`, `OTC_ALERT_TELEGRAM_CHAT_ID`, optional `OTC_ALERT_TELEGRAM_MESSAGE_THREAD_ID` |

Signer private material is not part of this repo-level contract. It must live
inside the signer host/KMS/offline signer boundary and must not be exposed to
OTC API, indexer, frontend, or general worker containers.

## Service Environment Contract

### Pearl Node

| Variable | Required for | Source | Notes |
|---|---|---|---|
| `PEARLD_RPC_USER` | testnet2/mainnet node | `pearl-node-*-rpc` | unique per environment |
| `PEARLD_RPC_PASS` | testnet2/mainnet node | `pearl-node-*-rpc` | rotate if logged |
| `PEARLD_MINING_ADDRESS` | testnet2 node | `pearl-node-testnet2-rpc` | testnet2 address only |
| `PEARLD_MAINNET_MINING_ADDRESS` | mainnet preview node | `pearl-node-mainnet-rpc` | mainnet address only |

### Pearl Indexer

| Variable | Required for | Example | Notes |
|---|---|---|---|
| `PEARL_NETWORK` | all | `testnet2` | no implicit mainnet in production |
| `PEARLD_RPC_URL` | all | `http://pearld:44111` | private network or localhost only |
| `PEARLD_RPC_USER` | all | secret | from node RPC secret |
| `PEARLD_RPC_PASS` | all | secret | from node RPC secret |
| `PEARL_INDEXER_DATABASE_URL` | all persistent deployments | secret | Postgres URL with migration-applied DB |
| `PEARL_INDEXER_START_HEIGHT` | first deploy only | `0` or chosen checkpoint | changes after first deploy require operator note |
| `PEARL_INDEXER_POLL_INTERVAL_MS` | all | `10000` | alert if poll loop is stale |
| `PEARL_INDEXER_HTTP_HOST` | all | `0.0.0.0` | expose only on private network |
| `PEARL_INDEXER_HTTP_PORT` | all | `8088` | watched-address API |

### OTC API

| Variable | Required for production-like deploys | Expected value |
|---|---|---|
| `NODE_ENV` | yes | `production` |
| `OTC_API_REQUIRE_PRODUCTION_CONFIG` | yes | `true` |
| `OTC_API_DATABASE_URL` | yes | secret from `pearl-otc-api-db` |
| `BASE_RPC_URL` | yes | secret from `pearl-otc-base-rpc` |
| `BASE_USDC_ESCROW_NETWORK` | yes | `base_sepolia` until mainnet approval |
| `BASE_USDC_ESCROW_CONTRACT` | yes | approved Base Sepolia escrow contract |
| `PEARL_NETWORK` | yes | `testnet2` until mainnet approval |
| `PEARL_ESCROW_ALLOCATOR` | yes | `p2tr_xpub` |
| `PEARL_ESCROW_XPUB` | yes | secret from `pearl-otc-p2tr-xpub` |
| `PEARL_ESCROW_DERIVATION_PREFIX` | yes | non-hardened path prefix, default `0` |
| `PEARL_ESCROW_ALLOW_MAINNET` | yes | `false` until approval |
| `PEARL_INDEXER_WATCH_URL` | yes | private URL for testnet2 watched-address API |
| `PEARL_INDEXER_WATCH_TIMEOUT_MS` | yes | `5000` |
| `OTC_ADMIN_API_TOKEN` | yes | bearer token from `pearl-otc-admin-api` |
| `OTC_ALERT_WEBHOOK_URL` | webhook alert sink | operator alert webhook from `pearl-otc-operator-alerts` |
| `OTC_ALERT_TELEGRAM_BOT_TOKEN` | Telegram alert sink | Telegram bot token from `pearl-otc-operator-alerts` |
| `OTC_ALERT_TELEGRAM_CHAT_ID` | Telegram alert sink | target chat ID from `pearl-otc-operator-alerts` |
| `OTC_ALERT_TELEGRAM_MESSAGE_THREAD_ID` | Telegram forum topics | optional target topic/thread ID |
| `OTC_QUOTE_TTL_MS` | yes | quoted policy value |
| `OTC_PEARL_FUNDING_TTL_MS` | yes | quoted policy value |
| `OTC_USDC_DEPOSIT_TTL_MS` | yes | quoted policy value |
| `OTC_SETTLEMENT_TTL_MS` | yes | quoted policy value |
| `OTC_PRICE_USDC_PER_PRL` | yes | operator-set price source |
| `OTC_FEE_BPS` | yes | operator-set fee |
| `PEARL_ESCROW_CONFIRMATIONS` | yes | minimum required PRL confirmations |

Production-like startup must fail if `OTC_API_REQUIRE_PRODUCTION_CONFIG=true`
and any required value is absent or mock-only.

### Settlement Worker And Signer Boundary

| Variable | Required for | Notes |
|---|---|---|
| `SETTLEMENT_WORKER_ENABLED` | worker deploy | `false` by default until ops enables polling |
| `SETTLEMENT_WORKER_POLL_INTERVAL_MS` | worker deploy | start with `10000` |
| `PEARL_SIGNER_POLICY_VERSION` | signer boundary | `pearl-otc-signer-v1` |
| `PEARL_SIGNER_KEY_ID` | signer boundary | must be in allow-list |
| `PEARL_SIGNER_ALLOWED_KEY_IDS` | signer boundary | comma-separated approved signer key IDs |
| `PEARL_SIGNER_RELEASE_FEE_CAP_GRAINS` | signer boundary | per-trade max release fee |
| `PEARL_SIGNER_REFUND_FEE_CAP_GRAINS` | signer boundary | per-trade max refund fee |
| `PEARL_SIGNER_PAUSED` | signer boundary | emergency stop; `true` blocks signing |
| `PEARL_SIGNER_REQUEST_STORE_PATH` | signer boundary | persistent request state |
| `PEARL_SIGNER_AUDIT_LOG_PATH` | signer boundary | append-only audit log |
| `PEARL_BROADCAST_ENABLED` | broadcaster | `false` until simnet/testnet evidence passes |

The signer boundary may return signed transaction material. It must not call
`sendrawtransaction`; broadcasting remains a separate worker/broadcaster step.

## Deployment Gates

Before enabling quote acceptance in `testnet2-base-sepolia`:

- testnet2 `pearld` RPC health returns block count and best hash;
- indexer `/healthz` and `/watches` smoke checks pass;
- `PEARL_INDEXER_WATCH_URL` points at the private watched-address API;
- OTC API starts with `OTC_API_REQUIRE_PRODUCTION_CONFIG=true`,
  `OTC_ADMIN_API_TOKEN`, and at least one operator alert sink configured
  (`OTC_ALERT_WEBHOOK_URL` or Telegram bot token plus chat ID);
- Base Sepolia contract address matches recorded evidence;
- signer policy is configured with fee caps and `PEARL_SIGNER_PAUSED=true`;
- `PEARL_BROADCAST_ENABLED=false` until simnet evidence is recorded.

Before any mainnet PRL path:

- `PEARL_ESCROW_ALLOW_MAINNET=false` remains set until approval;
- `BASE_USDC_ESCROW_NETWORK=base_sepolia` remains set until Base mainnet approval;
- simnet run evidence is recorded;
- testnet2 Pearl + Base Sepolia txid evidence is recorded;
- Base ownership acceptance evidence is recorded;
- monitoring alerts are live and routed.
