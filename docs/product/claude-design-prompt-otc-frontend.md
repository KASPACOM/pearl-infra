# Claude Design Brief — Pearl OTC Web Frontend (MVP)

> Use this as the **single source of truth** when implementing the OTC web frontend in `apps/otc-web/` for KaspaCom. Read it end-to-end before you start. Every section is load-bearing.

---

## 1. What you are building, in one paragraph

A web app at `apps/otc-web/` that lets a customer go through the **full Pearl OTC trade lifecycle**: request a quote for PRL ↔ USDC, accept it, deposit USDC into a Base smart-contract escrow, watch their PRL escrow on the Pearl chain get funded by the seller, see both legs confirm, and end up with PRL in the buyer wallet + USDC paid to the seller. The frontend handles the customer surface and an internal admin surface. It does **not** make settlement decisions — the server-side settlement worker does. The frontend just renders state, collects inputs, and brokers wallet signatures on the Base side.

Today `apps/otc-web/` is a TypeScript **client library only** (`otc-api-client.ts`, `base-escrow-client.ts`). You will bootstrap the actual web application on top of those clients.

---

## 2. Two chains, two settlement legs

| Chain | Role | Wallet you need on the FE | Identifiers |
|---|---|---|---|
| **Pearl** | Native chain holding PRL. The seller funds an escrow address; on release, the buyer receives PRL. | **None for MVP** — show the escrow address as copyable text, expected amount, and a deadline. Behind a `PearlWalletSlot` interface so a future integrated wallet plugs in without rewriting. | Bech32m P2TR addresses: `prl1p…` (mainnet), `tprl1p…` (testnet/testnet2), `prlsim1p…` (simnet). 1 PRL = 1e8 grains. |
| **Base** (Ethereum L2) | Holds USDC. The buyer deposits USDC into an escrow contract; on release, the contract pays the seller. | **Full EVM wallet integration**: MetaMask + WalletConnect v2 + Coinbase Wallet at minimum. Uses `ethers v6`. | Mainnet chainId `8453`, Base Sepolia testnet chainId `84532`. USDC has 6 decimals (1 USDC = 1e6 microUSDC). |

**Hard rule:** USDC mainnet on Base is **gated** by `pearl-otc-contracts.md` invariants. The FE must:
- Read `OtcApiConfig.allowMainnetPearlEscrow` and `OtcApiConfig.baseNetwork` from the API.
- If `baseNetwork === 'base_sepolia'`, only show the deposit button if the connected wallet's chainId is `84532`. Same for `'base'` → `8453`.
- If the wallet is on the wrong chain, show "Switch network" with a one-click chain-switch using `wallet_switchEthereumChain`.

---

## 3. The trade lifecycle (state machine)

Every trade has a `state: TradeState` field. There are **23** values; group them into five families for UI purposes:

### Happy path (linear)
1. `quoted` — quote exists, awaiting accept.
2. `pearl_escrow_pending` — quote accepted, both escrow addresses allocated. Buyer should now deposit USDC on Base; seller should fund the Pearl escrow address.
3. `pearl_escrow_seen` — Pearl indexer saw the funding output but not yet confirmed.
4. `pearl_escrow_confirmed` — Pearl funding has the required confirmations.
5. `usdc_escrow_pending` — Base USDC `createTrade` call mined; awaiting USDC deposit.
6. `usdc_escrow_confirmed` — Both legs funded + confirmed.
7. `release_pending` — Settlement worker is broadcasting the releases.
8. `released` — Terminal. Both releases broadcast and confirmed.

### Refund path
9. `refund_available` — A timeout passed; the eligible side may request refund.
10. `refund_pending` — Refund broadcasts in flight.
11. `refunded` — Terminal. Funds returned to their originators.

### Cancellation / expiry
12. `quote_expired` — Quote TTL elapsed before accept.
13. `cancelled` — Manual cancel by admin or unmet preconditions.

### Failure / manual review (fail-closed)
14. `disputed` — Either side disputed. Manual review path.
15. `failed_manual_review` — Stuck; operator needs to inspect.
16. `late_prl_funding` — PRL funded **after** `pearl_funding_deadline`. Never authorize release.
17. `usdc_refunded` — USDC was refunded; PRL release is now blocked.
18. `prl_release_failed` — Broadcast failed (mempool reject, signature error, etc.).
19. `amount_mismatch` — Funding amount didn't match expected.
20. `reorged` — A funding block got detached after confirmation; needs re-verification.
21. `stale_indexer` — Pearl indexer lag exceeds a threshold; cannot trust state.
22. `unknown_spend` — Escrow output was spent by a tx the indexer can't classify (`release` / `refund` / unknown). Audit before any action.

The customer-facing UI must **never** offer a release button. Releases are exclusively driven by the server-side settlement worker. The FE only **displays** state.

`canTransitionTrade(from, to)` and `tradeStateIsTerminal(state)` from `@kaspacom/pearl-sdk` are pure helpers you can use to gate UI affordances.

---

## 4. Deadlines — five of them per trade

A trade carries `deadlines: OtcTradeDeadlines`:

```ts
{
  quoteExpiresAt: string;          // ISO timestamp; last time the quote can be accepted.
  pearlFundingDeadline: string;     // last time PRL funding counts as valid escrow funding.
  usdcDepositDeadline: string;      // last time the buyer should deposit USDC.
  settlementDeadline: string;       // last time the worker may auto-settle without manual review.
  refundAvailableAt: string;        // first time the eligible party can request refund.
}
```

**Display rules (9.4.6 + 9.4.7):**
- Always show a countdown next to each relevant deadline on the checkout page.
- When `now > usdcDepositDeadline`, **disable** the USDC deposit button entirely, replace with: *"Deposit window closed. This trade can no longer be funded by USDC."*
- When `now > pearlFundingDeadline`, show a banner: *"PRL funding window closed; any PRL sent now will not authorize release."* (This is the `late_prl_funding` failsafe surfaced to the user before it triggers.)
- After `refundAvailableAt`, surface a button or link to request refund (the actual refund logic is server-side, but UI must allow the user to trigger the request flow).

---

## 5. The API surface you consume

Base URL configured via env var `VITE_OTC_API_BASE_URL` (default `http://127.0.0.1:8080`). All requests JSON. Use `OtcApiClient` from `apps/otc-web/src/otc-api-client.ts` — it already exists and you should extend it, not duplicate it.

| Method | Path | Purpose | Returns |
|---|---|---|---|
| POST | `/otc/quotes` | Create a quote from a buy/sell request. | `OtcQuote` |
| POST | `/otc/quotes/:quoteId/accept` | Accept a quote. Server allocates the Pearl escrow + creates Base escrow record. | `OtcTrade` |
| GET | `/otc/trades/:tradeId` | Fetch a trade. Use this for the checkout page (private to buyer/seller). | `OtcTrade` |
| GET | `/otc/trades/:tradeId/proof` | Public proof bundle (no private addresses). Use this for the proof page. | `PublicTradeProof` |
| POST | `/otc/trades/:tradeId/usdc-escrow/create-intent` | Returns prepared EVM calldata for the buyer to broadcast `createTrade` on Base. | `{ chainId, to, data, idempotencyKey }` |
| POST | `/otc/trades/:tradeId/side-effects` | Record an off-chain or on-chain side effect (e.g., "USDC deposit observed", "PRL release submitted"). Idempotent on `idempotencyKey`. | `OtcSideEffect` |
| GET | `/otc/trades/:tradeId/side-effects` | List side effects for audit / proof. | `OtcSideEffect[]` |
| GET | `/healthz` | Liveness. | `{ ok: true }` |

### Type sources you MUST import, never redefine

- `OtcQuote`, `OtcTrade`, `TradeState`, `PearlEscrowLeg`, `UsdcEscrowLeg`, `OtcTradeDeadlines`, `PublicTradeProof`, `TradeEvent`, `canTransitionTrade`, `tradeStateIsTerminal` — all from `@kaspacom/pearl-sdk` (`packages/pearl-sdk/src/otc.ts`).
- `OtcSideEffect`, `OtcSideEffectType`, `OtcSideEffectStatus`, `OtcApiConfig` — from `services/otc-api/src/types.ts`. Re-export them through `apps/otc-web/src/otc-api-client.ts` if needed; do not duplicate.
- USDC escrow ABI + network config — from `@kaspacom/usdc-escrow-client` (`packages/usdc-escrow-client/src/`).

If a type drifts because a sibling agent ships a backend change, the FE typecheck will fail at build — that's intentional, fix the FE rather than redefining the type.

---

## 6. Pages and routes (9.4.1 – 9.4.4)

### 6.1 `/quote` — RFQ buy/sell PRL (closes 9.4.1)

Single form. Two tabs at top: **Buy PRL** | **Sell PRL** (controls `side: 'buy_prl' | 'sell_prl'`).

Form fields:
- `amountPrl` (string, validated against PRL grain precision; reuse `parsePrlToGrains` from `@kaspacom/pearl-sdk` for validation).
- `buyerPearlAddress` (string, validated by `validatePearlAddress` from `@kaspacom/pearl-sdk`; must match the configured network).
- `usdcRefundAddress` (string, 0x-prefixed EVM address, 42 chars, validated by ethers `isAddress`).
- `settlementAsset` locked to `'USDC'`, `settlementNetwork` locked to `'base'` — read-only chips, not editable.

On submit → `POST /otc/quotes` → display the quote summary:
- Amount PRL, amount USDC, fee, price (USDC per PRL), expiry countdown.
- Two buttons: **Accept Quote** (proceeds to `/quote/:id/accept`) and **Cancel**.

### 6.2 `/quote/:id/accept` — Accept quote → trade

Form fields:
- Confirm `buyerPearlAddress` (pre-filled from quote, editable).
- `buyerUsdcAddress` (the wallet that will deposit USDC; auto-fill from connected EVM wallet, editable).
- `sellerPearlRefundAddress` and `sellerUsdcReceiveAddress` — these come from the desk side, not the buyer; **hide unless `?role=seller`** is in the URL OR the user is admin. For the buyer-facing flow these are server-filled.

On submit → `POST /otc/quotes/:id/accept` → redirect to `/trades/:tradeId`.

### 6.3 `/trades/:tradeId` — Checkout status (closes 9.4.2)

Two-column layout, sticky header at top with: trade id (copyable), current state badge, all five deadlines as countdowns.

Two cards side by side, one per chain:

**Pearl card** (left):
- Escrow address — large monospace, copy button.
- Expected amount — formatted PRL with 8 decimals.
- Required confirmations.
- Status: `pearl_escrow_pending` → "Awaiting funding"; `pearl_escrow_seen` → "Funding observed, X / Y confirmations"; `pearl_escrow_confirmed` → "Funding confirmed".
- `<PearlWalletSlot>` placeholder card: empty in MVP, designed so a future integrated wallet plugs in. Render *"Open in your Pearl wallet — copy the address above into Pearl Desktop Wallet to fund this escrow."*
- Funding txid (if known) — link to `https://explorer.pearl.com/tx/{txid}` (or whatever explorer the API surfaces).

**Base card** (right):
- USDC contract address — copyable.
- Trade key — copyable.
- Expected USDC amount.
- Required confirmations.
- Action button states:
  - Not yet `usdc_escrow_pending` → button disabled, "Waiting on trade setup…"
  - `usdc_escrow_pending` and no wallet connected → "Connect wallet" CTA.
  - `usdc_escrow_pending`, wallet connected, wrong chain → "Switch to Base / Base Sepolia" using `wallet_switchEthereumChain`.
  - `usdc_escrow_pending`, wallet on correct chain → **"Deposit USDC"** flow:
    1. Call `POST /otc/trades/:id/usdc-escrow/create-intent` → get prepared calldata.
    2. Use ethers `wallet.sendTransaction({ to, data, chainId })`.
    3. On submit: optimistically `POST /otc/trades/:id/side-effects` with `effectType: 'usdc_deposit_observed'`, `status: 'submitted'`, `txHash`.
    4. Show pending tx UI with chain-explorer link.
  - `usdc_escrow_confirmed` and beyond → "Deposit confirmed ✓" disabled.
- Banner if `now > usdcDepositDeadline`: red, "Deposit window closed."

Poll the API every 5 seconds for state updates, or use SSE / WebSocket if added later. TanStack Query's `refetchInterval` is fine.

### 6.4 `/trades/:tradeId/proof` — Public proof (closes 9.4.3, 9.4.8)

Public, no auth. Anyone with the trade id sees a clean read-only summary built from `GET /otc/trades/:tradeId/proof`. Must show:

- Trade ID, current state.
- Quote terms: side, amount PRL, amount USDC, fee, price, quote-accept timestamp.
- All five deadlines, formatted as both ISO timestamps and "X hours ago / from now".
- **Pearl leg facts**: escrow address, network, `fundingOutpoint`, `releaseTxid`, `refundTxid`, confirmations (link each txid to a block explorer).
- **Base leg facts**: escrow contract, trade key, `depositTxHash`, `releaseTxHash`, `refundTxHash`, chain id (link each to basescan.org or sepolia.basescan.org).
- **Timeline** of all `TradeEvent`s: `(fromState → toState, source, sourceEventId, txHash/outpoint, observedAt)`. Render as a vertical timeline.
- **Side effects** (from `GET /trades/:id/side-effects`): each `OtcSideEffect` rendered as a row with `effectType`, `status`, `txHash`/`outpoint`, `actor`, `createdAt`.
- If the trade is in any **manual-review** state (`failed_manual_review`, `disputed`, `late_prl_funding`, `usdc_refunded`, `prl_release_failed`, `amount_mismatch`, `reorged`, `stale_indexer`, `unknown_spend`): a red banner naming the state and the `metadata.reason` if present. **Never show a "release" or "complete" CTA** on the proof page even for admin — proof page is read-only.

### 6.5 `/admin/trades` and `/admin/trades/:tradeId` — Admin shell (closes 9.4.4)

Behind an env-var gate (`VITE_ADMIN_TOKEN`); the FE just sends the token as a header on admin reads. The actual auth is server-side.

**List page:** table of recent trades. Columns: trade id, state (with color-coded badge), age, amount PRL, amount USDC, manual-review reason (if any), link to detail. Filters: state, date range, has-manual-review-flag.

**Detail page:** everything from the customer checkout view + the admin-only side-effects POST UI:
- Form to record a manual side effect: pick `effectType`, paste `txHash` / `outpoint`, set `status`, add `metadata` JSON, submit `POST /otc/trades/:id/side-effects`.
- A "Mark for manual review" button → `POST /otc/trades/:id/side-effects` with `effectType: 'manual_review_flagged'` (or whatever the API exposes).
- An audit-log view (the `TradeEvent[]` from the proof endpoint).

Crucially admin **also has no release / refund button**. State transitions remain server-side. Admin can only annotate and observe.

---

## 7. Edge-state display rules (9.4.7)

Every failure state must:

1. Render a clearly red / yellow banner naming the state.
2. Disable all positive-action CTAs (no "Deposit", no "Release", no "Refund Now" — even buyer refund must go through a server-side flow).
3. Surface a "Contact support" link that opens a `mailto:` or in-app channel pre-filled with the trade id and current state.
4. If `metadata.reason` is present on the latest `TradeEvent`, display it verbatim.

Mapping:
| State | Banner color | Headline |
|---|---|---|
| `late_prl_funding` | red | "PRL was funded after the deadline — this trade will not auto-release." |
| `usdc_refunded` | yellow | "USDC was refunded. PRL release is blocked." |
| `prl_release_failed` | red | "PRL release transaction failed to broadcast. Manual review required." |
| `amount_mismatch` | red | "Funded amount does not match the expected escrow amount." |
| `reorged` | yellow | "A funding block was orphaned by a chain reorg. Awaiting re-confirmation." |
| `stale_indexer` | yellow | "Indexer lag exceeds threshold. Status may be out of date." |
| `unknown_spend` | red | "Escrow output was spent by a transaction we cannot classify. Audit pending." |
| `failed_manual_review` | red | "Trade flagged for manual review." |
| `disputed` | red | "Trade is under dispute." |

---

## 8. Wallet integration (Base)

Use `@wagmi/core` v2 + `viem` + `@web3modal/wagmi` for the wallet adapter layer; it gives MetaMask, WalletConnect v2, and Coinbase Wallet for free with the smallest amount of code. ethers v6 is already a dep — use it for the `sendTransaction` call after wagmi has the connected signer, **or** use viem's `walletClient.sendTransaction` directly. Pick one and be consistent.

**Required flows:**
- Connect / disconnect.
- Chain detection + chain switch to `8453` or `84532` depending on `baseNetwork`.
- Sign + send `createTrade` calldata returned by `/usdc-escrow/create-intent`.
- Sign + send USDC `approve` + escrow `deposit` calls — `prepareUsdcApprovalCall` and `prepareEscrowDepositCall` already exist in `apps/otc-web/src/base-escrow-client.ts`. Use them, don't reimplement.
- Track transaction status via `waitForTransactionReceipt`; on receipt, optimistically POST a `usdc_deposit_observed` side effect with `status='confirmed'` and the receipt's `blockNumber`/`blockHash`.

**Wrong-network handling:** never let the user send a transaction on the wrong chain. The button is disabled with a clear message until they switch.

---

## 9. Pearl wallet integration (deferred — design the seam now)

There is no browser-based Pearl wallet today. Design the FE so a future integrated wallet can plug in via a clean interface, **but ship MVP with no actual Pearl wallet code**.

```ts
// apps/otc-web/src/pearl-wallet/types.ts (new)
export interface PearlWalletProvider {
  readonly id: string;
  readonly name: string;
  isAvailable(): boolean;
  connect(): Promise<{ address: string; network: PearlNetwork }>;
  fundEscrow(args: { address: string; amountGrains: string; tradeId: string }): Promise<{ txid: string }>;
}

// MVP default:
export class ManualPearlWalletProvider implements PearlWalletProvider {
  // isAvailable() returns true. connect/fundEscrow throw "not implemented" and the UI
  // falls back to showing the copyable address + "open in Pearl Desktop Wallet" hint.
}
```

`<PearlWalletSlot>` is an Angular component that renders:
- If `provider.isAvailable() && provider.id !== 'manual'` → a "Fund with [Wallet Name]" button.
- Else (MVP) → copyable address card + the manual instruction.

When a real provider lands later (`InBrowserPearlWalletProvider`), only the provider implementation and the registry change; no UI rewrite.

---

## 10. Conventions you must follow

- **Framework: Angular 18** standalone components. Per repo conventions in `KASPACOM/defi-frontend` and `KASPACOM/kaspiano-front-v2`. **No NgModules.** Every component is `standalone: true`.
- **Routing:** Angular Router. File-based or explicit `provideRouter([...])` in `main.ts`.
- **State / data fetching:** TanStack Query (`@tanstack/angular-query-experimental`) with **Angular signals**. No services holding state mutably. No NgRx.
- **UI primitives:** PrimeNG 17+. Use its `p-button`, `p-card`, `p-table`, `p-toast`, `p-tabview`. Tailwind CSS for layout. PrimeIcons or Lucide for icons.
- **Money formatting:** PRL amounts always shown with 8 decimals via `parsePrlToGrains` / `formatGrainsToPrl` from `@kaspacom/pearl-sdk` — never `.toFixed(8)` directly. USDC always 6 decimals; reuse the helper from `@kaspacom/pearl-sdk` (`parseUsdcToMicros` / `formatMicrosToUsdc`).
- **Address validation:** always validate via `validatePearlAddress` / `ethers.isAddress`. Show inline form errors via PrimeNG `p-message`.
- **Date/time:** display in user's local timezone but always include the absolute ISO timestamp in a tooltip. Use `date-fns` or Angular's `DatePipe` with `medium` format.
- **Forms:** Reactive Forms with custom validators that map to `pearl-sdk` helpers.
- **Testing:** Vitest for unit tests of pure functions; Playwright for one happy-path E2E that exercises `/quote → /quote/:id/accept → /trades/:id` against a mocked otc-api.
- **No emojis** in UI text unless explicitly requested. No inline comments explaining what the code does (well-named identifiers carry the meaning).
- **Type imports:** ALWAYS import the canonical types from `@kaspacom/pearl-sdk` / `@kaspacom/usdc-escrow-client` / `services/otc-api/src/types.ts`. Never redefine `OtcTrade`, `TradeState`, `OtcSideEffect`, etc. — the typecheck will fail if they drift, and that's by design.

---

## 11. Source-of-truth files (read these BEFORE coding)

| File | Why |
|---|---|
| `packages/pearl-sdk/src/otc.ts` | All trade / quote / state types + transition helpers. |
| `packages/pearl-sdk/src/addresses.ts` | `validatePearlAddress`. |
| `packages/pearl-sdk/src/amounts.ts` | `parsePrlToGrains`, `formatGrainsToPrl`, USDC equivalents. |
| `services/otc-api/src/types.ts` | `OtcSideEffect`, `OtcApiConfig`, prepare-tx request shapes. |
| `services/otc-api/src/http.ts` | The authoritative list of routes and their input/output shapes. |
| `apps/otc-web/src/otc-api-client.ts` | The existing API client class — extend, don't replace. |
| `apps/otc-web/src/base-escrow-client.ts` | The existing prepared-call builders for Base USDC approve + deposit. |
| `packages/usdc-escrow-client/src/abi.ts` | USDC escrow ABI. |
| `packages/usdc-escrow-client/src/networks.ts` | Base network + chain id config. |
| `docs/product/pearl-otc-contracts.md` | Product-level invariants — read this twice. |
| `docs/operations/escrow-watch-api.md` | (FYI) The internal indexer API. **The FE does not consume this directly** — otc-api mediates. |

---

## 12. Acceptance criteria

The FE is done when all of the following hold:

1. `cd apps/otc-web && npm run build` produces a static bundle under `apps/otc-web/dist/web/` (Angular output dir). `npm run dev` serves it on `http://localhost:4200`.
2. A buyer can:
   - Land on `/quote`, fill the buy-PRL form, submit, and see a quote summary.
   - Click Accept, fill the accept form, and be redirected to `/trades/:id`.
   - Connect MetaMask, switch to Base Sepolia, see the Deposit USDC button enabled, click it, sign in MetaMask, and see the tx pending → confirmed UI.
   - Watch the Pearl card transition `pending → seen → confirmed` purely by polling (manually send PRL from Pearl Desktop Wallet to the displayed address).
   - End up at `released` state with both transactions linked in the proof page.
3. Every one of the 22 non-`quoted` states has a defined render. Failure states show their red/yellow banner with the right headline.
4. `/trades/:id/proof` renders without authentication and exposes only public fields (no private buyer/seller addresses unless explicitly in the `PublicTradeProof` shape).
5. `/admin/trades` is gated behind `VITE_ADMIN_TOKEN`; without the token, the page redirects to `/quote`.
6. All 23 `TradeState` values are referenced somewhere in the UI code (use a `satisfies Record<TradeState, ...>` to make the compiler enforce exhaustiveness).
7. `npm test` (Vitest unit tests + Playwright happy-path) is green in CI.
8. Lighthouse score ≥ 90 on `/quote` and `/trades/:id/proof` for performance + accessibility.

---

## 13. Out of scope (don't build these)

- In-browser Pearl wallet (XMSS signing, key custody, broadcast). Stub via `PearlWalletSlot` only.
- Server-side settlement decisions. The FE never decides; it only displays.
- The release / refund buttons on the customer view. Server-side worker owns this.
- An auth system. Admin gate is just an env-var header for MVP.
- Anything that talks to the indexer's `/watches` API directly. `otc-api` is the only thing the FE talks to (plus the connected EVM wallet).
- Anything that calls `pearld` directly. The indexer abstracts that and `otc-api` abstracts the indexer.

---

## 14. Output format

Produce, in `apps/otc-web/`:
- A full Angular 18 standalone app structure (`src/main.ts`, `src/app/`, `src/routes/`, etc.).
- Updated `package.json` with Angular + TanStack Query + PrimeNG + Tailwind + wagmi + viem + web3modal + ethers + date-fns.
- Updated `tsconfig.json` to support Angular while keeping the existing client modules compatible.
- Vite + Angular dev server config OR Angular CLI config (your choice; favor whichever leaves the existing `npm run typecheck` and library `npm test` working).
- A `README.md` at `apps/otc-web/README.md` explaining: env vars, dev run, build, test, deploy.

When you finish each route/page, commit with the pattern `feat(otc-web): <thing> (closes 9.4.X)` referencing the specific OpenSpec substep.

---

## 15. Failure modes to avoid

These have bitten the project before. Don't repeat them.

- **Mixing testnet and mainnet config in one bundle.** Read `baseNetwork` and `pearlEscrow.network` from the API; render UI accordingly. Never hardcode a chain id.
- **Showing a release CTA on any user-facing surface.** Even when state is `release_pending`. Releases are server-side.
- **Trusting cached state through a refresh.** Always re-fetch on mount. TanStack Query's defaults are fine.
- **Re-implementing the trade state machine in TS on the client.** The server is the source of truth; the FE only reads `state` and renders.
- **Submitting a Base transaction on the wrong chain.** Always check `chainId` against the configured `baseNetwork` before enabling the button.
- **Optimistic UI on the Pearl side.** Pearl funding requires the indexer to observe it. Don't show "confirmed" until the API says so.

---

## 16. One-paragraph framing for the visual designer

This is a back-office-y OTC trading tool, not a consumer crypto app. Aesthetic should read **calm, technical, trustworthy** — small uniform spacing, neutral palette, monospace for addresses and amounts, no animations that hide pending state. Think Stripe's API dashboard, not Uniswap. The proof page in particular should feel like a verifiable receipt: dense, scannable, hyperlinks everywhere. The admin shell should feel like a Postgres pgAdmin tab, not a CRM. Speed and density beat polish.

---

**Done with this brief.** Read it again, then read `docs/product/pearl-otc-contracts.md`, then read the three `*.ts` files in the source-of-truth table. Then start.
