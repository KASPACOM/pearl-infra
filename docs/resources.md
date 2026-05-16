# Pearl Resource Hub

This file is the quick-start map for Pearl research and KaspaCom app/infrastructure planning. Keep links here current so a new developer/agent can learn Pearl fast without re-discovering sources.

## Core Pearl Links

| Resource | URL | Use |
|---|---|---|
| Pearl website / whitepaper | https://pearlresearch.ai/ | Protocol thesis, Proof-of-Useful-Work, economic framing |
| Pearl ePrint theoretical paper | https://eprint.iacr.org/2025/685.pdf | Formal PoUW construction (low-rank noise, Plonky2 zkSNARK) |
| Pearl GitHub monorepo | https://github.com/pearl-research-labs/pearl | Canonical source for node, wallet, miner, apps |
| Pearl README | https://github.com/pearl-research-labs/pearl/blob/master/README.md | Top-level architecture, build/run commands, ports |
| Pearl Compute Platform | https://compute.pearlresearch.ai/ | Hosted compute/user-facing Pearl platform reference |
| Pearl Explorer | https://explorer.pearlresearch.ai/?network=mainnet | Existing public mainnet explorer UI; use as reference/source before building any explorer-like UI |
| Pearl OTC app ⚠️ community | https://pearl-otc.com/ | Live PRL/USDC marketplace — **third-party / community-built, not operated by Pearl Research Labs**. Useful as a data source and UX reference; treat its authenticated/escrow code as one community implementation, not a protocol standard. |
| Pearl OTC API base ⚠️ community | https://api.pearl-otc.com | Public market/chain endpoints from the same third-party project. Includes `/chain/*` proxy endpoints to Pearl chain data, which are convenient but **community-operated** — for production, run our own indexer or `pearld` instead of depending on this base URL. |
| Pearl Hugging Face org | https://huggingface.co/pearl-ai | Pearl-certified LLMs for vLLM mining/inference |
| Pearl Discord | https://discord.gg/joinpearl | Community + Pearl Research Labs contact channel |
| Pearl support email | support@pearlresearch.ai | Direct contact for Pearl Research Labs |

## Protocol Specifics (whitepaper-verified)

| Property | Value | Source |
|---|---|---|
| Target block time | 194 s | Whitepaper §block parameters |
| Max supply | 2,100,000,000 PRL | Whitepaper §emission |
| Smallest unit | grain = 10⁻⁸ PRL | Whitepaper §units |
| Emission curve | Polynomial decay `R(t) = H/(t+H)` | Whitepaper §emission |
| Difficulty adjustment | WTEMA, τ = 7 days | Whitepaper §difficulty |
| Tip-selection | Heavy-chain rule, threshold `min(work)/4` | Whitepaper §consensus |
| Address type | Taproot only (P2TR, Bech32m, `prl1p…`) | Whitepaper §addresses |
| Re-enabled opcode | `OP_CAT` (520-byte cap, cost `⌈len/64⌉`) | Whitepaper §script |
| Post-quantum opcode | `OP_CHECKXMSSSIG` (stateful, requires careful key management) | Whitepaper §addresses |
| ZK proof system | Plonky2 | Whitepaper §PoUW |
| Useful work | INT8 matrix multiplication with low-rank noise; future BF16/FP8/FP4 | Whitepaper §matmul |
| Header size | 116 bytes | Whitepaper §block |
| Cert size cap | ~65 KB | Whitepaper §block |
| Timestamp future-time limit | 5 minutes (vs Bitcoin's 120) | Whitepaper §timestamp |
| Launch | April 2025 (node code public + vLLM plugin + Llama 3.3 70B) | Whitepaper §status |

## Learning Path For New Developers

1. `docs/development/local-dev-guide.md` — clone, submodule, toolchain, local node/wallet, public API commands.
2. `docs/development/pearl-chain-primer.md` — how Pearl works: UTXO, node/wallet split, RPCs, mining, SPV, no current EVM.
3. `docs/development/pearl-app-development.md` — app patterns: Pearl Pay, wallet SDK, chain-data adapters, OTC, compute marketplace.
4. `docs/next-steps.md` — current implementation recommendation.
5. `docs/openspec/pearl-infra-ecosystem/tasks.md` — task checklist before coding.

## GitHub Source Map

| Component | GitHub URL | Local research path | Why it matters |
|---|---|---|---|
| Full Pearl repo | https://github.com/pearl-research-labs/pearl | `/root/.openclaw/workspace/research/pearl` | Upstream source of truth |
| Node / `pearld` | https://github.com/pearl-research-labs/pearl/tree/master/node | `research/pearl/node` | Full node, P2P, chain validation, JSON-RPC |
| Node JSON-RPC docs | https://github.com/pearl-research-labs/pearl/blob/master/node/docs/json_rpc_api.md | `research/pearl/node/docs/json_rpc_api.md` | Chain-data adapter contract |
| Node mining docs | https://github.com/pearl-research-labs/pearl/blob/master/node/docs/mining.md | `research/pearl/node/docs/mining.md` | Mining address/node behavior |
| Node config docs | https://github.com/pearl-research-labs/pearl/blob/master/node/docs/configuration.md | `research/pearl/node/docs/configuration.md` | Runtime flags/config |
| Wallet / `oyster` | https://github.com/pearl-research-labs/pearl/tree/master/wallet | `research/pearl/wallet` | HD wallet daemon, signing, balances, tx history |
| Wallet RPC docs | https://github.com/pearl-research-labs/pearl/blob/master/wallet/rpc/documentation/api.md | `research/pearl/wallet/rpc/documentation/api.md` | Wallet SDK contract: address/fund/sign/publish |
| SPV light client | https://github.com/pearl-research-labs/pearl/tree/master/spv | `research/pearl/spv` | Future browser/mobile/light wallet reference |
| Apps monorepo | https://github.com/pearl-research-labs/pearl/tree/master/apps | `research/pearl/apps` | Website, desktop wallet, shared packages |
| Desktop wallet | https://github.com/pearl-research-labs/pearl/tree/master/apps/apps/pearl-desktop-wallet | `research/pearl/apps/apps/pearl-desktop-wallet` | Existing wallet UX/RPC implementation |
| Desktop wallet README | https://github.com/pearl-research-labs/pearl/blob/master/apps/apps/pearl-desktop-wallet/README.md | `research/pearl/apps/apps/pearl-desktop-wallet/README.md` | Build/run and app structure |
| Wallet RPC client | https://github.com/pearl-research-labs/pearl/blob/master/apps/apps/pearl-desktop-wallet/src/main/services/rpc-client.ts | `research/pearl/apps/apps/pearl-desktop-wallet/src/main/services/rpc-client.ts` | Existing app RPC client pattern |
| Wallet RPC methods | https://github.com/pearl-research-labs/pearl/blob/master/apps/apps/pearl-desktop-wallet/src/main/services/wallet-service/wallet-rpc-methods.ts | `research/pearl/apps/apps/pearl-desktop-wallet/src/main/services/wallet-service/wallet-rpc-methods.ts` | `getnewaddress`, `getbalance`, `sendmany`, etc. |
| Wallet bridge types | https://github.com/pearl-research-labs/pearl/blob/master/apps/apps/pearl-desktop-wallet/src/types/app-bridge.ts | `research/pearl/apps/apps/pearl-desktop-wallet/src/types/app-bridge.ts` | Frontend wallet API shape |
| Network config | https://github.com/pearl-research-labs/pearl/blob/master/apps/apps/pearl-desktop-wallet/src/main/config/network-config.ts | `research/pearl/apps/apps/pearl-desktop-wallet/src/main/config/network-config.ts` | Mainnet/testnet ports/prefixes/peers |
| Blockbook client | https://github.com/pearl-research-labs/pearl/blob/master/apps/apps/pearl-desktop-wallet/src/main/clients/blockbook-client.ts | `research/pearl/apps/apps/pearl-desktop-wallet/src/main/clients/blockbook-client.ts` | Explorer fee/source endpoint reference |
| Address validation package | https://github.com/pearl-research-labs/pearl/tree/master/apps/packages/pearl-address-validation | `research/pearl/apps/packages/pearl-address-validation` | SDK address validation candidate |
| Miner root | https://github.com/pearl-research-labs/pearl/tree/master/miner | `research/pearl/miner` | vLLM mining workspace |
| Pearl gateway | https://github.com/pearl-research-labs/pearl/tree/master/miner/pearl-gateway | `research/pearl/miner/pearl-gateway` | Miner ↔ node bridge |
| vLLM miner | https://github.com/pearl-research-labs/pearl/tree/master/miner/vllm-miner | `research/pearl/miner/vllm-miner` | Pearl-certified LLM serving/mining |
| Python mining bindings | https://github.com/pearl-research-labs/pearl/tree/master/py-pearl-mining | `research/pearl/py-pearl-mining` | Python integration reference |
| ZK PoW | https://github.com/pearl-research-labs/pearl/tree/master/zk-pow | `research/pearl/zk-pow` | Proof/certificate research |

## Hugging Face Model Resources

| Model | URL | Notes |
|---|---|---|
| Llama 3.1 8B Pearl | https://huggingface.co/pearl-ai/Llama-3.1-8B-Instruct-pearl | Pearl-certified vLLM mining/inference model; lower hardware entry point |
| Llama 3.3 70B Pearl | https://huggingface.co/pearl-ai/Llama-3.3-70B-Instruct-pearl | Pearl-certified large model; benchmarked with 4xH200 in model card |
| Gemma 4 31B Pearl | https://huggingface.co/pearl-ai/Gemma-4-31B-it-pearl | Pearl-certified Gemma-family model; supports inference-only or mining stack paths |
| HF API author listing | https://huggingface.co/api/models?author=pearl-ai | Machine-readable list of current Pearl models |

## Public Data/API Endpoints

### Pearl OTC Public API ⚠️ third-party

> **Important:** `pearl-otc.com` is a **community-built** marketplace, **not** operated by Pearl Research Labs. Its `/chain/*` endpoints are convenient as a quick read-only data source for early dev work, but for production we should not depend on it — either talk to `pearld` directly or run our own indexer. Treat anything under this base URL as one independent project's offering.

Base: `https://api.pearl-otc.com`

| Endpoint | Purpose |
|---|---|
| `/stats` | Marketplace stats: users, active offers, completed trades, volume, settlement time |
| `/offers` | Active buy/sell PRL offers |
| `/trades/public?limit=5` | Recent public trades |
| `/trades/public/stats?window_days=30` | Trade stats over a window |
| `/trades/public/all?limit=3&offset=0` | Paginated public trades |
| `/chain/stats` | Chain height, difficulty, mempool, peers, tip age |
| `/chain/recent-blocks?limit=3` | Recent blocks |
| `/chain/recent-txs?limit=10` | Recent transactions |
| `/chain/hashrate-history?window=24h` | Hashrate history |
| `/chain/top-miners?window_blocks=500&limit=10` | Top miners |
| `/chain/circulating-supply` | Supply data |
| `/tools/leaderboard?top_n=10` | Leaderboard data |
| `/health` | API health |

Authenticated/operational endpoints discovered but not for public scraping without proper auth/approval:

- `/auth/register`
- `/auth/login`
- `/auth/me`
- `/offers/mine`
- `/trades/mine`
- `/trades/`
- `/me/notifications`
- `/admin/trades`
- `/admin/users`
- `/admin/fees`
- `/admin/audit`

### Blockbook-style Endpoints Seen In Wallet

| Network | Base URL | Source |
|---|---|---|
| Mainnet | `http://blockbook.pearlresearch.ai` | desktop wallet Blockbook client |
| Testnet | `http://blockbook.testnet.pearlresearch.ai` | desktop wallet Blockbook client |

Known endpoint pattern:

- `/api/v1/estimatefee/{numBlocks}`
- Blockbook-style transaction broadcast is usually `POST /api/v2/sendtx/`; verify on Pearl testnet before depending on it.

## Quick Data Commands

Use these for low-cost snapshots. Do not add auth tokens or secrets.

```bash
curl -s https://api.pearl-otc.com/stats | jq .
curl -s https://api.pearl-otc.com/offers | jq '.[0:5]'
curl -s 'https://api.pearl-otc.com/trades/public?limit=5' | jq .
curl -s https://api.pearl-otc.com/chain/stats | jq .
curl -s 'https://api.pearl-otc.com/chain/recent-blocks?limit=3' | jq .
curl -s 'https://api.pearl-otc.com/chain/top-miners?window_blocks=500&limit=10' | jq .
curl -s 'https://huggingface.co/api/models?author=pearl-ai' | jq 'map({id, downloads, likes, tags})'
```

## Local Research Commands

```bash
# Upstream commit inspected during bootstrap
git -C /root/.openclaw/workspace/research/pearl rev-parse HEAD

# Find wallet API usage
rg -n "getNewAddress|getBalance|sendFromDefaultAccount|sendmany|validateAddress|walletpassphrase" \
  /root/.openclaw/workspace/research/pearl/apps/apps/pearl-desktop-wallet/src

# Find chain RPC methods
sed -n '150,220p' /root/.openclaw/workspace/research/pearl/node/docs/json_rpc_api.md

# Find wallet fund/sign/publish docs
sed -n '585,820p' /root/.openclaw/workspace/research/pearl/wallet/rpc/documentation/api.md

# Find script/data primitives
rg -n "OP_RETURN|NullDataTy|WitnessV1TaprootTy|Tapscript|PayToAddrScript" \
  /root/.openclaw/workspace/research/pearl/node/txscript \
  /root/.openclaw/workspace/research/pearl/wallet/waddrmgr
```

## App Research Questions

Before building product code, answer these in docs:

1. What does Pearl support natively: payments, OP_RETURN/data, Taproot scripts, multisig, timelocks?
2. What requires indexer/off-chain state: offers, inscriptions, merchant invoices, model marketplace, leaderboards?
3. What requires wallet signing: OTC execution, payment checkout, data anchoring, future dapp connector?
4. What is safe for read-only public APIs vs authenticated/custodial flows?
5. Which first product creates real usage before an extension wallet exists?

## Current Product Direction

- First build infra, not a standalone browser wallet.
- Build app demand before extension wallet: chain data adapters, Pearl Pay, OTC market tools, compute marketplace interfaces. Do not duplicate Pearl’s public explorer UI unless a specific gap is proven.
- Treat Pearl as UTXO-first unless future research proves smart-contract-like primitives.
