# Pearl — Team Briefing

Last verified: **2026-05-16** (re-verify before the meeting: `curl -s https://api.pearl-otc.com/chain/stats | jq .`)

This is a meeting-ready briefing on Pearl: what it is, how it works, what you can build on it, and what KaspaCom should consider parking as a product bet. Numbered for easy reference in the room.

> **\* About pearl-otc.com:** the `Pearl OTC*` references below are to a **third-party / community-built** marketplace at `pearl-otc.com` — **not** an official Pearl Research Labs product. It happens to expose chain-data proxy endpoints that are convenient as a data source for early work, and its volume is the best public signal of PRL market demand, but treat it as one independent community effort rather than a protocol primitive. For production data we should run `pearld` ourselves or our own indexer.

---

## 1. The one-paragraph version

Pearl is a new Bitcoin-style UTXO L1 launched by **Pearl Research Labs** in April 2025. Its differentiator: **Proof-of-Useful-Work**. Instead of burning hashes, miners run **LLM inference matmuls** (INT8 matrix multiplications), prove the work with a **zkSNARK (Plonky2)**, and the same compute that secures the chain serves real AI workloads. The protocol is a hardened fork of `btcd`/`btcwallet` — Taproot-only, post-quantum opcode (XMSS), OP_CAT re-enabled, 194-second blocks, 2.1B PRL max supply, polynomial-decay emission. **Live, mining, ~54k blocks deep, ~$1.7M USDC of OTC* volume.** No EVM, no smart contracts, no bridges, no extension wallet — that's the opportunity surface.

---

## 2. How it works (5 bullets)

1. **Block production:** miner gets a template from `pearld`, picks INT8 matrices `A`, `B`, adds low-rank noise `E`, `F` for ASIC-resistance, computes `C = (A+E)·(B+F)`, divides output into tiles, hashes each tile with BLAKE3 against the difficulty target, opens the qualifying tiles, generates a Plonky2 zkSNARK proving the opens are correct, and submits the block + cert (~65 KB cert size cap).
2. **Validation:** every full node verifies the zkSNARK in milliseconds (succinct), not the full matmul. So a 70B-parameter inference can secure a block, but verification is cheap.
3. **Tip selection:** longest **work** chain, with a heavy-chain rule — a competitor only displaces the current tip if its excess work exceeds `min(work_a, work_b)/4`. Smoother than Bitcoin.
4. **Difficulty:** WTEMA, τ = 7 days. No 2016-block step. Block-time variance should be tighter than Bitcoin once chain matures.
5. **Addresses & script:** Taproot-only (`prl1p…` Bech32m). OP_CAT enabled. OP_CHECKXMSSSIG for post-quantum sigs. Otherwise the script VM is Bitcoin-class — **no general computation**.

---

## 3. Speed, supply, current state

| Metric | Value | Source |
|---|---|---|
| Target block time | 194 s | whitepaper |
| Observed avg block time | ~92 s (light load) | `api.pearl-otc.com/chain/stats` |
| Block subsidy now | ~2753 PRL | `api.pearl-otc.com/chain/circulating-supply` |
| Current height | ~54,000 | live |
| Circulating supply | ~161M PRL (7.7% of max) | live |
| Max supply | 2,100,000,000 PRL | whitepaper |
| Emission shape | polynomial decay `R(t) = H/(t+H)` | whitepaper |
| Connected peers (public node) | 8 | live |
| Mempool size | 1 tx, 269 bytes | live |
| OTC* users (lifetime) | 1,759 | `/stats` |
| OTC* trades completed | 532 | `/stats` |
| OTC* lifetime volume (USDC) | $1,682,131 | `/stats` |
| 24h OTC* volume | 833,434 PRL / ~128 trades | `/stats` |
| Avg OTC* settlement time | ~40 minutes | `/stats` |
| OTC* active offers | 68 | `/stats` |
| OTC* settlement chain (for USDC leg) | Arbitrum | `/trades/public` |
| Pearl-certified models on HF | 3 (Llama 8B, Llama 70B, Gemma 31B) | `huggingface.co/pearl-ai` |
| 70B model lifetime downloads | 126,565 | HF API |
| 8B model lifetime downloads | 87,908 | HF API |

**Read-out:** chain is real, market is small but real, mining is live, hashrate is non-trivial (~7.3 EH/s effective).

---

## 4. What languages / how to build

Pearl itself is a polyglot — but **KaspaCom doesn't need to touch any of that.**

| Layer | Language | KaspaCom touches? |
|---|---|---|
| `pearld` node | Go 1.26+ | No |
| `oyster` wallet daemon | Go | No (we call its gRPC) |
| `zk-pow` proof system | Rust | No |
| `vllm-miner` | Python + CUDA | No unless we run a miner |
| Desktop wallet | TypeScript/Electron | Reference only |
| **Our apps** | **TypeScript (NestJS / Angular)** | **Yes — all of them** |

To build on Pearl we just need typed clients for:
- `pearld` JSON-RPC (chain data, broadcast)
- `oyster` gRPC (wallet ops) — *or* sign Taproot transactions ourselves with `secp256k1` + BIP340 Schnorr libs (cleaner for our backend services, removes a daemon dep).
- Blockbook-style indexer endpoints (fees, address history) — already exists at `blockbook.pearlresearch.ai`.

This is **infrastructure work, not protocol work**. No Solidity audits, no EVM gas modeling, no DA layer integration — just clean Bitcoin-style integration.

---

## 5. What's already built upstream (don't rebuild)

- ✅ Full node, wallet daemon, CLI, SPV light client.
- ✅ Public mainnet + testnet + testnet2.
- ✅ Public block explorer (`explorer.pearlresearch.ai`).
- ✅ OTC* marketplace with public API.
- ✅ Blockbook-style indexer endpoints.
- ✅ Desktop wallet (Electron).
- ✅ Hugging Face certified model org.
- ✅ vLLM miner + Python bindings.

## 6. What's MISSING (the surface area for us)

- ❌ **No browser-extension wallet** (no MetaMask equivalent).
- ❌ **No mobile wallet.**
- ❌ **No WalletConnect / dapp-injection standard.**
- ❌ **No published TypeScript SDK** for app developers.
- ❌ **No Pearl Pay / merchant payment links / hosted checkout.**
- ❌ **No KRC-20-style token standard** (UTXO chain, no contracts — would be a new standard).
- ❌ **No EVM bridge** for moving PRL to Arbitrum/ETH (OTC* settles via off-chain escrow on Arbitrum, not a bridge).
- ❌ **No compute marketplace control plane** beyond the raw miner stack.
- ❌ **No fiat on-ramp.**

---

## 7. Candidate use cases (rank-ordered, our take)

The repo's current recommendation is **Pearl Pay + chain-data SDK foundation first**. Here's a broader option set with payoff/cost framing for the meeting. **Don't commit to any of these in the meeting — collect feedback, then decide.**

### Tier 1 — Infrastructure (low risk, compounds value)
1. **Pearl SDK (TypeScript)** — `pearl-rpc` + `pearl-sdk` packages. Address validation, typed JSON-RPC, typed wallet adapter, payment request schema, tx lifecycle types. **Every other product on this list depends on this.**
2. **Chain-data API service** — normalized REST over `pearld` + Blockbook. `/chain/stats`, `/blocks/recent`, `/tx/:txid`, `/address/:address`, `/miners/top`. Used by our own future apps and resellable as a Pearl data provider.
3. **Pearl Pay** — payment links, invoices, merchant callbacks, confirmation tracking. Genuine product, drives real on-chain demand for PRL, mirrors our other payment work.

### Tier 2 — Wallets & UX
4. **Browser-extension wallet** — only after Tier 1 ships and we have at least one web app that needs signing. Otherwise we're building a wallet with no dapps.
5. **Mobile wallet (PWA first, native later)** — same dependency.

### Tier 3 — DeFi-adjacent on UTXO
6. **OTC* market mirror / aggregator** — tap `api.pearl-otc.com`, normalize, plug into our existing market UIs. Cheap to ship, useful as a market-data widget.
7. **PRL ↔ USDC custodial bridge** (Arbitrum) — Pearl-OTC* already does this trustfully; we could either compete or partner.
8. **Token-issuance standard on Pearl** — propose a "KRP-20" using OP_RETURN + indexer convention (like Kasplex KRC-20 on Kaspa, BRC-20 on BTC). High strategic value, very high indexer cost. Talk to Pearl Research Labs first — they may already be planning one.

### Tier 4 — Compute marketplace
9. **Compute marketplace control plane** — model catalog, GPU-operator registration, inference routing, metering, PRL settlement. This is *the* Pearl-native thesis. But two big risks: (a) we need real GPU operators on-board, (b) we need real inference demand. Probably a partnership with Pearl Research Labs makes more sense than going solo.

### Tier 5 — Speculative / research
10. **Data-anchoring service** — receipt hashes / job-result commitments via OP_RETURN. Verify size limits first. Low-revenue but a nice differentiator.
11. **Post-quantum-signing demo** using OP_CHECKXMSSSIG — research credit, not a product.
12. **AI-agent payment rail** — agents pay each other in PRL for inference. Conceptually clean, requires real agent demand.

---

## 8. Hard truths to acknowledge in the room

- Pearl is **young** (~54k blocks, ~6 months since launch). Reorg behavior under load is not battle-tested.
- Liquidity is **small** ($1.7M lifetime). Building a token-issuance standard with $0 liquidity is hard.
- The **PoUW security argument is novel** — economically it makes ASICs uneconomic (since they'd lose useful-work value), but the cryptographic security of "low-rank noise → ASIC-hard" is not yet peer-validated at scale. We are not protocol auditors; we shouldn't pretend we have an opinion. Trust the ePrint paper, build product, watch closely.
- **No EVM means no fast-imitation playbook.** We can't fork Uniswap or Aave. Every product we build is a native build.
- **The compute-marketplace thesis is the moonshot but also the hardest.** Demand and supply both need to exist. We're better positioned for the Pay/wallet/SDK rails first.

---

## 9. Decision points for the meeting

Ask the team to commit on these. Default-good answers in parentheses.

1. **Public or private repo?** (Public — it's already public, keep it public, attracts contributors.)
2. **Build SDK first vs. Pearl Pay first?** (SDK first — Pay needs it.)
3. **Do we run a public Pearl node?** (For the OTC desk MVP, yes: run our own `pearld` + indexer from day one; Pearl OTC*'s API + Blockbook are fallback/cross-check sources.)
4. **Do we engage Pearl Research Labs directly?** (Yes — via Discord `discord.gg/joinpearl`. Coordinate on token-standard, faucet, possible co-marketing.)
5. **Is there budget for a GPU operator to demo inference?** (TBD — only if Tier-4 compute marketplace is committed.)
6. **Who owns the project on the KaspaCom side?** (TBD — needs a clear lead.)
7. **Timeline expectation?** (Phase 1 = SDK + chain-data API in 2–4 weeks. Phase 2 = Pearl Pay MVP in 4–6 weeks after that. Phase 3 = wallet in another 4–8 weeks.)
8. **Should the repo move from `marciano147/Pearl-infra-ecosystem` to `KASPACOM/pearl-infra`?** (Recommended yes — moves it under org governance.)

---

## 10. Verification commands to run live in the meeting

Run these on a laptop and put the output on screen — keeps the conversation grounded in reality.

```bash
# Pearl chain is alive
curl -s https://api.pearl-otc.com/chain/stats | jq .

# How much PRL exists today
curl -s https://api.pearl-otc.com/chain/circulating-supply | jq .

# Real money is flowing
curl -s https://api.pearl-otc.com/stats

# Who's mining
curl -s 'https://api.pearl-otc.com/chain/top-miners?window_blocks=500&limit=5' | jq .

# Pearl-certified models
curl -s 'https://huggingface.co/api/models?author=pearl-ai' | python3 -c "import json,sys; [print(f\"  {m['id']:55s} dl={m.get('downloads',0)}\") for m in json.load(sys.stdin)]"
```

---

## 11. References

- Whitepaper / site: `https://pearlresearch.ai/`
- Theoretical paper (PoUW + Plonky2): `https://eprint.iacr.org/2025/685.pdf`
- GitHub: `https://github.com/pearl-research-labs/pearl`
- Explorer: `https://explorer.pearlresearch.ai/?network=mainnet`
- OTC*: `https://pearl-otc.com/` — API `https://api.pearl-otc.com`
- HF models: `https://huggingface.co/pearl-ai`
- Compute platform: `https://compute.pearlresearch.ai/`
- Community: `discord.gg/joinpearl`
- Our repo: `https://github.com/marciano147/Pearl-infra-ecosystem`
- Our chain primer: `docs/development/pearl-chain-primer.md`
- Our app dev guide: `docs/development/pearl-app-development.md`
- Our glossary: `docs/GLOSSARY.md`
- Our FAQ: `docs/FAQ.md`
- LLM/agent context: `AGENTS.md`
