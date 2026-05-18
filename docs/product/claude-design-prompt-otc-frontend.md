# Design Brief — PRL Settlement Desk (web frontend)

> **High-fidelity mockups only. Not code.** Read the brief end to end, then look at the three attached Stripe dashboard screenshots, then start.

---

## 0. The single most important constraint

**Do NOT visually mimic pearl-otc.com.** That site is the competitor we are differentiating from. If your output looks like it, redo it.

Specifically avoid:
- Dark "crypto" aesthetic with neon accents, glassmorphism, or gradient backgrounds.
- Token-marketplace board layouts (rows of listings with big prices and "buy now" stickers).
- Trading-platform chrome: price tickers in the header, candlestick widgets, "24h volume" banners.
- Discord/Telegram-style community CTAs.
- Hero sections with marketing copy. This is a back-office tool, not a landing page.
- Cartoon coin icons or 3D-rendered token images.

Your visual target is the three attached screenshots: **Stripe Payments dashboard** [STRIPE-1], **Stripe Payment detail page** [STRIPE-2], **Stripe Webhooks/Logs page** [STRIPE-3]. Borrow their:
- Light, neutral palette with one calm accent color.
- Dense tabular data with generous page-level whitespace.
- Monospaced identifiers everywhere.
- Calm status badges (small, single color, no animation).
- Sticky context headers with breadcrumb-style trade identification.
- Side panels for detail / events instead of modal overlays.

If a Stripe page would look out of place next to your mockup, the mockup is wrong. If pearl-otc.com would look at home next to your mockup, the mockup is wrong.

---

## 1. What the product is

The PRL Settlement Desk is a back-office trading tool operated by KaspaCom. A customer comes in to **buy or sell PRL** (native asset of the Pearl chain) **in exchange for USDC on Base**. The desk quotes a price, the customer accepts, both sides fund escrows on their respective chains, and when both legs confirm, the desk releases. If anything goes wrong, the trade falls into manual review and operators inspect via an admin view.

It is **transactional, not promotional**. The aesthetic is *Stripe API dashboard*, not Uniswap. Trust, density, and clarity over polish. The product should feel like Stripe Checkout combined with the Stripe operator dashboard.

Working title in all mockups: **"PRL Settlement Desk"** (not "Pearl OTC").

---

## 2. Who uses each screen

| Audience | Where they spend time | What they need from the UI |
|---|---|---|
| **Buyer / Seller** (retail-ish) | `/quote`, `/quote/:id/accept`, `/trades/:tradeId`, `/offers`, `/my-quotes` | Get a quote, accept it, deposit USDC, watch both legs settle, see a clear receipt; OR browse other open offers / track their own waiting quotes |
| **Public observer** (auditor, counterparty, regulator, journalist) | `/trades/:tradeId/proof` | Independently verify a trade really happened on both chains |
| **Desk operator** | `/admin/trades`, `/admin/trades/:tradeId` | Survey active trades, spot manual-review cases, annotate without breaking state |

---

## 3. The two chains the user sees

| Chain | Asset | What the user does | Address shape |
|---|---|---|---|
| **Pearl** | PRL (8 decimals; 1 PRL = 100,000,000 grains) | Receives PRL on release; counterparty funds Pearl escrow address from Pearl Desktop Wallet | `prl1p…` mainnet, `tprl1p…` testnet, `prlsim1p…` simnet — long bech32m, always shown monospace |
| **Base** (Ethereum L2) | USDC (6 decimals; 1 USDC = 1,000,000 micros) | Deposits USDC via MetaMask / WalletConnect / Coinbase Wallet | `0x…` 42-char hex |

Every trade touches **both** chains. The UI must surface both legs side by side at every moment of the lifecycle. Never let the user lose track of which leg is which.

---

## 4. The full lifecycle (23 states)

Every trade carries a `state`. Group them visually into five families with consistent treatments.

**Happy path (linear, green tones):**
1. `quoted` — quote exists, waiting for accept
2. `pearl_escrow_pending` — accepted; both escrows allocated; awaiting deposits
3. `pearl_escrow_seen` — Pearl deposit observed, confirmations building
4. `pearl_escrow_confirmed` — Pearl deposit confirmed
5. `usdc_escrow_pending` — Base trade created; awaiting USDC deposit
6. `usdc_escrow_confirmed` — both legs funded + confirmed
7. `release_pending` — releases broadcasting
8. `released` — terminal, success

**Refund path (yellow tones):**
9. `refund_available` — eligible side may request refund
10. `refund_pending` — refund tx in flight
11. `refunded` — terminal, funds returned

**Cancellation / expiry (neutral gray):**
12. `quote_expired`
13. `cancelled`

**Failure / manual review (red tones, fail-closed):**
14. `disputed`
15. `failed_manual_review`
16. `late_prl_funding`
17. `usdc_refunded`
18. `prl_release_failed`
19. `amount_mismatch`
20. `reorged`
21. `stale_indexer`
22. `unknown_spend`

Plus the initial `quoted` baseline.

The customer-facing UI **never shows a "Release" button**. Releases are server-driven. The UI only displays state. Even admin screens have no release button.

---

## 5. The five deadlines on a trade

Every accepted trade carries five timestamps. Treat them as first-class UI elements, not afterthoughts. Show as countdowns in the user's local time with absolute timestamps in tooltips.

| Deadline | Meaning | UI treatment |
|---|---|---|
| `quoteExpiresAt` | Last moment a quote can be accepted | Countdown on `/quote/:id/accept`; if exceeded, replace Accept with "Quote expired — request a new one" |
| `pearlFundingDeadline` | Last moment PRL funding will count toward release | Countdown on Pearl card on `/trades/:id`; when crossed, banner: "PRL funding window closed; PRL sent now will not authorize release." |
| `usdcDepositDeadline` | Last moment USDC deposit is accepted | Countdown on Base card; when crossed, **disable** the Deposit button and replace with closed-window message |
| `settlementDeadline` | Last moment auto-settle is allowed without manual review | Countdown on checkout page header |
| `refundAvailableAt` | First moment refund can be requested | Counts down then becomes a link/button to start the refund request flow |

---

## 6. Pages to design

For each page, mock **every state variant** that materially changes the page: empty, loading, populated-success, and each failure state.

### 6.1 `/quote` — Request For Quote

Single form, two tabs at the top: **Buy PRL** / **Sell PRL**.

Form fields:
- Amount in PRL (text input, 8-decimal precision)
- Buyer Pearl address (bech32m, monospace placeholder showing the right HRP for the configured network)
- Refund Base address (`0x…` EVM hex, monospace)
- Settlement asset (locked: USDC) and Settlement network (locked: Base) — read-only chips

On submit → quote response card shows:
- Amount PRL, amount USDC (large, monospace)
- Fee in PRL and USDC
- Price (USDC per PRL)
- Expiry countdown next to a clock icon
- Two CTAs: **Accept Quote** (primary) and **Cancel** (ghost)

Variants: empty, valid-and-validated, invalid (address malformed, amount below minimum), submitted-and-loading, quote-returned, quote-expired-before-accept.

### 6.2 `/quote/:id/accept` — Confirm and accept

Form fields:
- Buyer Pearl address (pre-filled from quote, editable)
- Buyer USDC address (auto-fill from connected EVM wallet, editable)
- Seller fields (`sellerPearlRefundAddress`, `sellerUsdcReceiveAddress`) — **only visible when URL has `?role=seller` or visitor is admin**, otherwise desk fills these server-side
- Quote summary panel (read-only echo of price, amounts, fees, expiry countdown)
- Accept button — disabled if any field invalid OR quote has expired

Variants: buyer view (seller fields hidden), seller view (`?role=seller`, seller fields editable), admin view (all fields editable + "fill from defaults" helper), quote-expired-state, submit-in-flight.

### 6.3 `/trades/:tradeId` — Customer checkout

The single most important screen. Sticky header at top:
- Trade ID (copyable, monospace, with copy-button affordance)
- Current state badge (color from state family)
- All five deadlines as small countdowns in a horizontal row with tooltips for absolute times

Body: **two cards side by side** — Pearl on the left, Base on the right. Each card is roughly equal weight visually.

**Pearl card:**
- Network chip (mainnet / testnet2 / etc.)
- Escrow address (large monospace, full-width within the card, copy button)
- Expected amount in PRL (large numeric, 8 decimals)
- Required confirmations (small text under amount, e.g. "6 confirmations required")
- Status badge tied to state: `pearl_escrow_pending` → "Awaiting funding"; `pearl_escrow_seen` → "Funding observed — 3 / 6 confirmations"; `pearl_escrow_confirmed` → "Funding confirmed"
- A "Pearl Wallet" subsection — in MVP, a small panel saying *"Open your Pearl Desktop Wallet and send the amount above to this address."* with a help link. Design it as a slot that could host a future "Sign with Pearl Wallet" button.
- Funding transaction id (when known) — small text with monospace tx id, linked to an explorer

**Base card:**
- Network chip (base / base-sepolia)
- Escrow contract address (monospace, copyable)
- Trade key (monospace, copyable, short string)
- Expected amount in USDC (large numeric, 6 decimals)
- Required confirmations
- Action area: a single primary button that changes based on state:
  - "Connect wallet" (no wallet)
  - "Switch network" (wrong chain)
  - "Deposit USDC" (correct chain + state allows)
  - "Deposit confirmed" (state past deposit) — disabled
- A row of small status pills below the button: wallet (connected / disconnected), network (right / wrong), allowance (granted / pending)
- Tx hashes for deposit / release / refund as they appear

Below the two cards: a **timeline** of state transitions (vertical list of events with chain icons, timestamps, and tx links). Compact, scannable.

State-variant mocks needed:
- Brand new, both legs empty
- Pearl funded only
- Base funded only
- Both funded, confirming
- Both confirmed, release pending
- Released (terminal happy)
- Each of the 9 failure states (each shows the standardized banner — see §8)
- Refund available
- Refunded terminal

### 6.4 `/trades/:tradeId/proof` — Public proof

**Public**, no auth. The vibe is "verifiable receipt." Dense, scannable, no marketing chrome. Should print well to PDF.

Sections top to bottom:
- Trade ID + state badge + "Public proof page" subtitle
- Quote terms (side, amount PRL, amount USDC, fee, price, accepted-at timestamp)
- All five deadlines in a table with both ISO and relative time
- Pearl leg facts: escrow address, network, funding outpoint, release tx id, refund tx id, confirmations — every tx id is a link to a Pearl block explorer
- Base leg facts: escrow contract, trade key, deposit tx hash, release tx hash, refund tx hash, chain id — every tx hash links to basescan
- Timeline of state transitions (expanded)
- Side-effect ledger: every recorded action with idempotency key, status, actor, timestamp
- Manual-review banner at the top if the trade is in any failure state

No buttons. No actions. Read-only.

Variants: happy-path completed trade, in-progress trade, refunded trade, one of the manual-review states.

### 6.5 `/admin/trades` and `/admin/trades/:tradeId` — Operator shell

Visually distinct from the customer surface — think pgAdmin or a Linear board, not a consumer page.

**List page:**
- Table of recent trades. Columns: Trade ID, State badge, Age, Amount PRL, Amount USDC, Manual-review reason (when applicable), action menu
- Filters at top: state (multiselect), date range, manual-review-only toggle
- Search by trade id

**Detail page:**
- Everything on the customer checkout page (read-only)
- A side panel with **operator tools**:
  - Form to record a manual side effect: dropdown for effect type, paste tx hash or outpoint, status dropdown, free-form metadata JSON, submit
  - "Flag for manual review" button
  - Audit log view (the full event timeline, larger and more detailed than customer view)
- No release / refund buttons. Operators annotate; state transitions are server-side.

Variants: empty list (no trades), populated list with mixed states, detail of a happy trade, detail of a `failed_manual_review` trade with the side-effect form expanded.

### 6.6 `/offers` — Live offer board (NEW)

A **counter to the RFQ flow** so users can take liquidity directly from other users instead of asking the desk to quote.

Layout: a **single dense table** (Stripe Payments list aesthetic). No card grid, no marketplace tiles.

Top of page:
- Tab strip: **Buy PRL** (default) / **Sell PRL** — toggles between offers I can hit
- Filters bar (inline, not a sidebar): size range, max-spread vs. mid, network (mainnet / testnet)
- One primary CTA up top: **Post my own quote** → routes to `/quote` with a "post to board" toggle pre-checked

Table columns:
- **Side** (small color-coded chip: green BUY / red SELL — single-color text, no gradients)
- **Size in PRL** (monospace, right-aligned, 8-decimal precision)
- **Price** (USDC per PRL, monospace)
- **Total USDC** (computed, monospace, right-aligned)
- **Escrow status** — *this is the differentiator*. A small dot + label:
  - Green dot + "Pearl funded" → the maker's PRL is already in Taproot escrow, ready to settle in one click
  - Gray dot + "Unfunded" → maker still has to fund on take
- **Expires in** (countdown, e.g. "12m 30s")
- **Maker** (short pseudonymous ID, monospace, copy button)
- **Action** (ghost button: "Take")

Hovering a row shows a thin expansion below it with the full quote terms (fee breakdown, exact deadlines, full maker pubkey). Clicking Take routes to `/quote/:id/accept` with the offer's terms pre-filled.

The "Escrow status" column must be visually loud — it's our entire marketing message ("you can see the maker's funds before you commit"). Stripe's `succeeded`/`pending` status column is the reference.

Variants to mock:
- Empty board ("No offers yet. Be the first to post a quote.")
- Populated mixed (some pearl-funded, some unfunded, some near-expiry)
- Filtered to "pearl-funded only"
- One offer being taken (row shows a pending spinner)

### 6.7 `/my-quotes` — My open quotes (NEW)

A **personal dashboard** for makers and RFQ-posters to track their own waiting orders.

Layout: same dense-table aesthetic as `/offers`. Two sections stacked vertically:

**Section 1 — Waiting for a counterparty**
Quotes I've posted that haven't been taken yet. Columns:
- Side, Size, Price, Total
- **Escrow status** (Pearl funded / Unfunded — with a "Fund now" link if unfunded)
- Expires in
- Views / takes (small counters: "Seen by 12, no takers" — micro-engagement signal)
- Action menu: Edit price, Cancel, Copy link to share

**Section 2 — In flight**
Quotes that have been taken and are now mid-settlement. Each row is a compact summary linking to `/trades/:tradeId` for the full checkout view. Columns:
- Trade ID, State badge, Counterparty, Amount, "Time in state" (e.g. "Awaiting USDC deposit · 3m 12s")

Above both tables, three stat tiles in a row (Stripe-style metric cards, no charts):
- "Open quotes" (count)
- "In settlement" (count)
- "Notional posted, 24h" (USDC sum)

Variants to mock:
- Empty (no quotes posted yet, with a friendly CTA to `/quote`)
- Populated, all waiting
- Populated mixed (some waiting, some in flight, one expired)
- One quote that just got taken (top-of-section toast + row highlighted)

---

## 7. Wallet UX (Base only for MVP)

The Base side wallet flow lives inside the Base card on `/trades/:tradeId`. Mock these states:
- No wallet connected — primary CTA "Connect wallet" with a dropdown of supported wallets (MetaMask, WalletConnect, Coinbase). After click → a wallet-picker modal.
- Wallet connected, wrong chain — CTA becomes "Switch to Base Sepolia" (or "Switch to Base") with a yellow caution icon.
- Correct chain, can deposit — large primary "Deposit USDC" button, with a sub-line showing the connected address truncated.
- Deposit in-flight — button shows a spinner, "Submitting deposit tx — confirm in your wallet…"
- Deposit submitted, awaiting confirmation — replaced by a pending pill with explorer link.
- Confirmed — green check, deposit tx hash linked.

The Pearl side has no wallet flow in MVP. Treat the "Pearl Wallet" subsection of the Pearl card as a clearly-stubbed placeholder.

---

## 8. Failure-state banners — standardized

When a trade is in any of the nine failure states, show a banner spanning the full width above the two cards on `/trades/:id`, above the body on `/proof`, and at the top of the operator detail view.

| State | Color | Headline copy |
|---|---|---|
| `late_prl_funding` | red | "PRL was funded after the deadline. This trade will not auto-release." |
| `usdc_refunded` | yellow | "USDC was refunded. PRL release is blocked." |
| `prl_release_failed` | red | "PRL release transaction failed to broadcast. Manual review required." |
| `amount_mismatch` | red | "Funded amount does not match the expected escrow amount." |
| `reorged` | yellow | "A funding block was orphaned by a chain reorg. Awaiting re-confirmation." |
| `stale_indexer` | yellow | "Indexer lag exceeds threshold. Status may be stale." |
| `unknown_spend` | red | "Escrow output was spent by an unrecognized transaction. Audit pending." |
| `failed_manual_review` | red | "Trade flagged for manual review." |
| `disputed` | red | "Trade is under dispute." |

Every banner includes a "Contact support" link with `mailto:` or in-app channel pre-filled with the trade id and state.

---

## 9. Visual tone — direction with references

Target: **Stripe API dashboard** [STRIPE-1, STRIPE-2, STRIPE-3]. Anti-target: **pearl-otc.com**.

Concretely:
- **Palette**: light theme by default, neutral grays for chrome, one calm accent color for primary actions (think Stripe's purple or a muted blue — pick one and use it sparingly). No gradients. No dark mode in MVP.
- **Typography**: a single sans-serif (Inter / SF Pro family) plus a single monospace (JetBrains Mono / IBM Plex Mono family). Monospace for *all* on-chain identifiers — addresses, tx ids, trade ids, escrow contract addresses, chain ids, escrow amounts on the cards.
- **Density**: generous whitespace at the page level but **dense data presentation** inside cards and tables (small typography, tight line height, no oversized buttons).
- **Status badges**: small, single color, no animation. Green for confirmed/happy, yellow for pending/warning, red for failure, gray for terminal-non-success (cancelled, expired).
- **Numbers**: large numerics on the checkout cards are monospace and right-aligned. Big numbers in tables are right-aligned. Fractional parts can be styled in a slightly muted tone but never elided.
- **Copy buttons**: small ghost icons next to every monospace identifier.
- **No emojis** in product chrome.
- **No coin icons**, no 3D renders, no token art. PRL and USDC appear as text labels with monochrome glyphs at most.
- **No marketing chrome anywhere**. The proof page should look like it would be screenshotted into a regulatory filing.

You pick the specific colors, fonts, spacing scale, and component vocabulary — but if it feels more like a consumer crypto product than a Stripe dashboard, redo it.

---

## 10. Information density rules

- Addresses shown in full whenever the screen can fit it. Never truncate `0x1234…abcd` style on a primary checkout view; truncation belongs in tables and timeline rows only.
- Amounts always show full precision (8 decimals PRL, 6 decimals USDC). The integer and fractional parts can be styled differently (e.g., fractional in slightly muted color) but never elided.
- Timestamps always show both relative ("3 minutes ago") and absolute (in tooltip).
- Chain explorer links are first-class — every txid should be one click away from being verifiable on the chain.
- Don't hide failure-state details behind "More" toggles. Failure should be loud.

---

## 11. What to deliver

High-fidelity mockups, one screen per state variant, organized by page:

**`/quote`** — empty, validated, invalid (form errors), quote-returned, quote-expired

**`/quote/:id/accept`** — buyer view, seller view (`?role=seller`), admin view, quote-expired-state, submit-in-flight

**`/trades/:tradeId`** — `pearl_escrow_pending`, Pearl-only funded, Base-only funded, both confirming, `release_pending`, `released`, each of the nine failure states with banner, `refund_available`, `refunded`

**`/trades/:tradeId/proof`** — happy completed, in-progress, refunded, one failure-state example

**`/offers`** — empty, populated mixed, filtered to pearl-funded only, one offer being taken

**`/my-quotes`** — empty, all waiting, mixed (waiting + in-flight), one quote just taken

**`/admin/trades`** (list) — empty, populated mixed, filtered to manual-review-only

**`/admin/trades/:tradeId`** (detail) — happy trade, manual-review trade with side-effect form expanded

For each mockup, include:
- A short caption naming the screen + state (e.g. "`/trades/:id` — `late_prl_funding`")
- Any non-obvious interaction notes as annotation overlays
- One mobile variant per page (we don't expect MVP mobile-first, but customer pages should not be broken on a phone)

Output: pages organized in a single Figma file (or equivalent), one frame per mockup, named consistently.

---

## 12. Out of scope

- Marketing pages (landing, about, pricing).
- Onboarding wizard.
- Notification preferences page.
- Pearl wallet UI beyond the placeholder slot in the Pearl card.
- Multi-language support — English only for MVP.
- Dark mode — light theme only for MVP.
- Charts / analytics. The OTC product is transactional, not analytical.

---

## 13. Once you ship the mockups

A separate implementer will pick the framework (Angular 18 per KaspaCom convention) and build against the mockups. They will source data from an existing `otc-api` backend; you do not need to design API contracts, only consume the field shapes documented above. If a state or field is unclear, mark it on the mockup and we'll resolve before implementation.

---

**Before designing, in this order:**
1. Look at the three attached Stripe dashboard screenshots [STRIPE-1, STRIPE-2, STRIPE-3]. Internalize the tone.
2. Read this brief end to end.
3. If you find yourself drifting toward a marketplace-board / token-trading aesthetic, stop and reread §0. The single largest risk on this project is producing a design that looks like pearl-otc.com. Don't.

Then start.
