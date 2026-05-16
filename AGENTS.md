# AGENTS.md — Pearl Infra Ecosystem (LLM context, single page)

This file is the first thing an LLM or new dev should read. It is intentionally dense, scannable, and link-heavy. Treat every section as a contract: do not act past the boundary it sets.

## What this repo is (one line)

KaspaCom's planning + integration repo for building apps on **Pearl** — a Bitcoin-style UTXO L1 with Proof-of-Useful-Work (matrix multiplication + zk proofs) used as native AI compute.

## What Pearl is (one line)

A fork of `btcd`/`btcwallet` with **Taproot-only addresses, XMSS post-quantum signatures, OP_CAT enabled, 194-second blocks, 2.1B PRL max supply**, and a PoUW scheme where miners produce zk-proofs (Plonky2) of valid INT8 matrix multiplications — i.e. the "useful work" is LLM inference / matmul.

## Mental model in 6 lines

```text
Users / Apps
   │ wallet SDK, payment request, signing
   ▼
oyster (wallet, gRPC) ◄──ws──► pearld (full node, JSON-RPC) ◄──P2P──► network
                                       ▲
miner (vllm-miner) ─► pearl-gateway ─► │ getblocktemplate / submitblock + zkSNARK proof
```

- `pearld` = chain, mempool, validation, RPC, mining templates.
- `oyster` = HD wallet, keys, balances, fund/sign/publish.
- `spv` = light client (compact block filters).
- `pearl-gateway` + `vllm-miner` = useful-work mining stack (vLLM serving Pearl-certified Llama/Gemma models).

## What Pearl is NOT (do not assume)

- ❌ Not EVM. No Solidity, no Vyper, no WASM contracts, no ERC-20.
- ❌ Not account-based — UTXO only.
- ❌ Not turing-complete. Bitcoin-style stack VM (with OP_CAT, no general computation).
- ❌ No native bridges, no L2, no AMM/lending/NFT-in-EVM-sense.
- ❌ Not a wallet/extension target yet — no dapp surface needs signing.

Any task that assumes the above is wrong. Verify against `upstream/pearl/` before continuing.

## Languages, by layer

| Layer | Language | Why |
|---|---|---|
| Node (`pearld`), wallet (`oyster`), CLI (`prlctl`) | Go (1.26+) | forked from btcd/btcwallet |
| ZK proof system (`zk-pow`) | Rust | Plonky2 prover/verifier |
| Mining glue (`py-pearl-mining`) | Python 3.12 + `uv` | bindings to miner |
| vLLM miner | Python (vLLM) + CUDA | GPU inference |
| Desktop wallet | TypeScript / Electron + `pnpm` | apps/apps/pearl-desktop-wallet |
| **KaspaCom apps on Pearl** | **TypeScript (NestJS / Angular)** | matches the rest of the stack; talks to pearld/oyster over JSON-RPC/gRPC; no chain VM to target |

## Speed / throughput / fees

- Block time: **~194s target** (we observe ~92s avg on testnet/early mainnet — see `/chain/stats`).
- Throughput: Bitcoin-like (no sharding, no DAG). Treat as low-TPS payment rail, not high-frequency DEX.
- Fees: first-price auction, Bitcoin-style. Estimate via Blockbook `/api/v1/estimatefee/{numBlocks}`.
- Finality: probabilistic. Use confirmation thresholds for payments (suggest ≥3 for low-value, ≥6 for high-value, mirroring BTC practice; tune after observing reorg behavior).

## Live chain snapshot (verify with `curl`, do not trust this file)

```bash
# These /chain/* endpoints are convenient but proxied by pearl-otc.com,
# which is a COMMUNITY-built marketplace (not operated by Pearl Research Labs).
# Use for quick reads only; for production, talk to pearld or our own indexer.
curl -s https://api.pearl-otc.com/chain/stats | jq .
curl -s https://api.pearl-otc.com/chain/circulating-supply | jq .
```

As of repo last-verified date (see `docs/team-briefing.md`):
- Chain is **live and mining**, height ~54k, 8 peers, mempool near-empty.
- Circulating ~161M PRL of 2.1B (~7.7% emitted).
- Halving on a polynomial-decay schedule (~1/t²), next halving in ~2,500 blocks.
- Community-run `pearl-otc.com` marketplace has ~1,750 users, ~530 trades, ~$1.68M USDC lifetime — useful market signal, **not** an official Pearl Research Labs product.

## Multisig / escrow / advanced script

See [`docs/development/escrow-multisig-on-pearl.md`](docs/development/escrow-multisig-on-pearl.md). Short version: Pearl is a Taproot fork, so multisig and escrow are native via **tapscripts** (`OP_CHECKSIGADD`, CLTV/CSV, MuSig2 for cooperative-path one-signature spends). `OP_CAT` is re-enabled, enabling covenants. `OP_CHECKXMSSSIG` provides post-quantum signing but is **stateful** — research-grade only.

## How to build on Pearl (decision tree)

```
Need to read chain state?           → use https://api.pearl-otc.com (public) or pearld JSON-RPC (self-hosted)
Need to make a payment?             → oyster wallet RPC: NextAddress → FundTransaction → SignTransaction → PublishTransaction
Need to watch confirmations?        → poll node by txid OR subscribe to oyster TransactionNotifications
Need general computation?           → NOT on-chain. Do it off-chain, settle PRL via payment.
Need a "smart contract"?            → STOP. Pearl has no general contract VM. Reframe as off-chain logic + on-chain settlement.
Need post-quantum signing?          → OP_CHECKXMSSSIG is available — but novel; security-review required.
Need to embed data on-chain?        → OP_RETURN/null-data may work — verify in upstream/pearl/node/txscript before promising it to a product.
```

## Repo map

```
README.md                                       # purpose, non-goals, current phase
CONTRIBUTING.md                                 # goal-based execution checklist
AGENTS.md                                       # this file — LLM context
docs/
  resources.md                                  # link hub + live API endpoints
  upstream-manifest.md                          # pinned upstream commit + mapped paths
  GLOSSARY.md                                   # Pearl-specific terms
  FAQ.md                                        # builder questions
  team-briefing.md                              # meeting prep / current state
  next-steps.md                                 # phase plan
  development/
    README.md
    local-dev-guide.md                          # clone, build, run a local node
    pearl-chain-primer.md                       # how Pearl works (chain-level)
    pearl-app-development.md                    # how to build apps on it
  research/
    pearl-app-thesis.md                         # what app shapes to chase
  openspec/pearl-infra-ecosystem/               # proposal + design + 5 specs + tasks
upstream/pearl/                                 # pinned git submodule of pearl-research-labs/pearl
```

## Hard rules (apply every task)

1. **OpenSpec first.** Do not write product code without a scoped task in `docs/openspec/pearl-infra-ecosystem/tasks.md`.
2. **No secrets.** Never commit `.env`, wallet seeds, private keys, RPC passwords, generated certs.
3. **No mainnet custody** until explicitly approved. Use simnet/regtest/testnet.
4. **Document upstream assumptions** with source-file path AND commit SHA.
5. **Don't duplicate the public explorer** at `explorer.pearlresearch.ai` — build adapters/widgets that fill gaps.
6. **Don't build a browser extension first.** No dapp needs signing yet.
7. **Idempotent payment callbacks.** Reorgs happen. Confirmation thresholds + replay-safe merchant webhooks.

## When in doubt

- **About to write code?** Start with [`docs/development/quickstart.md`](docs/development/quickstart.md) — the agent build manual. Deps, network config, copy-paste-ready hello-world examples for read-chain / derive-address / build-sign-tx / broadcast.
- Read `docs/development/pearl-chain-primer.md` (chain mechanics).
- Read `docs/development/pearl-app-development.md` (KaspaCom app patterns).
- Read `docs/development/escrow-multisig-on-pearl.md` (multisig / escrow / tap-trees).
- Read `docs/FAQ.md` (common build questions).
- Read `docs/GLOSSARY.md` (Pearl jargon).
- Grep `upstream/pearl/` for the actual code.

## Upstream drift (check before relying on details)

```bash
git -C upstream/pearl rev-parse HEAD
# expected (pinned): 0c8cef72da75d10ffd52ac20d3c0b075d9d9f1f7
git ls-remote https://github.com/pearl-research-labs/pearl HEAD
# current: see live result
```

If upstream has moved meaningfully past the pin, open a task to bump the submodule **deliberately** — do not silently `git submodule update --remote`.
