# Portfolio Page — Compact Single-Viewport Layout

**Status:** Approved (brainstorm 2026-05-04)
**Owner:** Vikas
**Scope:** Redesign `/portfolio` (desktop) so the active ledger table is visible above the fold at 1366×768 without scrolling.

## Problem

At 1366×768 (the most common laptop viewport) the current `/portfolio` page requires scrolling past ~620px of chrome (editorial hero + 4 stat tiles + full-width 160px PnL chart + section headings + tab bar + search bar) before any position/order/history row is visible. Mobile users complain less because the page is already designed for scroll, but on desktop the ledger — the primary reason to visit the page — is hidden below the fold.

## Goal

Compress everything above the ledger so 7+ rows of the active table sit in the initial viewport at 1366×768. Keep editorial identity intact: still our typography, still no Polymarket-style chrome.

## Non-goals

- No change to the ledger tables themselves (`PositionsTable`, `OrdersTable`, `HistoryTable`).
- No change to mobile (`<lg`) layout — cards stack vertically; mobile is acceptable as-is.
- No change to the not-connected state (no ledger to compress).
- No change to data fetching, hooks, or modals.

## Vertical budget at 1366×768

Available below browser chrome ≈ 683px. New layout:

| Section | Target height |
|---|---|
| Top chrome (Navbar + ChromeHeader) | ~85px (unchanged) |
| Utility row (breadcrumb + actions) | ~44px |
| Two-card row (stats 2×2 left / chart right) | ~190px |
| Tab + search row (single line) | ~52px |
| Table headers | ~30px |
| **Available for table rows** | **~282px → 7–8 rows** |

(Compared to ~0 rows visible today.)

## Layout

### 1. Utility row (replaces the editorial hero)

Single line, baseline-aligned, no large title:

- **Left:** Existing breadcrumb (`Markets · Portfolio`) — unchanged styling.
- **Right cluster:** `0xEEE5…821C` address chip with copy icon → `↓ Deposit` → `↑ Withdraw` → `⟲ Refresh`.
- All right-cluster items use the existing mono `[11px] uppercase tracking-[0.14em]` styling already in the page (lines 391–425). Reuse those exact button components — no new visual primitives.
- The huge italic Fraunces "Portfolio" display title and the subtitle are removed entirely. The breadcrumb already names the page; the cards below carry the meaning.
- `belowSlot` becomes empty / `EditorialHero` is no longer used here.

### 2. Two-card row

Side-by-side at `lg` and up. Stack vertically below `lg`.

#### Left card — Stats 2×2 (~58% width on lg+, full width below)

- Bordered card (`border border-border/40`, no shadow — match existing card aesthetic in `PullStatGrid`).
- Internal 2×2 grid of the existing `PullStat` components, in this order:
  - Top row: **Portfolio Value** | **Open Positions**
  - Bottom row: **Cash Balance** | **Total P&L**
- Same labels, same `caption` strings, same loading skeletons, same `valueClassName` for P&L coloring, same `TrendGlyph` mark on P&L. **Reuse `PullStat` component verbatim** — only the wrapping grid changes.
- Padding: `p-5` or `p-6` (match other cards in the app — pick whichever already exists; do not introduce a new spacing token).
- No Deposit/Withdraw inside the card.

#### Right card — P&L chart (~42% width on lg+, full width below)

- Bordered card with the same border/radius/padding as the left card so they match visually.
- **Card header row** (single line):
  - Left: `PROFIT / LOSS` mono caps label
  - Right: Period selector strip (`6H 12H 1D 1W 1M ALL`) — reuse the existing `INTERVAL_OPTIONS` strip from `pnl-chart.tsx` lines 492–515 verbatim
- **Body:**
  - Big headline P&L number (Fraunces, ~32–40px) with delta in red/green and percentage. Match the existing PnL hero number styling that lives inside the chart's left summary block today.
  - Sparkline-style chart at **`height={120}`** below the headline. Drop the date axis labels and "195 points" footer text to save vertical space.
- **Implementation:** This requires either (a) a new prop on `PnLChart` to render in this compact card layout (header strip + headline + body chart, no `border-y` band), or (b) extracting the chart core out of `PnLChart` and composing a new `PortfolioPnLCard` wrapper in the portfolio components dir. Decision deferred to plan, but the implementation must not duplicate chart fetching/state logic.

### 3. Tab + search row (single line)

Replaces the current stacked `§ Ledger` heading + tabs + separate search-bar block.

- Remove the `§ Ledger` heading entirely.
- One row: `[ Positions 3   Open orders 0   History ]` ←— left, with `[ 🔍 Search markets… ]   [ All / Profit / Loss ]` —→ right.
- `TabNav` keeps its current API; only spacing changes.
- `SearchBar` is moved inline (currently it sits in its own `py-4 border-b` block). The `border-b border-border/40` underline is provided by `TabNav` itself; the standalone separator below the search bar is removed.
- Below `lg`, the search + filter wrap to a second line below the tabs (existing responsive behavior of `SearchBar`).

### 4. Tables

No structural change. `PositionsTable`, `OrdersTable`, `HistoryTable` continue to render under the tab+search row. They already render densely.

## Responsive behavior

- **`lg` and up (≥1024px):** two-card row side by side, single-line tab+search row. Goal viewport.
- **`md` (768–1023px):** cards stack vertically (stats first, chart second). Tab+search row may wrap.
- **`sm` and below (<768px):** unchanged from today — full vertical stack, scrolling expected.

## Editorial identity guardrails

- **No new italic Fraunces hero title** anywhere on this page (per project memory: italic Fraunces is reserved for hero titles + narrative empty states only — and we explicitly removed the hero title here).
- **No `§` section markers** on this page after redesign — both `§ Performance` and `§ Ledger` are removed.
- Keep mono `[10–11px] uppercase tracking-[0.14–0.20em]` for all section labels.
- Keep underline-style buttons (Deposit/Withdraw) — do **not** adopt Polymarket's filled blue button.
- Keep `TrendGlyph`, `PullStat`, `formatCurrency`, all existing color tokens.

## Files affected

- `apps/web/src/app/portfolio/page.tsx` — primary restructure (lines 357–584). Replaces `EditorialHero` + `PullStatGrid` + `<section>` (Performance) + `<section>` (Ledger heading) with a new utility row + two-card row + tab/search row.
- `apps/web/src/components/portfolio/` — likely add `stats-card.tsx` (2×2 grid wrapper) and `pnl-card.tsx` (chart card wrapper). Concrete file split decided in plan.
- `apps/web/src/components/pnl-chart.tsx` — either gain a compact-mode prop or be split so the chart core can be reused without its current header/border-band wrapper. Decided in plan.
- `EditorialHero` is no longer used by `/portfolio` (other pages still use it — leave the component alone).

## Out of scope for this spec (may become follow-ups)

- Persisting the active tab in the URL.
- Defaulting to "Open orders" when there are open orders (current default = Positions).
- Virtualized rows for users with many positions.
- Mobile redesign.

## Acceptance criteria

1. At 1366×768, opening `/portfolio` while connected shows: utility row + both cards + tab/search row + table headers + at least 7 position rows (or "no positions" empty state) without scrolling.
2. The italic Fraunces "Portfolio" display title and "Every position, order and realised dollar…" subtitle are gone.
3. The full-width P&L chart band and `§ Performance` heading are gone — replaced by a card.
4. The 4 stat tiles still appear, with the same labels/values/coloring/skeletons as today.
5. Deposit/Withdraw/Refresh/address copy still work; only their location changes.
6. Below `lg` viewports, content stacks (no horizontal overflow, no clipping).
7. Loading skeletons render in the new card positions.
8. Not-connected state is unchanged.
