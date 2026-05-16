# Building Multisig Wallets and Escrow on Pearl

This guide answers "what do we need to write multisig wallets and escrow on Pearl, and how?". It is the answer to the question, scoped to KaspaCom's TypeScript stack.

> **Status:** design + research. Nothing in this doc is implemented in this repo yet. All claims tagged "verify upstream" must be re-checked against `upstream/pearl/` before being relied on in product code.

> **Common misconception:** the constructions in this document do **NOT** require Pearl's `OP_CAT` or any other Pearl-specific feature. They are pure standard Taproot (BIP340/341/342) — they would work identically on Bitcoin mainnet. `OP_CAT` is Pearl's bonus for building *covenant-style* constraints (vaults, recovery wallets, amount-capped outputs) — see [`covenants-on-pearl.md`](covenants-on-pearl.md). Multisig and escrow are a Taproot story; covenants are an OP_CAT story.

## TL;DR

Pearl is a Taproot Bitcoin fork, so multisig and escrow are native primitives — we use **tapscripts** inside a P2TR address. For TypeScript work, we wrap a Taproot library (e.g. `bitcoinjs-lib` v6+) with a Pearl network-config patch, construct tap-trees with **`OP_CHECKSIGADD`** for k-of-n multisig, **CLTV/CSV** for timelocks, and optionally **`OP_CAT`** for covenant-style constructions. Signing uses BIP340 Schnorr. For cooperative-path multisig (best privacy + cost), aggregate keys off-chain via **MuSig2** and spend via key-path so the on-chain footprint looks like a single signature.

Implementation cost on top of the Pearl SDK (Tier 1): roughly **6–10 weeks** for a clean non-custodial 2-of-3 escrow MVP with a watcher service.

---

## 1. What Pearl gives us

| Primitive | Available? | Source / status |
|---|---|---|
| Taproot P2TR addresses | ✅ Yes, only address type | Whitepaper §addresses; verify in `upstream/pearl/node/txscript` |
| Schnorr signatures (BIP340) | ✅ Yes (Taproot requires it) | Verify in `upstream/pearl/wallet` |
| Tapscript leaves (script-path spend) | ✅ Yes (standard Taproot) | Verify upstream |
| `OP_CHECKSIG` / `OP_CHECKSIGADD` (k-of-n multisig in tapscript) | ✅ Yes (BIP342) | Verify upstream |
| `OP_CHECKLOCKTIMEVERIFY` (CLTV — absolute timelock) | ✅ Yes | Verify upstream |
| `OP_CHECKSEQUENCEVERIFY` (CSV — relative timelock) | ✅ Yes | Verify upstream |
| `OP_CAT` (concat — enables covenants) | ✅ **Yes** — Pearl re-enabled it (Bitcoin has not) | Whitepaper §script |
| `OP_CHECKXMSSSIG` (post-quantum signature) | ✅ Yes — but stateful, **not safe for hot wallets / automated escrow** without strict state management | Whitepaper §addresses |
| Legacy `OP_CHECKMULTISIG` (pre-Taproot) | ❌ Removed in tapscript by BIP342 — use `OP_CHECKSIGADD` instead | BIP342 |
| Hashlocks (`OP_SHA256`, `OP_HASH160`) | ✅ Yes (standard Bitcoin opcodes) | Verify upstream |
| MuSig2 key aggregation | ✅ Yes (off-chain, no opcode needed) | Standard Schnorr cryptography |
| FROST (threshold Schnorr) | ✅ Yes (off-chain) | Library choice, not a protocol feature |

## 2. What this gives us at the product level

- **N-of-M cooperative multisig wallets** with single-signature on-chain footprint (via MuSig2 key-path).
- **N-of-M dispute-resolved multisig** with on-chain visible script paths (via `OP_CHECKSIGADD` in tapscript leaves).
- **Time-locked vaults** (CSV/CLTV branches — auto-refund after N blocks, two-factor with delay, etc.).
- **HTLCs** (hash-time-locked contracts → atomic swaps, lightning-style payment channels eventually).
- **2-of-3 buyer/seller/arbiter escrow** (the canonical OTC pattern).
- **Covenant-style vaults** (e.g. "this output can only be spent to a specific list of addresses after a delay") via `OP_CAT` constructions.
- **Payment channels / state channels** (longer-term; needs more research on Pearl's reorg dynamics first).

What we **cannot** do without protocol changes:
- Account-style "approve(spender, amount)" delegations — there is no account model.
- General computation in-script — the VM is stack-based and bounded.
- Sub-second finality — block time is ~194 s; design for multi-block confirmation.

## 3. Where the Pearl-specific complexity lives

Pearl forks `btcd` but it is **not** Bitcoin mainnet — code that "just uses bitcoinjs-lib unchanged" will produce invalid addresses and unsigned-against-the-wrong-chain transactions. The Pearl-specific bits we must override:

| Concern | Bitcoin value | Pearl value (whitepaper) | Implementation impact |
|---|---|---|---|
| Bech32m HRP (human-readable prefix) | `bc` (mainnet), `tb` (testnet) | `prl` (mainnet), Pearl testnet HRPs TBD | Address encoder/decoder must use Pearl HRP |
| Network magic bytes | btc-specific | pearl-specific | RPC client + raw P2P (we don't touch P2P) |
| Block header size | 80 B | 116 B | Light clients (not signing) |
| Sighash flags | BIP341 standard | Same (verify) | Probably no change |
| `OP_CAT` cost rule | n/a (disabled) | `⌈len/64⌉` against budget, 520 B output cap | Affects covenant fee modeling |
| Default fee/relay policy | Bitcoin Core | Pearl `pearld` policy | Must check before relying on non-standard scripts |

Bottom line: a thin **`pearl-script`** package that re-exports a Taproot library with Pearl-correct network params is enough for 90% of multisig/escrow work. The remaining 10% is what touches OP_CAT, OP_CHECKXMSSSIG, or relay policy — those need direct upstream verification.

## 4. What we need to build (TypeScript stack)

```
packages/
  pearl-rpc/            # already on the Phase 1 roadmap — typed pearld JSON-RPC + Blockbook
  pearl-sdk/            # already on Phase 1 — address validation, payment requests, tx lifecycle
  pearl-script/         # NEW — tapscript / tap-tree / address construction for Pearl HRP
  pearl-multisig/       # NEW — MuSig2 + FROST helpers, k-of-n tap-tree templates
  pearl-escrow/         # NEW — 2-of-3 escrow templates, HTLC templates, vault templates
services/
  escrow-service/       # NEW — NestJS service: setup/watch/release/dispute API + watcher worker
  watcher-worker/       # NEW — subscribe to pearld notifications, drive escrow state machine
```

Dependencies (proposed):
- `@bitcoinerlab/secp256k1` or `@noble/secp256k1` — Schnorr signing.
- `bitcoinjs-lib` v6+ — Taproot tap-tree + PSBT support. Patched/wrapped for Pearl HRP.
- `bip-schnorr` / `noble-musig2` (or roll our own MuSig2 — small and well-specified).
- For Go-side cross-checks: lift logic patterns from `upstream/pearl/node/txscript`.

We do **not** need to run `oyster` to sign — we can construct + sign locally with the libraries above, and broadcast via `pearld` JSON-RPC `sendrawtransaction`. Using `oyster` is an alternative (its gRPC has `FundTransaction` / `SignTransaction` / `PublishTransaction`) — fine for early prototypes, less ideal for a backend service because it adds a wallet daemon to operate.

## 5. Worked example — 2-of-3 buyer/seller/arbiter escrow

### 5.1 Roles and keys

- **Buyer** generates `priv_B` → `pub_B`.
- **Seller** generates `priv_S` → `pub_S`.
- **Arbiter** generates `priv_A` → `pub_A` (typically KaspaCom-operated; users do not see this key).

All three publish public keys to the escrow setup endpoint. Private keys never leave their owner.

### 5.2 Tap-tree construction

**Internal key (key-path spend, cooperative)**

`P_internal = MuSig2.aggregate([pub_B, pub_S])`

If buyer and seller agree, they jointly produce a Schnorr signature over the spending tx. Spending via the internal key-path leaves no trace on-chain that this was multisig — looks like a single-sig spend. Cheapest fee, best privacy.

**Script paths (script-path spend, dispute / fallback)**

Three tapscript leaves, hashed into a tap-tree:

- **Leaf A — "buyer + arbiter release":** for cases where seller is unreachable but arbiter sides with buyer paying through (or refund-to-buyer in our typical escrow setup):
  ```
  <pub_B> OP_CHECKSIG
  <pub_A> OP_CHECKSIGADD
  OP_2 OP_EQUAL
  ```

- **Leaf B — "seller + arbiter release":** symmetric, for arbiter siding with seller:
  ```
  <pub_S> OP_CHECKSIG
  <pub_A> OP_CHECKSIGADD
  OP_2 OP_EQUAL
  ```

- **Leaf C — "buyer alone after timeout":** auto-refund if seller and arbiter both go AWOL. `<N>` is the CSV delay (e.g. 4032 blocks ≈ 9 days at 194 s/block).
  ```
  <N> OP_CHECKSEQUENCEVERIFY OP_DROP
  <pub_B> OP_CHECKSIG
  ```

Tap-tree root = `taggedHash("TapTweak", P_internal || merkleRoot(leafA, leafB, leafC))`

**P2TR address** = Bech32m-encode (HRP=`prl`, version=1, key=tweaked_pubkey).

### 5.3 Funding

Escrow service shows the buyer the P2TR address. Buyer's wallet (Pearl desktop wallet, or eventually our extension) sends `amount` PRL to that address. Service polls `pearld` / Blockbook by address until N confirmations.

### 5.4 Happy path (release)

1. Buyer confirms delivery in the UI.
2. Both buyer's and seller's signing devices/agents fetch the unsigned spending tx (paying to seller's withdrawal address).
3. They run **MuSig2 round 1** (nonce exchange) and **round 2** (partial signature exchange) over a websocket coordinated by the escrow service. Crucially, the service **does not learn either private key** — it only relays public commitments and partial signatures.
4. Aggregate signature is placed in the witness; the tx is broadcast via `pearld` `sendrawtransaction`.
5. On-chain it looks like a single-signature P2TR key-path spend. Cheap (~110 vB). Private (no observer can tell this was 2-of-3).

### 5.5 Dispute path

1. Either party opens a dispute via the escrow API.
2. Arbiter reviews evidence off-chain.
3. Arbiter signs alongside whichever party the arbiter sides with (buyer for refund, seller for release).
4. Spend via Leaf A or Leaf B — script-path spend, control block + tapscript revealed. Costs more in fees and reveals "this was a dispute resolution" on-chain. Acceptable tradeoff for the dispute case.

### 5.6 Timeout path

1. CSV delay (`N` blocks since funding) elapses.
2. Buyer (alone) signs Leaf C and broadcasts.
3. Funds return to buyer's withdrawal address.

This is the auto-refund safety net — even if KaspaCom (the arbiter) goes offline forever, buyer funds are recoverable after `N` blocks. Important for product trust.

### 5.7 What KaspaCom holds in this design

- The arbiter Schnorr key (`priv_A`) — used only in dispute. Hot or cold depending on dispute frequency; cold + manual is safest.
- The escrow service runtime — funding-address derivation, deposit detection, state machine, MuSig2 coordination, dispute API, callbacks.
- No buyer or seller key material at rest.

This is **non-custodial** in the strict sense — if KaspaCom disappears, the timeout path still releases funds. Custodial flows (we hold buyer's seed) are a separate product decision with KYC/legal/security implications and are out of scope for this design.

## 6. Implementation effort breakdown

Assuming Pearl SDK (Tier 1: `pearl-rpc` + `pearl-sdk`) is already shipped:

| Phase | Scope | Effort |
|---|---|---|
| `pearl-script` package | Tap-tree + P2TR address construction with Pearl HRP; fixture tests against simnet | 1 week |
| `pearl-multisig` package | MuSig2 key aggregation + 2-round protocol implementation; k-of-n tapscript templates | 2 weeks |
| `pearl-escrow` package | 2-of-3 escrow template, HTLC template; unit tests + simnet integration | 1–2 weeks |
| `escrow-service` (NestJS) | API: setup / fund-address / status / release / dispute / callback; state machine; persistence | 2 weeks |
| `watcher-worker` | Pearl block/mempool subscriber, deposit confirmation, timeout firing, callback dispatch | 1 week |
| Hardening | Reorg handling, fee bumping, idempotent callbacks, double-spend detection, observability | 1–2 weeks |
| **Total** | **6–10 weeks** | |

Without the Pearl SDK in place, add 4–6 weeks (you'd be rebuilding RPC client, address validation, payment-request schema concurrently — exactly the Phase 1 work).

## 7. Open questions to verify before implementation

These are concrete things the engineer assigned to this work must verify against `upstream/pearl/` before committing to specifics:

1. **Is `OP_CHECKSIGADD` enabled in Pearl tapscript?** (BIP342 says yes for Bitcoin Taproot; Pearl forks btcd which has BIP342. Confirm by grepping `upstream/pearl/node/txscript` for `CheckSigAdd` or opcode `0xba`.)
2. **What is the exact CSV delay encoding?** (Same as Bitcoin BIP112 expected, but Pearl could have customized; check `upstream/pearl/node/txscript/standard.go` or equivalent.)
3. **What is Pearl's standard-script policy for tapscript leaves containing `OP_CAT`?** Will `pearld` relay them by default, or do we need a fee bump?
4. **What is the fee budget rule for tapscript validation in Pearl?** (Bitcoin BIP342 budget = 50 + transaction weight; verify Pearl matches.)
5. **What is Pearl's testnet/simnet HRP?** (Mainnet `prl` — confirm in `apps/apps/pearl-desktop-wallet/src/main/config/network-config.ts`.)
6. **Has anyone deployed a multisig/escrow on Pearl mainnet already?** Search the public explorer for non-trivial P2TR spends and see the tapscript shape. (`https://explorer.pearlresearch.ai/`)
7. **What's the reorg history on Pearl mainnet?** Affects how aggressive our confirmation thresholds should be for the deposit-detection step.

## 8. Risks

- **Pearl is young.** Tapscript code paths in `pearld` are inherited from `btcd` but not battle-tested at the volume Bitcoin has. Edge cases in our tap-trees could trigger upstream bugs. Mitigate with thorough simnet testing + small-value mainnet pilot.
- **No precedent.** No one has shipped a production escrow on Pearl yet (or none that's documented). We will be the reference implementation; budget time for finding bugs ourselves.
- **MuSig2 implementation risk.** MuSig2 is well-specified (BIP327) but easy to implement insecurely — the nonce-handling step has subtle replay vulnerabilities. Use a vetted library (`bitcoinerlab` or `noble-musig2`) and have someone with crypto background review.
- **Reorgs.** Confirmation threshold for escrow funding should be conservative (~6 blocks ≈ 20 min at 194 s/block) until reorg behavior is characterized.
- **Custody pressure.** Buyers will ask "can you just hold the funds for me?" — that's a custodial product, separate decision with regulatory/KYC implications.
- **OP_CAT footguns.** Re-enabled in Pearl but not in Bitcoin → less industry tooling and review around it. Treat any OP_CAT-based covenant as research-grade until externally reviewed.

## 9. References

- BIP340 — Schnorr signatures: https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki
- BIP341 — Taproot: https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki
- BIP342 — Tapscript: https://github.com/bitcoin/bips/blob/master/bip-0342.mediawiki
- BIP327 — MuSig2: https://github.com/bitcoin/bips/blob/master/bip-0327.mediawiki
- BIP112 — CSV: https://github.com/bitcoin/bips/blob/master/bip-0112.mediawiki
- bitcoinjs-lib v6+ Taproot support: https://github.com/bitcoinjs/bitcoinjs-lib
- `@noble/secp256k1`: https://github.com/paulmillr/noble-secp256k1
- Pearl whitepaper / ePrint paper (for OP_CAT cost and XMSS semantics): see `docs/resources.md` "Core Pearl Links".
- KaspaCom's own related work: BTC HTLC patterns in `KASPACOM/kaspacom-wallet-messages`, prior escrow flows referenced in the Pearl OTC* implementation at `https://github.com/pearl-research-labs/pearl` (search for `OP_CHECKSIGADD` or `taproot` in `upstream/pearl/`).
