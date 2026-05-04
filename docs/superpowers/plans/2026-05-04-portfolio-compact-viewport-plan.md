# Portfolio Compact-Viewport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compress `/portfolio` so the active ledger table is visible above the fold at 1366×768 — drop the editorial hero, collapse stats + chart into a two-card row, inline tabs/search.

**Architecture:** Extract reusable pieces from the existing `pnl-chart.tsx` (chart core + sparkline/summary helpers) and assemble four small portfolio-scoped components — `PortfolioUtilityRow`, `PortfolioStatsCard`, `PortfolioPnlCard`, `PortfolioLedgerHeader`. The page (`apps/web/src/app/portfolio/page.tsx`) goes from ~620px of vertical chrome to ~316px before the table.

**Tech Stack:** Next.js (app router), React 19, Tailwind CSS, Biome, TypeScript. No unit-test framework in this repo — verification is `pnpm typecheck` + `pnpm lint` + visual check via `chrome-devtools` MCP at the target viewport. The dev server runs on `http://localhost:8000` (already running per session context).

**Spec:** [docs/superpowers/specs/2026-05-04-portfolio-compact-viewport-design.md](../specs/2026-05-04-portfolio-compact-viewport-design.md)

---

## File Structure

**Create:**
- `apps/web/src/components/portfolio/utility-row.tsx` — breadcrumb + actions row (replaces the EditorialHero usage). One responsibility: top-of-page chrome.
- `apps/web/src/components/portfolio/stats-card.tsx` — bordered card wrapping a 2×2 `PullStat` grid. One responsibility: balance/P&L summary.
- `apps/web/src/components/portfolio/pnl-card.tsx` — bordered card containing label + interval pills + headline P&L number + small chart. One responsibility: P&L visualization.
- `apps/web/src/components/portfolio/ledger-header.tsx` — single-line tabs + search + filter row (composes existing `TabNav` + `SearchBar`). One responsibility: ledger navigation.

**Modify:**
- `apps/web/src/components/pnl-chart.tsx` — export the internal `InteractiveLineChart` so `pnl-card.tsx` can reuse it. No behavioral change to existing exports.
- `apps/web/src/app/portfolio/page.tsx` — replace lines 357–525 (hero + PullStatGrid + Performance section + Ledger heading + standalone search-bar block) with the four new components. Keep all hooks, handlers, modals untouched.

**Delete (after step-through verifies nothing else imports them):**
- `PnLChart` itself stays — only the export of `InteractiveLineChart` is added. We do not delete `PnLChart` because the spec leaves it in place for any future re-use; YAGNI says don't proactively remove. (If `pnpm typecheck` is happy with leaving it, leave it.)

---

## Task 1: Export `InteractiveLineChart` from `pnl-chart.tsx`

**Files:**
- Modify: `apps/web/src/components/pnl-chart.tsx:70`

- [ ] **Step 1: Add `export` to the function declaration**

Open `apps/web/src/components/pnl-chart.tsx`. Change line 70 from:

```ts
function InteractiveLineChart({
```

to:

```ts
export function InteractiveLineChart({
```

That's the only change. The existing `PnLChart` continues to use it locally; nothing else needs to change.

- [ ] **Step 2: Verify TypeScript compiles**

Run from repo root:

```bash
pnpm --filter @knoww/web typecheck
```

Expected: passes with no errors. (The `InteractiveLineChart` symbol is now in the public surface but no other file imports it yet — that's fine.)

- [ ] **Step 3: Verify lint passes**

```bash
pnpm --filter @knoww/web lint
```

Expected: `Checked N files. No fixes applied.`

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/pnl-chart.tsx
git commit -m "refactor(web): export InteractiveLineChart for portfolio reuse"
```

---

## Task 2: Create `PortfolioStatsCard`

**Files:**
- Create: `apps/web/src/components/portfolio/stats-card.tsx`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/portfolio/stats-card.tsx` with this exact content:

```tsx
"use client";

import { PullStat, TrendGlyph } from "@/components/pull-stat";
import { formatCurrency } from "@/lib/formatters";

interface PortfolioStatsCardProps {
  portfolioValue: number;
  openPositionsValue: number;
  positionCount: number | undefined;
  cashBalance: number;
  totalPnl: number;
  totalInvested: number;
  isPortfolioLoading: boolean;
  isPositionsLoading: boolean;
  isCashLoading: boolean;
  isPnlLoading: boolean;
}

export function PortfolioStatsCard({
  portfolioValue,
  openPositionsValue,
  positionCount,
  cashBalance,
  totalPnl,
  totalInvested,
  isPortfolioLoading,
  isPositionsLoading,
  isCashLoading,
  isPnlLoading,
}: PortfolioStatsCardProps) {
  const pnlPercent = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 overflow-hidden">
      <div className="grid grid-cols-2 divide-x divide-y divide-border/40 [&>*:nth-child(-n+2)]:border-t-0">
        <PullStat
          label="Portfolio Value"
          value={formatCurrency(portfolioValue)}
          caption="Cash + positions"
          isLoading={isPortfolioLoading}
        />
        <PullStat
          label="Open Positions"
          value={formatCurrency(openPositionsValue)}
          caption={positionCount ? `${positionCount} markets` : "—"}
          isLoading={isPositionsLoading}
        />
        <PullStat
          label="Cash Balance"
          value={formatCurrency(cashBalance)}
          caption="USDC available"
          isLoading={isCashLoading}
        />
        <PullStat
          label="Total P&L"
          value={formatCurrency(totalPnl, true)}
          caption={
            totalInvested > 0
              ? `${pnlPercent >= 0 ? "+" : ""}${pnlPercent.toFixed(2)}% on cost`
              : "No cost basis yet"
          }
          valueClassName={
            totalPnl >= 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-600 dark:text-red-400"
          }
          mark={
            totalInvested > 0 ? (
              <TrendGlyph direction={totalPnl >= 0 ? "up" : "down"} />
            ) : undefined
          }
          isLoading={isPnlLoading}
        />
      </div>
    </div>
  );
}
```

Notes:
- Card uses `rounded-lg border border-border/60 bg-card/40` — matches the `markets-view.tsx:354` pattern already in the codebase.
- The grid uses `divide-x divide-y divide-border/40` for hairline rules between cells, with the `[&>*:nth-child(-n+2)]:border-t-0` selector to suppress the top border on the first row (the card border itself is already there).
- All formatting / coloring / loading behavior is identical to the inline version in `page.tsx:434-477`.

- [ ] **Step 2: Verify TypeScript and lint**

```bash
pnpm --filter @knoww/web typecheck && pnpm --filter @knoww/web lint
```

Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/portfolio/stats-card.tsx
git commit -m "feat(web): add PortfolioStatsCard for compact 2x2 stats grid"
```

---

## Task 3: Create `PortfolioPnlCard`

**Files:**
- Create: `apps/web/src/components/portfolio/pnl-card.tsx`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/portfolio/pnl-card.tsx` with this exact content:

```tsx
"use client";

import { useState } from "react";
import { InteractiveLineChart } from "@/components/pnl-chart";
import { Skeleton } from "@/components/ui/skeleton";
import { type PnLInterval, usePnLHistory } from "@/hooks/use-pnl-history";

const INTERVAL_OPTIONS: { value: PnLInterval; label: string }[] = [
  { value: "6h", label: "6H" },
  { value: "12h", label: "12H" },
  { value: "1d", label: "1D" },
  { value: "1w", label: "1W" },
  { value: "1m", label: "1M" },
  { value: "all", label: "All" },
];

function formatCurrency(value: number): string {
  const absValue = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (absValue >= 1_000_000) {
    return `${sign}$${(absValue / 1_000_000).toFixed(2)}M`;
  }
  if (absValue >= 1000) {
    return `${sign}$${(absValue / 1000).toFixed(2)}K`;
  }
  return `${sign}$${absValue.toFixed(2)}`;
}

function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

interface PortfolioPnlCardProps {
  userAddress?: string;
  chartHeight?: number;
}

export function PortfolioPnlCard({
  userAddress,
  chartHeight = 120,
}: PortfolioPnlCardProps) {
  const [interval, setInterval] = useState<PnLInterval>("all");
  const { data, isLoading, error } = usePnLHistory({
    userAddress,
    interval,
    fidelity:
      interval === "6h" || interval === "12h" || interval === "1d"
        ? "1h"
        : "1d",
  });

  const isPositive = (data?.summary?.endPnl ?? 0) >= 0;
  const hasData = data?.data && data.data.length > 0;

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-4 sm:p-5 flex flex-col gap-3 h-full">
      {/* Header — label + interval pills */}
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Profit / Loss
        </span>
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide font-mono text-[10px] uppercase tracking-[0.14em]">
          {INTERVAL_OPTIONS.map((opt) => {
            const isActive = interval === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setInterval(opt.value)}
                className={`relative px-2 py-1 whitespace-nowrap transition-colors shrink-0 ${
                  isActive
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
                {isActive && (
                  <span
                    aria-hidden
                    className="absolute inset-x-2 -bottom-px h-px bg-foreground"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="w-full" style={{ height: chartHeight }} />
        </div>
      ) : error ? (
        <div
          className="flex items-center text-muted-foreground font-editorial italic text-sm"
          style={{ height: chartHeight }}
        >
          <p>Failed to load P&amp;L data.</p>
        </div>
      ) : !hasData ? (
        <div className="flex flex-col gap-2 py-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            No data yet
          </p>
          <p className="font-editorial italic text-base text-muted-foreground leading-snug">
            Your P&amp;L curve shows up here once you've traded.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span
              className={`text-2xl sm:text-3xl font-semibold tabular-nums tracking-[-0.015em] ${
                isPositive ? "text-emerald-500" : "text-red-500"
              }`}
            >
              {formatCurrency(data.summary.endPnl)}
            </span>
            <span
              className={`font-mono text-[11px] uppercase tracking-[0.12em] tabular-nums flex items-center gap-1 ${
                data.summary.change >= 0 ? "text-emerald-500" : "text-red-500"
              }`}
            >
              {data.summary.change >= 0 ? "↑" : "↓"}
              {formatCurrency(Math.abs(data.summary.change))}
              <span className="text-muted-foreground/70">
                ({formatPercent(data.summary.changePercent)})
              </span>
            </span>
          </div>
          <InteractiveLineChart data={data.data} height={chartHeight} />
        </>
      )}
    </div>
  );
}
```

Notes:
- Helper functions `formatCurrency` and `formatPercent` are duplicated from `pnl-chart.tsx` rather than imported because `pnl-chart.tsx` does not export them. This is intentional (~12 lines, DRY violation small enough to be cheaper than a new shared module). If a shared `pnl-formatters.ts` already exists, prefer that — but at the time of writing it does not.
- Chart height defaults to 120px (vs. 220px in the standalone `PnLChart`) per spec.
- No date-range/data-points footer — saves vertical space.
- `INTERVAL_OPTIONS` is duplicated from `pnl-chart.tsx:57-64` rather than exported, for the same reason.

- [ ] **Step 2: Verify TypeScript and lint**

```bash
pnpm --filter @knoww/web typecheck && pnpm --filter @knoww/web lint
```

Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/portfolio/pnl-card.tsx
git commit -m "feat(web): add PortfolioPnlCard with compact chart layout"
```

---

## Task 4: Create `PortfolioUtilityRow`

**Files:**
- Create: `apps/web/src/components/portfolio/utility-row.tsx`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/portfolio/utility-row.tsx` with this exact content:

```tsx
"use client";

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronLeft,
  Copy,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatAddress } from "@/lib/formatters";

interface PortfolioUtilityRowProps {
  proxyAddress?: string;
  hasProxyWallet: boolean;
  onDeposit: () => void;
  onWithdraw: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
}

export function PortfolioUtilityRow({
  proxyAddress,
  hasProxyWallet,
  onDeposit,
  onWithdraw,
  onRefresh,
  isRefreshing,
}: PortfolioUtilityRowProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!proxyAddress) return;
    navigator.clipboard.writeText(proxyAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mb-5 flex items-center justify-between gap-3 flex-wrap">
      {/* Left: breadcrumb */}
      <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-[0.08em] text-muted-foreground/90">
        <Link
          href="/markets"
          className="flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          <span>Markets</span>
        </Link>
        <span className="text-border/80">&rsaquo;</span>
        <span className="text-foreground">Portfolio</span>
      </div>

      {/* Right: address + actions */}
      <div className="flex items-center gap-5 flex-wrap font-mono text-[11px] uppercase tracking-[0.14em]">
        {proxyAddress && (
          <button
            type="button"
            onClick={handleCopy}
            className="group inline-flex items-center gap-2 py-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>{formatAddress(proxyAddress)}</span>
            {copied ? (
              <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Copy className="h-3 w-3 opacity-60 group-hover:opacity-100" />
            )}
          </button>
        )}
        {hasProxyWallet && proxyAddress && (
          <>
            <button
              type="button"
              onClick={onDeposit}
              className="group inline-flex items-center gap-2 py-1 font-semibold text-foreground transition-colors"
            >
              <ArrowDownToLine className="h-3 w-3" />
              <span className="border-b-2 border-foreground pb-0.5 group-hover:border-foreground/60 transition-colors">
                Deposit
              </span>
            </button>
            <button
              type="button"
              onClick={onWithdraw}
              className="group inline-flex items-center gap-2 py-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowUpFromLine className="h-3 w-3" />
              <span className="border-b border-border/60 pb-0.5 group-hover:border-foreground transition-colors">
                Withdraw
              </span>
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="inline-flex items-center gap-1 px-2 py-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <RefreshCw
            className={cn("h-3 w-3", isRefreshing && "animate-spin")}
          />
          <span>Refresh</span>
        </button>
      </div>
    </div>
  );
}
```

Notes:
- Reuses the same Deposit/Withdraw button visual treatment from `page.tsx:404-425`.
- Reuses the address copy button visual from `page.tsx:388-403`.
- Reuses the Refresh button visual from `HeroRefreshButton` (`editorial-hero.tsx:193-213`).
- The breadcrumb is a stripped-down version of `EditorialHero`'s breadcrumb code (we only need 2 levels here; no need to import `BreadcrumbItem[]` complexity).
- `mb-5` provides spacing before the two-card row.

- [ ] **Step 2: Verify TypeScript and lint**

```bash
pnpm --filter @knoww/web typecheck && pnpm --filter @knoww/web lint
```

Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/portfolio/utility-row.tsx
git commit -m "feat(web): add PortfolioUtilityRow combining breadcrumb and actions"
```

---

## Task 5: Create `PortfolioLedgerHeader`

**Files:**
- Create: `apps/web/src/components/portfolio/ledger-header.tsx`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/portfolio/ledger-header.tsx` with this exact content:

```tsx
"use client";

import { SearchBar } from "@/components/portfolio/search-bar";
import { TabNav } from "@/components/portfolio/tab-nav";
import type { PnLFilter, TabType } from "@/components/portfolio/types";

interface PortfolioLedgerHeaderProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
  positionCount: number | undefined;
  orderCount: number | undefined;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  pnlFilter: PnLFilter;
  onPnlFilterChange: (filter: PnLFilter) => void;
}

const PLACEHOLDERS: Record<TabType, string> = {
  positions: "Search markets...",
  orders: "Search orders...",
  history: "Search history...",
};

export function PortfolioLedgerHeader({
  activeTab,
  onTabChange,
  positionCount,
  orderCount,
  searchQuery,
  onSearchChange,
  pnlFilter,
  onPnlFilterChange,
}: PortfolioLedgerHeaderProps) {
  return (
    <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
      <div className="lg:flex-1 lg:min-w-0">
        <TabNav
          activeTab={activeTab}
          onTabChange={onTabChange}
          positionCount={positionCount}
          orderCount={orderCount}
        />
      </div>
      <div className="lg:flex-1 lg:max-w-xl lg:pb-1">
        <SearchBar
          value={searchQuery}
          onChange={onSearchChange}
          placeholder={PLACEHOLDERS[activeTab]}
          pnlFilter={pnlFilter}
          onPnlFilterChange={onPnlFilterChange}
          showFilter={activeTab === "positions"}
        />
      </div>
    </div>
  );
}
```

Notes:
- On `lg+` viewports tabs and search live on the same line (`lg:flex-row`).
- Below `lg`, search wraps under the tabs — same as today's behavior.
- The standalone `border-b` separator that previously sat below the search bar is gone; `TabNav` already provides a hairline underline.
- `pb-1` on the search column nudges the search bar baseline to align with the tab text.

- [ ] **Step 2: Verify TypeScript and lint**

```bash
pnpm --filter @knoww/web typecheck && pnpm --filter @knoww/web lint
```

Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/portfolio/ledger-header.tsx
git commit -m "feat(web): add PortfolioLedgerHeader with inline tabs and search"
```

---

## Task 6: Wire new components into `portfolio/page.tsx`

**Files:**
- Modify: `apps/web/src/app/portfolio/page.tsx`

This is the largest task. We replace lines 357–584 (the connected-state JSX) but leave **everything above it** (state, hooks, handlers, the not-connected branch) untouched.

- [ ] **Step 1: Update imports**

In `apps/web/src/app/portfolio/page.tsx`, replace the imports block at the top of the file. Find the existing imports (lines 1–37) and replace them in their entirety with:

```tsx
"use client";

import { useAppKit } from "@reown/appkit/react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useConnection } from "wagmi";
import { ChromeHeader } from "@/components/app-layout";
import { DepositModal } from "@/components/deposit-modal";
import { EditorialHero } from "@/components/editorial-hero";
import { Navbar } from "@/components/navbar";
import { HistoryTable } from "@/components/portfolio/history-table";
import { PortfolioLedgerHeader } from "@/components/portfolio/ledger-header";
import { OrdersTable } from "@/components/portfolio/orders-table";
import { PortfolioPnlCard } from "@/components/portfolio/pnl-card";
import { PositionsTable } from "@/components/portfolio/positions-table";
import { SellPositionModal } from "@/components/portfolio/sell-position-modal";
import { PortfolioStatsCard } from "@/components/portfolio/stats-card";
import type {
  PnLFilter,
  Position,
  SortDirection,
  SortField,
  TabType,
  Trade,
} from "@/components/portfolio/types";
import { PortfolioUtilityRow } from "@/components/portfolio/utility-row";
import { WithdrawModal } from "@/components/withdraw-modal";
import { useCtfOperations } from "@/hooks/use-ctf-operations";
import { useCancelOrder, useOpenOrders } from "@/hooks/use-open-orders";
import { useProxyWallet } from "@/hooks/use-proxy-wallet";
import { useUserDetails } from "@/hooks/use-user-details";
import { useUserPnL } from "@/hooks/use-user-pnl";
import { useUserPositions } from "@/hooks/use-user-positions";
import { useUserTrades } from "@/hooks/use-user-trades";
```

Removed compared to current imports:
- `HeroRefreshButton` (no longer used here — Refresh now lives inside `PortfolioUtilityRow`)
- `PnLChart` (replaced by `PortfolioPnlCard`)
- `PullStat`, `PullStatGrid`, `TrendGlyph` (now used inside `PortfolioStatsCard`)
- `SearchBar`, `TabNav` (now used inside `PortfolioLedgerHeader`)
- `formatAddress`, `formatCurrency` (now consumed inside the new components)
- `ArrowDownToLine`, `ArrowUpFromLine`, `Check`, `Copy` (used inside `PortfolioUtilityRow`)

Kept: `EditorialHero` is still imported because the **not-connected branch** (lines 311–355 of the current file) still renders it. Do not remove that import.

- [ ] **Step 2: Remove the now-unused `handleCopy` handler and `copied` state**

Find these lines in `page.tsx`:

```tsx
const [copied, setCopied] = useState(false);
```

Delete that line.

Find this block:

```tsx
const handleCopy = () => {
  if (proxyAddress) {
    navigator.clipboard.writeText(proxyAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
};
```

Delete the entire block. The copy logic now lives inside `PortfolioUtilityRow`.

- [ ] **Step 3: Replace the connected-state JSX**

Find the `return (` for the connected state (currently around line 357). Replace everything from that `return (` down through the closing `);` of the component (currently around line 607) with the following:

```tsx
  return (
    <div className="min-h-screen bg-background relative overflow-x-hidden selection:bg-foreground/15">
      <Navbar />
      <ChromeHeader />
      <motion.main
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="relative z-10 px-3 sm:px-4 md:px-6 lg:px-8 pt-6 pb-24 xl:pb-8"
      >
        <PortfolioUtilityRow
          proxyAddress={proxyAddress}
          hasProxyWallet={hasProxyWallet}
          onDeposit={() => setShowDepositModal(true)}
          onWithdraw={() => setShowWithdrawModal(true)}
          onRefresh={handleRefresh}
          isRefreshing={
            loadingPositions ||
            loadingPnl ||
            loadingOrders ||
            loadingTrades ||
            loadingUserDetails ||
            isProxyLoading
          }
        />

        <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <PortfolioStatsCard
              portfolioValue={portfolioValue}
              openPositionsValue={openPositionsValue}
              positionCount={positionsData?.summary.positionCount}
              cashBalance={cashBalance}
              totalPnl={totalPnl}
              totalInvested={totalInvested}
              isPortfolioLoading={loadingPositions || isProxyLoading}
              isPositionsLoading={loadingPositions}
              isCashLoading={isProxyLoading}
              isPnlLoading={loadingPnl || loadingUserDetails}
            />
          </div>
          <div className="lg:col-span-5">
            <PortfolioPnlCard userAddress={tradingAddress || undefined} />
          </div>
        </div>

        <section>
          <PortfolioLedgerHeader
            activeTab={activeTab}
            onTabChange={(tab) => {
              setActiveTab(tab);
              setSearchQuery("");
            }}
            positionCount={positionsData?.summary.positionCount}
            orderCount={ordersData?.count}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            pnlFilter={pnlFilter}
            onPnlFilterChange={setPnlFilter}
          />

          <AnimatePresence mode="wait">
            {activeTab === "positions" && (
              <motion.div
                key="positions"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <PositionsTable
                  positions={positionsData?.positions || []}
                  isLoading={loadingPositions}
                  searchQuery={searchQuery}
                  pnlFilter={pnlFilter}
                  sortField={sortField}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                  onSell={handleSellPosition}
                />
              </motion.div>
            )}

            {activeTab === "orders" && (
              <motion.div
                key="orders"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <OrdersTable
                  orders={ordersData?.orders || []}
                  isLoading={loadingOrders}
                  searchQuery={searchQuery}
                  onCancel={handleCancelOrder}
                  cancellingOrderId={cancellingOrderId}
                />
              </motion.div>
            )}

            {activeTab === "history" && (
              <motion.div
                key="history"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <HistoryTable
                  trades={mergedHistory}
                  isLoading={loadingTrades || loadingPositions}
                  searchQuery={searchQuery}
                  onCloseLostPosition={handleCloseLostPosition}
                  closingPositionId={closingConditionId}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </motion.main>

      <DepositModal
        open={showDepositModal}
        onOpenChange={setShowDepositModal}
      />
      <WithdrawModal
        open={showWithdrawModal}
        onOpenChange={setShowWithdrawModal}
      />
      <SellPositionModal
        open={showSellModal}
        onOpenChange={setShowSellModal}
        position={sellPosition}
        onSellSuccess={handleSellSuccess}
      />
    </div>
  );
}
```

The `pnlPercent` `useMemo` is no longer used at the page level (it's recomputed inside `PortfolioStatsCard`). Find and remove this line:

```tsx
const pnlPercent = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;
```

- [ ] **Step 4: Verify TypeScript and lint**

```bash
pnpm --filter @knoww/web typecheck && pnpm --filter @knoww/web lint
```

Expected: both pass. If `typecheck` complains about an unused symbol (e.g. `formatCurrency` if you missed an import-line removal in Step 1), fix the import block until it's clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/portfolio/page.tsx
git commit -m "feat(web): rebuild portfolio page with compact two-card layout"
```

---

## Task 7: Verify in browser at 1366×768 (and 1440×900)

**Goal:** Confirm acceptance criteria #1 from the spec — at 1366×768 the table headers + at least 7 position rows are visible without scrolling.

- [ ] **Step 1: Confirm dev server is running**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/portfolio
```

Expected: `200`. If not, start with `pnpm --filter @knoww/web dev` (already runs on port 8000 per repo convention).

- [ ] **Step 2: Open the portfolio page in the browser at 1366×768**

Use `chrome-devtools` MCP:
1. `navigate_page` to `http://localhost:8000/portfolio`
2. `resize_page` to width 1366, height 768
3. `take_screenshot` (no `fullPage`) — capture only the visible viewport
4. Read the screenshot

Verify visually:
- Top to bottom in the viewport: navbar → categories → utility row (breadcrumb left, address+Deposit+Withdraw+Refresh right) → two cards side by side (stats 2×2 left, P&L card right) → tabs+search row → table headers → at least 7 data rows (or "no positions" empty state if the wallet has none).
- No horizontal scrollbar.
- The two cards are visually balanced; neither is taller than the other by more than ~10px.
- Italic Fraunces "Portfolio" title is **gone**.
- "§ Performance" / "§ Ledger" markers are **gone**.

- [ ] **Step 3: Take a screenshot at 1440×900 too**

Repeat with `resize_page` to 1440×900. Same checks. The extra height should reveal more table rows; nothing should look stretched or broken.

- [ ] **Step 4: Test responsive — 1024px and 768px**

`resize_page` to 1024×768, screenshot. Cards should still be side-by-side at exactly the `lg` breakpoint (1024px). Below `lg` they stack — verify by resizing to 1023×768. Stats card on top, P&L card below, no clipping.

`resize_page` to 768×900. Cards stacked, tabs+search wrap to two lines, no horizontal overflow.

- [ ] **Step 5: Test interactions**

Still in chrome-devtools at 1366×768:
1. Click each tab (`Positions`, `Open orders`, `History`) — verify the table swaps and search placeholder updates.
2. Click each interval pill in the P&L card (`6H`, `12H`, `1D`, etc.) — verify the chart re-renders and the active pill underline moves.
3. Click `Refresh` — verify the icon spins and tables refetch (network panel).
4. Type in the search field — verify rows filter.
5. Click `Deposit` — verify modal opens. Close it.
6. Click `Withdraw` — verify modal opens. Close it.
7. Click the address chip — verify `Check` icon appears for ~2 seconds.

- [ ] **Step 6: Verify the not-connected state still works**

Open an incognito window or disconnect the wallet, navigate to `/portfolio`. Verify the not-connected branch (lines 311–355 of `page.tsx`) still renders the editorial hero with "Your positions live on-chain..." copy. **Nothing in this branch should have changed.**

- [ ] **Step 7: Run the production build**

```bash
pnpm --filter @knoww/web build
```

Expected: build succeeds with no new warnings or type errors.

- [ ] **Step 8: Commit any small polish**

If Step 2–6 surfaced visual tweaks (e.g. card heights uneven by 20px → add `h-full` on stats card too; Refresh button alignment off → adjust gap), make them and commit:

```bash
git add apps/web/src/components/portfolio/
git commit -m "fix(web): polish portfolio compact layout"
```

If no polish is needed, skip this step.

---

## Self-Review Checklist (already completed)

**Spec coverage** — every spec section maps to a task:
- Utility row → Task 4
- Stats 2×2 card → Task 2
- P&L card → Tasks 1 + 3
- Tab + search row → Task 5
- Page assembly → Task 6
- Acceptance criteria #1 (viewport fit) → Task 7 Step 2
- Acceptance criteria #2–7 (specific removals/preservations) → Task 7 Steps 2, 5, 6

**Placeholders** — none. All code is provided in full. The only deferred decision (compact-mode prop vs extract) was resolved in favor of "extract InteractiveLineChart, build new card" (Tasks 1 + 3).

**Type consistency** — `PortfolioStatsCard`, `PortfolioPnlCard`, `PortfolioUtilityRow`, `PortfolioLedgerHeader` are the four exported names; all imports in Task 6 use those exact names. `PnLInterval` and `usePnLHistory` types are reused from `@/hooks/use-pnl-history` unchanged.

**Out of scope:** mobile redesign, URL-persisted tabs, default-open-orders tab, virtualized rows. These are listed in the spec's "Out of scope" section and are not addressed here.
