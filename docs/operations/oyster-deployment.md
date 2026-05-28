# Oyster Deployment

Oyster deploys the Pearl OTC application as two services per environment:

| Environment | Branch | Web host | API host | AWS region | ECR images |
| --- | --- | --- | --- | --- | --- |
| dev | `dev` | `dev-oyster.kaspa.com` | `dev-api-oyster.kaspa.com` | `eu-central-1` | `kaspacom/oyster-otc-web-dev`, `kaspacom/oyster-otc-api-dev` |
| main | `main` | `oyster.kaspa.com` | `api-oyster.kaspa.com` | `us-east-1` | `kaspacom/oyster-otc-web-prod`, `kaspacom/oyster-otc-api-prod` |

The web image is built with `VITE_OTC_API_BASE_URL` set to the matching API
host and `VITE_PEARL_ESCROW_MODE` set to `multisig` on dev, `coordinator` on
main until mainnet custody is explicitly approved. Do not put admin/operator
tokens in `VITE_*` variables; Vite embeds them in the public browser bundle.
Operators enter the token in the admin screen, which stores it in browser
session storage only. The API container serves `/healthz`; the web container
serves `/healthz` through Nginx.

## CI/CD

`.github/workflows/deploy-oyster.yml` runs on pushes to `dev` and `main`.

The workflow:

1. installs dependencies and runs `npm test`;
2. builds and pushes the OTC API image;
3. builds and pushes the OTC web image with the environment-specific API base
   URL and Pearl escrow-mode default;
4. updates the matching ArgoCD deployment image tags in `KASPACOM/argo-cd`.

On `main`, the workflow first verifies that `prod/oyster-otc-api` exists in
AWS Secrets Manager and contains the required runtime keys. This prevents a
green-looking prod image update when the pods would fail startup after Argo
sync.

Required GitHub secrets:

| Secret | Purpose |
| --- | --- |
| `AWS_ACCESS_KEY_ID` | ECR push |
| `AWS_SECRET_ACCESS_KEY` | ECR push |
| `ARGO_GH_APP_ID` | ArgoCD image-tag update commit |
| `ARGO_GH_APP_PRIVATE_KEY` | ArgoCD image-tag update commit |

## Runtime Secrets

The Argo manifests read the following ExternalSecret keys:

| Environment | ExternalSecret key |
| --- | --- |
| dev | `dev/oyster-otc-api` |
| main | `prod/oyster-otc-api` |

Expected fields in each secret:

| Key | Notes |
| --- | --- |
| `OTC_API_DATABASE_URL` | Postgres URL for OTC quotes/trades/side effects. |
| `BASE_RPC_URL` | Base Sepolia RPC until Base mainnet is approved. |
| `PEARL_ESCROW_XPUB` | P2TR derivation xpub when `PEARL_ESCROW_ALLOCATOR=p2tr_xpub`. |
| `PEARL_ESCROW_ARBITER_PUBKEY` | x-only arbiter key when `PEARL_ESCROW_ALLOCATOR=p2tr_multisig`. |
| `PEARL_INDEXER_WATCH_URL` | Private watched-address API URL. |
| `OTC_ADMIN_API_TOKENS` or `OTC_ADMIN_API_TOKEN` | Admin RBAC token contract. |
| `OTC_ALERT_TELEGRAM_BOT_TOKEN` | Required unless webhook delivery is used. |
| `OTC_ALERT_TELEGRAM_CHAT_ID` | Required with Telegram delivery. |
| `OTC_ALERT_TELEGRAM_MESSAGE_THREAD_ID` | Optional forum-topic routing. |
| `OTC_ALERT_WEBHOOK_URL` | Alternative to Telegram delivery. |

## Mainnet Gate

The public `oyster.kaspa.com` environment stays non-mainnet until the mainnet
checklist gates are complete. Pearl testnet2 is not a mandatory blocker while
there is no usable faucet/liquidity; after simnet proof, the next PRL path is an
explicitly approved low-cap mainnet run with real txids, public proof, and clean
reconciliation. Do not change it to Pearl mainnet or Base mainnet until the live
run evidence, Base ownership acceptance, and explicit mainnet approval items
are closed.

## 2026-05-24 Deployment State

Dev auto-deploy is working from `dev`. Merge commit
`b5b5dbbf476bb3defcc521e263fe2919f960a4a2` completed the Deploy Oyster
workflow, updated Argo image tags, rolled out `oyster-otc-api` and
`oyster-otc-web` in `dev-a-eu1-cluster`, and passed live HTTPS smoke checks for
health, quote, accept, Pearl watch registration, public proof, admin search, and
support-alert delivery.

Production is not automatic from `dev`; it only runs from `main`. As of this
check, production is blocked by:

- `main` still at `f98b3a2`, 119 commits behind `dev`;
- empty `kaspacom/oyster-otc-api-prod` and `kaspacom/oyster-otc-web-prod` ECR
  repos;
- missing `prod/oyster-otc-api` secret in AWS Secrets Manager `us-east-1`;
- missing `oyster-otc-api` and `oyster-otc-web` Argo Application CRs in the prod
  cluster;
- unresolved `oyster.kaspa.com` and `api-oyster.kaspa.com` DNS records.

To finish production, use this order:

1. Create `prod/oyster-otc-api` with the required keys, using prod-safe
   values. Until explicit mainnet approval, keep Pearl on `testnet2` and Base
   on `base_sepolia`.
2. Promote `dev` to `main` through a reviewed PR so the prod ECR images are
   built from the intended commit.
3. Bootstrap the prod `oyster-otc-api` and `oyster-otc-web` Argo Application
   CRs.
4. Wait for the ALBs, then create Cloudflare CNAME records for
   `oyster.kaspa.com` and `api-oyster.kaspa.com`.
5. Run prod HTTPS smoke checks for `/healthz`, quote, support-alert, and
   admin-auth before allowing user traffic.
