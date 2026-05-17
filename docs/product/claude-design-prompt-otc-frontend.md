# Claude Design Brief — Pearl OTC Web Frontend (MVP)

> A pure **design brief**. We are asking for **high-fidelity mockups**, not code. The implementer reads this after you ship the mockups. Read end to end before you start designing.

---

## 1. What the product is, in one paragraph

Pearl OTC is a back-office trading tool for KaspaCom. A customer comes in to **buy or sell PRL** (the native asset of the Pearl chain) **in exchange for USDC** on the Base chain. The OTC desk quotes a price, the customer accepts, then both sides fund an escrow on their respective chains. When both legs are confirmed, the desk releases the funds. If anything goes wrong, the trade falls into manual review and operators inspect it through an admin view. The product feels closer to a Stripe API dashboard than a consumer crypto app — **trust, density, and clarity over polish.**

## 2. Who uses each screen

| Audience | Where they spend time | What they need from the UI |
|---|---|---|
| **Buyer** (retail-ish) | `/quote`, `/quote/:id/accept`, `/trades/:tradeId` | Get a quote, accept it, deposit USDC, watch both legs settle, see a clear receipt |
| **Public observer** (auditor, counterparty, regulator, journalist) | `/trades/:tradeId/proof` | Verify a trade really happened on both chains — a receipt page |
| **Desk operator** | `/admin/trades`, `/admin/trades/:tradeId` | Survey active trades, spot manual-review cases, annotate without breaking state |

## 3. The two chains the user sees

| Chain | Asset | What the user does | How addresses look |
|---|---|---|---|
| **Pearl** | PRL (8 decimals; 1 PRL = 100,000,000 grains) | Receives PRL on release; their counterparty (the seller) funds the Pearl escrow address from Pearl Desktop Wallet | `prl1p…` mainnet, `tprl1p…` testnet, `prlsim1p…` simnet — long bech32m, always shown in monospace |
| **Base** (Ethereum L2) | USDC (6 decimals; 1 USDC = 1,000,000 micros) | Deposits USDC via MetaMask / WalletConnect / Coinbase Wallet — standard EVM wallet flow | `0x…` 42-char hex |

A trade always touches **both** chains. The UI must surface both legs side by side at every moment of the lifecycle — never let the user lose track of which leg is which.

## 4. The full lifecycle (23 states)

Every trade carries a `state`. Group them visually into five families with consistent treatments:

**Happy path (linear, green tones)**
1. `quoted` — quote exists, waiting for accept
2. `pearl_escrow_pending` — accepted; both escrows allocated; awaiting deposits
3. `pearl_escrow_seen` — Pearl deposit observed, confirmations building
4. `pearl_escrow_confirmed` — Pearl deposit confirmed
5. `usdc_escrow_pending` — Base trade created; awaiting USDC deposit
6. `usdc_escrow_confirmed` — Both legs funded + confirmed
7. `release_pending` — Releases broadcasting
8. `released` — terminal, success

**Refund path (yellow tones)**
9. `refund_available` — eligible side may request refund
10. `refund_pending` — refund tx in flight
11. `refunded` — terminal, funds returned

**Cancellation / expiry (neutral gray)**
12. `quote_expired`
13. `cancelled`

**Failure / manual review (red tones, fail-closed)**
14. `disputed`
15. `failed_manual_review`
16. `late_prl_funding`
17. `usdc_refunded`
18. `prl_release_failed`
19. `amount_mismatch`
20. `reorged`
21. `stale_indexer`
22. `unknown_spend`

**Plus** the initial `quoted` baseline.

The customer-facing UI must **never show a "Release" button**. Releases are server-driven. The UI only displays state. Even admin screens have no release button.

## 5. The five deadlines on a trade

Every accepted trade carries five timestamps. Treat them as first-class UI elements, not afterthoughts. Show as countdowns in the user's local time with absolute timestamps in tooltips.

| Deadline | Meaning | UI treatment |
|---|---|---|
| `quoteExpiresAt` | Last moment a quote can be accepted | Countdown on `/quote/:id/accept`; if exceeded, replace the Accept button with "Quote expired — request a new one" |
| `pearlFundingDeadline` | Last moment PRL funding will count toward release | Countdown on Pearl card on `/trades/:id`; when crossed, show banner: "PRL funding window closed; PRL sent now will not authorize release." |
| `usdcDepositDeadline` | Last moment USDC deposit is accepted | Countdown on Base card; when crossed, **disable the Deposit button** and replace with closed-window message |
| `settlementDeadline` | Last moment auto-settle is allowed without manual review | Countdown on checkout page header |
| `refundAvailableAt` | First moment refund can be requested | Counts down then becomes a link/button to start the refund request flow |

## 6. Pages to design

For each page, mock **every state variant** that materially changes the page. Empty, loading, populated-success, and each failure state.

### 6.1 `/quote` — Request For Quote

Single form, two tabs at the top: **Buy PRL** / **Sell PRL**.

Form fields:
- Amount in PRL (text input, 8-decimal precision)
- Buyer Pearl address (bech32m, monospace placeholder showing the right HRP for the configured network)
- Refund Base address (`0x…` EVM hex, monospace)
- Settlement asset (locked: USDC) and Settlement network (locked: Base) — show as read-only chips, not editable selects

On submit → quote response card shows:
- Amount PRL, amount USDC (large, monospace)
- Fee in PRL and USDC
- Price (USDC per PRL)
- Expiry countdown next to a clock icon
- Two CTAs: **Accept Quote** (primary) and **Cancel** (ghost)

Variants to mock: empty, valid-and-validated, invalid (address malformed, amount below minimum), submitted-and-loading, quote-returned, quote-expired-before-accept.

### 6.2 `/quote/:id/accept` — Confirm and accept

Form fields:
- Buyer Pearl address (pre-filled from quote, editable)
- Buyer USDC address (auto-fill from connected EVM wallet, editable)
- Seller fields (`sellerPearlRefundAddress`, `sellerUsdcReceiveAddress`) — **only visible when the URL has `?role=seller` or the visitor is admin**, otherwise the desk fills these server-side
- Quote summary panel (read-only echo of price, amounts, fees, expiry countdown)
- Accept button — disabled if any field invalid OR quote has expired

Variants to mock: buyer view (seller fields hidden), seller view (`?role=seller`, seller fields editable), admin view (all fields editable + a "fill from defaults" helper), quote-expired-state, submit-in-flight.

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
- A "Pearl Wallet" subsection — in MVP, this is a small panel saying *"Open your Pearl Desktop Wallet and send the amount above to this address."* with a help link. Design it as a slot that could host a future "Sign with Pearl Wallet" button.
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
  - "Deposit confirmed ✓" (state past deposit) — disabled
- A row of small status pills below the button: wallet (connected / disconnected), network (right / wrong), allowance (granted / pending)
- Tx hashes for deposit / release / refund as they appear

Below the two cards: a **timeline** of state transitions (a vertical list of events with chain icons, timestamps, and tx links). Compact, scannable.

State-variant mocks needed for this screen:
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

**Public**, no auth. The vibe is "verifiable receipt." Dense, scannable, no marketing chrome.

Sections from top to bottom:
- Trade ID + state badge + "Public proof page" subtitle
- Quote terms (side, amount PRL, amount USDC, fee, price, accepted-at timestamp)
- All five deadlines in a table with both ISO and relative time
- Pearl leg facts: escrow address, network, funding outpoint, release tx id, refund tx id, confirmations — every tx id is a link to a Pearl block explorer
- Base leg facts: escrow contract, trade key, deposit tx hash, release tx hash, refund tx hash, chain id — every tx hash links to basescan
- Timeline of state transitions (the customer-checkout timeline, expanded)
- Side-effect ledger: every recorded action (USDC deposit observed, PRL release submitted, etc.) with idempotency key, status, actor, timestamp
- Manual-review banner at the top if the trade is in any failure state

No buttons. No actions. Read-only. Should print well to PDF.

Variants to mock: happy-path completed trade, in-progress trade, refunded trade, one of the manual-review states.

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
  - Audit log view (the full event timeline, larger and more detailed than the customer view)
- No release / refund buttons even here. Operators annotate; state transitions are server-side.

Variants to mock: empty list (no trades), populated list with mixed states, detail of a happy trade, detail of a `failed_manual_review` trade with the side-effect form expanded.

## 7. Wallet UX (Base only for MVP)

The Base side wallet flow lives inside the Base card on `/trades/:tradeId`. Mock these states:
- No wallet connected — primary CTA is "Connect wallet" with a dropdown of supported wallets (MetaMask, WalletConnect, Coinbase). After click → a wallet-picker modal.
- Wallet connected, wrong chain — CTA becomes "Switch to Base Sepolia" (or "Switch to Base") with a yellow caution icon.
- Correct chain, can deposit — large primary "Deposit USDC" button, with a sub-line showing the connected address truncated.
- Deposit in-flight — button shows a spinner, "Submitting deposit tx — confirm in your wallet…"
- Deposit submitted, awaiting confirmation — replaced by a pending pill with explorer link.
- Confirmed — green check, deposit tx hash linked.

The Pearl side has no wallet flow in MVP. Treat the "Pearl Wallet" subsection of the Pearl card as a clearly-stubbed placeholder.

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

## 9. Visual tone — direction only

The aesthetic target is **a Stripe API dashboard, not Uniswap.**
- Calm, technical, trustworthy. Neutral palette. Minimal animation.
- Monospace for all on-chain identifiers — addresses, tx ids, trade ids, escrow contract addresses, chain ids.
- Generous whitespace at the page level but **dense data presentation** inside cards (rows of facts, small typography, tight line height).
- Status badges use a small, consistent palette: green for confirmed/happy, yellow for pending/warning, red for failure, gray for terminal-non-success (cancelled, expired).
- Big numbers are monospace and right-aligned in tables.
- Copy buttons are small ghost icons next to every monospace identifier.
- Avoid emojis in product chrome.
- The proof page should look like it would be screenshotted into a regulatory filing. Avoid any "fun" treatment.

You pick the specific colors, fonts, spacing scale, and component vocabulary. Lean into a single sans-serif (Inter / SF Pro family) plus a single monospace (JetBrains Mono / IBM Plex Mono family). One accent color is enough.

## 10. Information density rules

- Address shown in full whenever the screen can fit it. Never truncate `0x1234…abcd` style on a primary checkout view; the truncation belongs in tables and timeline rows only.
- Amounts always show the full precision (8 decimals PRL, 6 decimals USDC). The integer and fractional parts can be styled differently (e.g., fractional in slightly muted color) but never elided.
- Timestamps always show both relative ("3 minutes ago") and absolute (in tooltip).
- Chain explorer links are first-class — every txid should be one click away from being verifiable on the chain.
- Don't hide failure-state details behind "More" toggles. Failure should be loud.

## 11. What to deliver

High-fidelity mockups, one screen per state variant, organized by page. Specifically:

**`/quote`** — empty, validated, invalid (form errors), quote-returned, quote-expired

**`/quote/:id/accept`** — buyer view, seller view (`?role=seller`), admin view, quote-expired-state, submit-in-flight

**`/trades/:tradeId`** — `pearl_escrow_pending`, Pearl-only funded, Base-only funded, both confirming, `release_pending`, `released`, each of the nine failure states with banner, `refund_available`, `refunded`

**`/trades/:tradeId/proof`** — happy completed, in-progress, refunded, one failure-state example

**`/admin/trades`** (list) — empty, populated mixed, filtered to manual-review-only

**`/admin/trades/:tradeId`** (detail) — happy trade, manual-review trade with side-effect form expanded

For each mockup, include:
- A short caption naming the screen + state ("`/trades/:id` — `late_prl_funding`")
- Any non-obvious interaction notes as annotation overlays
- One mobile variant per page (we don't expect MVP mobile-first, but the customer pages should not be broken on a phone)

Output format: pages organized in a single Figma file (or equivalent), one frame per mockup, named consistently.

## 12. What is out of scope for this brief

- Marketing pages (landing, about, pricing).
- Onboarding wizard.
- Notification preferences page.
- Pearl wallet UI beyond the placeholder slot in the Pearl card.
- Multi-language support — English only for MVP.
- Dark mode — light theme only for MVP (the Stripe-dashboard aesthetic is lighter by default; we can revisit).
- Charts / analytics. The OTC product is transactional, not analytical.

## 13. Once you ship the mockups

A separate implementer will pick the framework (Angular 18 per KaspaCom convention) and build against the mockups. They will source data from an existing `otc-api` backend; you do not need to design API contracts, only consume the field shapes documented above. If a state or field is unclear, mark it on the mockup and we'll resolve before implementation.

---

**Reading checklist before designing:**
1. This brief, end to end.
2. The "Stripe API dashboard" reference visually — open it once for tone alignment.
3. Skim `docs/product/pearl-otc-contracts.md` in this repo for the product-level invariants on release authorization (it tells you why fail-closed banners matter).

Then start.
