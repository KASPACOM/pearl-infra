# Pearl Builder FAQ

Practical "I want to build X — can I?" questions, with concrete answers. Keep this file honest: if the answer is "we don't know yet," say so. If new evidence overrides an entry, update it with date + source.

---

### How do I build multisig wallets or escrow on Pearl?

Native to the chain — Pearl is a Taproot fork. Concrete answer + 2-of-3 escrow walkthrough + 6–10 week effort estimate: see [`docs/development/escrow-multisig-on-pearl.md`](development/escrow-multisig-on-pearl.md). One-line summary: tapscript with `OP_CHECKSIGADD`, optional MuSig2 key-path for one-signature cooperative spends, CSV timelock as auto-refund fallback. Built in TypeScript by wrapping `bitcoinjs-lib` v6+ with Pearl's HRP (`prl`) and signing with BIP340 Schnorr.

---

### Can I write smart contracts on Pearl?

**No, not in the EVM/Solidity sense.** Pearl is a Bitcoin-style UTXO chain with a stack-based, non-Turing-complete script VM. There is no contract deployment RPC, no account state, no `eth_call` equivalent, no Solidity/WASM/Move.

What you **can** do:
- Use Taproot script paths (multisig, hashlocks, timelocks).
- Use `OP_CAT` (re-enabled in Pearl) for some covenant-style patterns.
- Use `OP_CHECKXMSSSIG` for post-quantum signatures (novel — security review required).
- Embed arbitrary data via `OP_RETURN` / null-data outputs (verify size and relay policy in `upstream/pearl/node/txscript` before promising it to a product).

If your product spec requires arbitrary computation, **the computation lives off-chain, and Pearl is used for settlement (PRL payment) and/or commitment (data anchor hash).**

---

### What languages can I use to build apps on Pearl?

Any language that can speak HTTP/JSON-RPC and gRPC. Pearl itself is written in Go (node, wallet, CLI), Rust (zk-pow), Python (mining bindings, vLLM), and TypeScript (desktop wallet) — but you don't have to use any of those to build *apps*.

For KaspaCom: **TypeScript (NestJS backend, Angular frontend)** is the right default — matches the rest of our stack, and Pearl exposes everything we need over JSON-RPC.

You will need:
- A typed RPC client for `pearld` (we plan to build this as `packages/pearl-rpc`).
- A typed adapter for `oyster` wallet gRPC, OR you sign transactions yourself with a secp256k1+Schnorr lib (Taproot is BIP340-compatible).

---

### How fast is Pearl?

- Target block time: **194 seconds (~3 min 14 s)**.
- Mempool throughput: Bitcoin-like, so **single-digit TPS** at sustained load.
- This is a **payment / settlement rail**, not a high-frequency DEX backbone.
- Difficulty adjusts continuously via WTEMA (smoother than Bitcoin's step adjustment), so block-time variance should be lower than BTC's once the chain matures.

If your product needs sub-second UX, the chain confirmation is the slow part — show "pending" optimistically, finalize on N confirmations.

---

### How many confirmations should I require for a payment?

There is no canonical answer yet because Pearl is young and reorg behavior in the wild is not fully characterized. Sensible starting points, mirroring BTC practice:

| Payment value (USDC-equivalent) | Confirmations |
|---|---|
| < $10 | 1 (or accept first-seen for UX, settle on 1) |
| $10 – $1,000 | 3 |
| $1,000 – $10,000 | 6 |
| > $10,000 | manual review + 12 |

**Tune after observing real reorg depth on mainnet.** Heavy-chain rule (`work_diff > min/4`) reduces last-block flapping but doesn't eliminate it.

---

### Can I run a Pearl node?

Yes. Build from the upstream submodule:

```bash
cd upstream/pearl
task build:blockchain
```

Toolchain: Go 1.26+, Rust stable, C/C++ compiler, `task` runner. See `docs/development/local-dev-guide.md` §3-§5.

For mining: also Python 3.12 + `uv`, vLLM, and a supported NVIDIA GPU (Llama-3.3-70B-Pearl needs ~4×H200; Llama-3.1-8B-Pearl is more accessible).

For **app development**, you don't need to run a node at first — use the public OTC/Blockbook endpoints. Self-host later if reliability or custom indexing becomes a requirement.

---

### Is there an SDK / wallet connector / WalletConnect equivalent?

Not yet. The desktop wallet exists (`apps/apps/pearl-desktop-wallet`) and exposes an internal RPC pattern, but there is no published browser-extension wallet and no `window.pearl` dapp injection standard.

This is **the gap KaspaCom is positioned to fill** — but only after one or more apps create the demand. See `docs/development/pearl-app-development.md` §5 for the connector interface we've sketched.

---

### What's already built that I shouldn't re-build?

Don't duplicate:
- **Block explorer** — `https://explorer.pearlresearch.ai` exists. Build adapters/widgets that fill specific app gaps, not a competing UI.
- **OTC market** — `https://pearl-otc.com` exists with public API at `https://api.pearl-otc.com`. Use it as a data source.
- **Desktop wallet** — exists upstream. Don't fork unless KaspaCom has a specific reason.
- **Mining stack** — `pearl-gateway` + `vllm-miner` exist. Build dashboards on top, not a competing miner.

Do build:
- App-facing chain-data API (normalized, typed, cached).
- Wallet SDK primitives (address validation, payment requests, tx lifecycle, signing connector interface).
- Pearl Pay (payment links, invoices, merchant callbacks).
- Compute marketplace control plane (model catalog, operator registration, metering, PRL settlement).
- Browser/mobile wallet — **after** an app needs it.

---

### What's the economic model?

- Max supply: **2,100,000,000 PRL** (1000× Bitcoin's 21M, scaled).
- Emission: polynomial decay `R(t) = H/(t+H)` — early issuance is high, declines smoothly.
- At ~54k blocks, subsidy is ~2753 PRL/block.
- Fees: Bitcoin-style first-price auction, no EIP-1559 base fee.
- ~7.7% of max supply currently in circulation (~161M PRL).

---

### Can I bridge PRL to Ethereum / Solana / Arbitrum?

**Not natively.** No protocol-level bridge. The OTC market settles trades by escrowing PRL on Pearl and USDC on **Arbitrum** (see `https://api.pearl-otc.com/trades/public`) — that's an off-chain escrow flow, not a trustless bridge.

If you want bridged PRL on an EVM chain, that's a **product to build**, not a primitive to call. Custodial escrow + signed-attestation bridge would be the fast version; a real trustless bridge requires either light-client verification or a multi-party trusted setup.

---

### Is PRL listed on a CEX?

Not as of repo's last verification. The most active liquidity is on **`pearl-otc.com`** — but note that's a **community/third-party project**, not an official Pearl Research Labs venue. Lifetime volume ~$1.68M USDC across ~530 trades — small but real. No major CEX listing is documented.

---

### What's the security model for OP_CHECKXMSSSIG?

XMSS is a **stateful** hash-based signature scheme — every private key can only sign a fixed number of times, and reusing a state ("WOTS one-time-key index") leaks key material catastrophically. This is fine for cold-storage HSM-managed keys; it is **dangerous** in any hot-wallet/automated setting that doesn't enforce strict state tracking.

For KaspaCom: **do not use OP_CHECKXMSSSIG in any product code without a written security review.** Treat it as research-grade.

---

### How do I anchor data on-chain (e.g. a receipt hash, a job result hash)?

Likely path: an output with an `OP_RETURN`-style null-data script holding ≤ 80 bytes (Bitcoin default; Pearl-specific limit not yet verified).

Before promising this in a product:
1. Verify the relay policy in `upstream/pearl/node/mempool/policy.go` (or equivalent).
2. Verify the standard-script test in `upstream/pearl/node/txscript`.
3. Verify Pearl's public explorer renders the output sensibly.
4. Confirm fee cost is acceptable for your use case.

If all four pass, this is a viable "compute-job-result-hash" or "invoice-commitment" anchor.

---

### Where do I get test PRL?

Run a `simnet` or `regtest` node locally (see `docs/development/local-dev-guide.md` §5) — you mine your own coins on a private chain.

For **testnet** PRL, no public faucet is currently documented. If KaspaCom needs testnet funding, that's a question for Pearl Research Labs via Discord (`discord.gg/joinpearl`).

---

### Is the upstream submodule current?

The repo pins `pearl-research-labs/pearl` at commit `0c8cef72da75d10ffd52ac20d3c0b075d9d9f1f7`. Pearl upstream moves fast. **Check drift before relying on internal details:**

```bash
git -C upstream/pearl rev-parse HEAD
git ls-remote https://github.com/pearl-research-labs/pearl HEAD
```

If they differ, open a deliberate task to bump the pin — don't `git submodule update --remote` silently.
