# Pearl Product Menu — Two Tracks

> **Use this in the meeting.** This is a menu of candidates to discuss, **not a roadmap commitment**. Each item is sized in 5–10 lines so you can scan in the room and pick what to advance. Items tagged ⚙️ depend on the Tier-1 SDK (`pearl-rpc` + `pearl-sdk` + `pearl-script`) shipping first.

## The Two Tracks

**Track A — Ecosystem (grant-funded).** We build something that grows Pearl as a whole. Pearl Research Labs (or a grants program, or the Pearl community) pays us to build it. We don't capture the upside directly, but we (a) get paid for the work, (b) lock in our position as **the** team for Pearl integration, (c) create distribution surface for our Track-B products. Open-source is the default.

**Track B — Profit (KaspaCom-owned).** We build something **we own**, takes fees / spreads / subscriptions. We capture the upside. We are at risk if a competitor ships first or if the market doesn't materialize. Closed-source or partially open is fine.

The two tracks should run **in parallel**. Track A buys us credibility + funding to subsidize Track B's risk. Track B turns the credibility into recurring revenue.

---

## Track A — Ecosystem (grant candidates)

### A1. Pearl TypeScript/WASM SDK ⚙️ [strongest pitch]

The piece Pearl is most obviously missing. Kaspa has `kaspa-wasm`; Pearl has nothing equivalent. Without it, every new dev re-invents the same `bitcoinjs-lib` glue.

- **What we ship:** `@pearl/sdk` (npm) — address derivation, P2TR construction, tap-trees, Schnorr signing, PSBT, fee estimation, JSON-RPC client. Optional `@pearl/wasm` (Go → WASM) for protocol-identical browser signing.
- **Effort:** 8–12 weeks for v1 of the pure-TS package; +4–6 weeks for the WASM artifact if approved.
- **Grant pitch:** "Pearl has no official client SDK. We build it open-source, maintain it for 12 months, write the docs, run the bug bounty."
- **KaspaCom upside:** every Pearl app (including our Track-B ones) uses our SDK; brand recognition; effectively free Phase-1 work for our own products.
- **Risk:** Pearl Research Labs may already be building one internally — ask first via Discord.

### A2. Pearl block explorer v2

Pearl already has an explorer, but it's basic: no tap-tree visualizer, no PoUW proof visualizer, no OP_CAT covenant decoder, no multi-network switcher, no API.

- **What we ship:** modern explorer with tap-tree + script visualization, mining-template/PoUW proof inspector, OP_RETURN/inscription detection, REST + GraphQL API.
- **Effort:** 8–10 weeks for v1.
- **Grant pitch:** "Devs and miners need better forensics; we ship the indexer + UI."
- **KaspaCom upside:** referral surface for our Track-B products (linked widgets, sponsored placements). The explorer becomes a top-of-funnel for everything else.
- **Risk:** Pearl team may resist a "competing" explorer — frame as complementary (specialized features they don't cover).

### A3. Faucet + developer onboarding hub

Pearl has no public testnet faucet. Onboarding requires building `pearld` from source.

- **What we ship:** docker-compose for a one-command simnet; public testnet faucet (rate-limited); copy-paste tutorials; deploy-to-AWS Terraform module.
- **Effort:** 3–5 weeks.
- **Grant pitch:** "Every Pearl dev's first 4 hours are wasted on setup. Fix it for the ecosystem."
- **KaspaCom upside:** modest — mostly a credibility play. Cheap to ship.
- **Risk:** low.

### A4. Pearl Pay open standard ⚙️

Bitcoin has BIP21 (`bitcoin:address?amount=X`); Pearl has nothing. Wallets and payment processors need a standard.

- **What we ship:** a public proposal (`pearl-payment-uri` spec) + a reference implementation in TS. Submit upstream to Pearl Research Labs for ratification.
- **Effort:** 2 weeks for the spec; 3 weeks for the reference implementation.
- **Grant pitch:** "We propose, the community adopts, every Pearl wallet implements." Small grant + huge influence.
- **KaspaCom upside:** when our Track-B Pearl Pay product ships, it's the reference implementation of the standard we wrote.

### A5. Mobile wallet (PWA-first, open-source) ⚙️

Pearl has a desktop wallet. No mobile, no browser extension, no PWA.

- **What we ship:** PWA wallet (works on mobile + desktop), open-source, MIT-licensed. Self-custodial. SPV-based for light footprint.
- **Effort:** 12–16 weeks (full-stack TS, needs the SDK + careful key management).
- **Grant pitch:** "Pearl needs a mobile wallet to onboard retail. We ship the open-source reference; community can fork/rebrand."
- **KaspaCom upside:** brand surface for Track-B products. The wallet's home tab becomes our distribution channel.
- **Risk:** crypto wallets are high-liability — key management, recovery flows, phishing resistance. Need a security audit before mainnet.

### A6. Browser extension wallet (MetaMask-equivalent) ⚙️

Lower priority than mobile until a dapp surface exists. **But** if Track-B item B1 (OTC desk) ships, the extension becomes urgent — users want to sign trades from the browser.

- **What we ship:** Chrome + Firefox extension; standard injection API (`window.pearl`); WalletConnect-style permission model.
- **Effort:** 10–14 weeks. Probably defer until at least one Track-B product needs it.

### A7. Community Pearl indexer (open-source) ⚙️

The existing Blockbook at `blockbook.pearlresearch.ai` is community-operated, single-instance, no SLA. The ecosystem needs a self-hostable, well-tested indexer.

- **What we ship:** PostgreSQL-backed Pearl indexer with REST + GraphQL, Docker images, Helm charts, reorg handling, full address-history.
- **Effort:** 10–14 weeks.
- **Grant pitch:** "We open-source it. Anyone can run it; we run a public instance with public SLA."
- **KaspaCom upside:** doubles as the indexer for our own Track-B products. The public instance becomes a paid tier (Track-B item B10 below).

### A8. Educational content + Pearl Dev Hub

Tutorials, "build your first Pearl app" video series, code samples, Stack Overflow-style Q&A, Pearl-themed bootcamps.

- **What we ship:** website with tutorials + curated content; sample projects (Pearl-Pay-in-50-lines, escrow-walkthrough, etc.); maintained for 12 months.
- **Effort:** 4 weeks bootstrap + ongoing.
- **Grant pitch:** "Dev evangelism that grows the Pearl developer base."
- **KaspaCom upside:** the obvious authority on Pearl development; talent pipeline.

### A9. Compute marketplace open standard ⚙️

Pearl's thesis is useful-compute. There's no open standard for connecting GPU operators to Pearl-certified models and metering work.

- **What we ship:** OpenAPI spec for model catalog + operator registration + metering + PRL settlement; reference TS implementation.
- **Effort:** 4 weeks spec; 8–12 weeks reference implementation.
- **Grant pitch:** "Compute is the Pearl thesis. We define the integration standard."
- **KaspaCom upside:** when we ship our Track-B compute product (item B4), it's the reference implementation.
- **Risk:** Pearl Research Labs almost certainly has plans here — coordinate early or be redundant.

---

## Track B — Profit (KaspaCom-owned)

### B1. Pearl OTC Settlement Desk ⚙️ [already speced]

Already designed in [`pearl-otc-settlement-desk.md`](pearl-otc-settlement-desk.md) and [`pearl-otc-contracts.md`](pearl-otc-contracts.md). Two-sided escrow (Pearl Taproot + Arbitrum USDC) competing with community-built `pearl-otc.com`.

- **Revenue:** ~1–2% per settlement. At current `pearl-otc.com` volume ($833k PRL/24h ≈ $700k USDC), 1.5% = ~$10k/day = ~$3M/year **if we captured 100% of that market**. Realistic capture in year 1: 20–40%.
- **Effort:** 16–20 weeks for MVP (Modes 1–3 phased).
- **Differentiation:** verifiable two-sided escrow, RFQ pricing for fast UX, public proof page for every trade.
- **Risk:** small market today ($1.7M lifetime). Bet is that better UX + safety drives volume growth.

### B2. PRL ↔ USDC custodial bridge (wPRL)

KaspaCom holds PRL in escrow, mints wrapped wPRL on Arbitrum (or Base / Ethereum). Users can move PRL into EVM DeFi.

- **Revenue:** mint/burn fees (0.1–0.3% each direction) + float yield on locked PRL (~5% APR if invested safely) + listing/integration fees to EVM dapps.
- **Effort:** 12–16 weeks (Solidity contract + KaspaCom custody infra + Pearl signing + audit).
- **Differentiation:** first credible PRL bridge. Probably the only one until a trustless one is technically feasible (years out).
- **Risk:** **high** — custodial = regulatory exposure (MTL in US, MiCA in EU), insurance, security audit. Could be structured as an entity Pearl Research Labs partners on to share risk.

### B3. PRL payment processor (Stripe-for-PRL) ⚙️

White-label payment SDK + hosted checkout for merchants. Buyer pays in PRL, merchant gets PRL (or USDC via auto-conversion through B2 bridge).

- **Revenue:** 1–2% per transaction. Tiered SaaS for higher-volume merchants.
- **Effort:** 12–16 weeks for v1 (depends on Pearl Pay standard from A4 + SDK from A1).
- **Differentiation:** none yet exists for Pearl. We're the only option.
- **Risk:** chicken-and-egg — merchants want PRL holders, PRL holders want merchants. Solve by seeding 5–10 KaspaCom-aligned merchants ourselves.

### B4. AI Compute Marketplace (curated multi-provider)

Aggregator: KaspaCom curates GPU operators running Pearl-certified models, exposes one unified inference API, prices in PRL/USDC, takes a cut. Differentiates from `compute.pearlresearch.ai` (Pearl's own offering) by being **multi-provider** + **KYC'd operators** + **SLAs**.

- **Revenue:** 10–20% margin on inference fees. Subscription tiers for high-volume usage.
- **Effort:** 16–24 weeks for v1 (needs A9 standard + operator onboarding + billing).
- **Differentiation:** if Pearl PoUW takes off as a real AI inference network, the aggregator layer is valuable. We become the "OpenRouter for Pearl."
- **Risk:** **the moonshot.** Demand-side (paying users) and supply-side (GPU operators) both need to materialize. Probably best structured as a partnership with Pearl Research Labs, not solo.

### B5. PRL trading bot platform (SaaS)

Algorithmic trading API for the OTC market — limit orders, TWAP, arb between B1 OTC desk + `pearl-otc.com`, market-making.

- **Revenue:** subscription ($29 / $99 / $499/mo tiers) + 0.05% on bot-executed volume.
- **Effort:** 6–10 weeks (reuses our existing trading-bot-v2 infra).
- **Differentiation:** small market but high LTV per user. Targets traders who want to provide liquidity to B1.
- **Risk:** small market today; depends on OTC volume growing.

### B6. Pearl tax / accounting plugin

Exports Pearl tx history into Koinly / CoinTracker / Crypto.com Tax formats. Public good initially (Track-A vibe), tiered subscription once we have users.

- **Revenue:** freemium → $19/year for full export. Low ARPU but high margin.
- **Effort:** 4–6 weeks.
- **Differentiation:** none today. First mover wins.
- **Risk:** low.

### B7. Pearl mining-as-a-service ⚙️

KaspaCom operates a GPU mining pool (vLLM-miner + pearl-gateway), customers rent hashrate without managing GPUs.

- **Revenue:** pool fee (1–3% of mined PRL) + GPU lease margin.
- **Effort:** 8–12 weeks + GPU capex.
- **Differentiation:** lowers the entry barrier (currently you need a 4×H200 box). Could be huge if Pearl mining becomes lucrative.
- **Risk:** capex-heavy. Margins depend on PRL price and GPU pricing. **Don't bet on this unless we have hardware partners.**

### B8. Pearl token-issuance standard (KRP-20 via inscriptions)

Like BRC-20 on Bitcoin, KRC-20 on Kaspa, but on Pearl. Inscribe token-mint / token-transfer messages via OP_RETURN; KaspaCom runs the indexer that interprets them.

- **Revenue:** mint fees (1 PRL per deploy?) + marketplace fees (1% per trade) + indexer SaaS (B10).
- **Effort:** 12–16 weeks (spec + indexer + marketplace).
- **Differentiation:** **we'd be first**. UTXO inscriptions are well-understood from BTC/Kaspa; Pearl just hasn't seen one yet.
- **Risk:** speculative — needs liquidity + speculation interest to drive volume. Could be a megahit or could be irrelevant. **Talk to Pearl Research Labs first** — they may have token-standard plans that override this.

### B9. KRP-721 NFT-like collectibles

Same idea as B8 but for non-fungibles. Per-token inscriptions, marketplace, royalties via OP_RETURN.

- **Revenue:** mint fees + 1–2.5% marketplace fees.
- **Effort:** 10–14 weeks **after** B8 ships (heavy code reuse).
- **Differentiation:** same first-mover argument as B8.
- **Risk:** same speculative concerns as B8.

### B10. Pearl indexer SaaS (Alchemy-for-Pearl) ⚙️

Run the A7 indexer as a paid product. Free tier with rate limits, $99/mo basic, $999/mo with SLA + webhooks + custom queries.

- **Revenue:** SaaS subscription. Recurring, predictable.
- **Effort:** 4 weeks on top of A7 (mostly billing, dashboard, API keys).
- **Differentiation:** first reliable Pearl data API with SLA.
- **Risk:** market only exists if there are enough Pearl apps consuming data.

### B11. Telegram OTC alert bot + market data widget

Lightweight: Telegram bot that monitors Pearl chain + OTC + (eventually) B1 desk volume, alerts on whale movements, big trades, price changes. Public bot is free; "pro" tier ($9/mo) adds custom alerts, multi-wallet tracking, portfolio P/L.

- **Revenue:** small but recurring; mostly a top-of-funnel for B1 / B3.
- **Effort:** 2–3 weeks (we have the bot infra).
- **Differentiation:** none today.
- **Risk:** low. Cheap experiment.

### B12. Fiat on/off-ramp via partner

Partner with an existing on-ramp (MoonPay, Transak) to add PRL support. KaspaCom gets a revenue share on every fiat→PRL conversion.

- **Revenue:** typically 0.5–1.5% per fiat conversion.
- **Effort:** 4–8 weeks (mostly partnership + KYC paperwork).
- **Differentiation:** none — but no on-ramp currently lists PRL, so first integration captures.
- **Risk:** depends on partner appetite + AML/KYC effort.

---

## Decision framework for the meeting

Don't try to pick everything. Pick a **portfolio**:

| Slot | Suggested pick | Reasoning |
|---|---|---|
| Track A — "the obvious grant" | **A1 SDK** | Solves the universal blocker. Pearl Research Labs will fund this. Unlocks all our Track-B work. |
| Track A — "cheap credibility" | **A3 faucet/onboarding** *or* **A4 Pay standard** | Small, fast, lets us start showing up in the Pearl community. |
| Track B — "ship now, real revenue" | **B1 OTC Settlement Desk** | Already speced, real volume exists to capture, ~$3M/yr TAM. |
| Track B — "fast experiment" | **B11 alert bot** | Cheap to ship, top-of-funnel for other products. |
| Track B — "strategic bet" | **B8 KRP-20 token standard** *or* **B4 compute marketplace** | One big swing. Pick the one where we have more conviction. |

Then in 6 months we re-evaluate based on what's working.

## What we should NOT commit to in the meeting

- B7 mining-as-a-service — capex-heavy, depends on PRL price.
- B2 custodial bridge — regulatory complexity; needs legal review first.
- A6 browser extension — premature until B1 ships.
- Any "Pearl-DeFi" product (lending, AMM, options) — Pearl has no smart contracts, these all require either a token standard (B8) or speculative protocol work.

## What we should ask Pearl Research Labs (via Discord) BEFORE committing

1. Are they building an official SDK? (kills/refines A1.)
2. Are they planning a token-issuance standard? (kills/refines B8.)
3. Is there a grants program, or do we need to negotiate ad-hoc?
4. Are they open to a partnership on compute marketplace (B4)?
5. Is there a public testnet roadmap? (informs A3.)
6. Are they coordinating with on-ramps? (informs B12.)
7. Do they have an opinion on bridges (B2) — would they support a custodial one as a stepping stone?

## Suggested speaking order for the meeting

1. State the two-track framing (1 min).
2. Quick win for credibility: pitch **A1 SDK** as the headline grant ask (3 min).
3. The revenue product: pitch **B1 OTC Settlement Desk** as the headline KaspaCom-owned product (5 min).
4. Show the menu of B/A items; ask the team to vote on which 1–2 additional bets to pursue (10 min).
5. Action items: who pings Pearl Research Labs, who scopes the SDK proposal, who owns OTC desk delivery.

End of meeting deliverable: **picked 1 grant ask + 1 revenue product + 1 experiment**, with named owners and a 2-week check-in.
