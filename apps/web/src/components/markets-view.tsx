"use client";

import {
  parseGammaNumberArray,
  parseGammaStringArray,
} from "@knoww/shared-types/polymarket";
import Image from "next/image";
import Link from "next/link";
import { useMemo } from "react";
import { useNow } from "@/hooks/use-now";
import {
  type PriceHistoryPoint,
  useBatchPriceHistory,
} from "@/hooks/use-price-history-batch";
import { formatCents, formatVolume, relativeTime } from "@/lib/formatters";

/**
 * Markets view — DeFi/trading-terminal aesthetic for /markets at lg+.
 *
 * Implements the `Knoww Explore Markets` design from the Claude Design
 * handoff package (`apps/web/.readability/design-pkg/knoww/`). Uses Geist
 * + Geist Mono inside a scoped `.kw-app` token namespace so the landing
 * page's editorial type system stays untouched.
 *
 * Layer stack (top → bottom):
 *   1. TopNav — primary links, search, wallet, theme, category strip
 *   2. Ticker — auto-scrolling market chips
 *   3. Utility bar — breadcrumb + LIVE + aggregate stats
 *   4. Filter bar — view tabs + advanced filter pills + filter search
 *   5. Top of Book — three featured market cards with outcome bars
 *   6. The Book — dense sortable table with 30D sparkline + Trade
 *
 * Numeric cells use Geist Mono with `tabular-nums` so prices align across
 * rows. Mobile/tablet (< lg) fall back to the standard card grid in the
 * parent (`home-content.tsx`); this component only mounts at lg+.
 */

// ============================================================
// Public contract — kept identical to the previous export so
// home-content.tsx doesn't need to change.
// ============================================================
export interface MarketViewEvent {
  id: string;
  slug?: string;
  title: string;
  image?: string;
  volume?: string;
  volume24hr?: number | string;
  /** Trailing 7-day volume. Used (alongside `volume24hr`) to derive the
   *  Vol 24h delta % shown in the book table: how far above/below the
   *  weekly daily-average today's volume is running. Field is part of
   *  the Polymarket Gamma `/events` response. */
  volume1wk?: number | string;
  liquidity?: number | string;
  liquidityClob?: number | string;
  markets?: Array<{
    id: string;
    question?: string;
    groupItemTitle?: string;
    outcomes?: string;
    outcomePrices?: string;
    /** JSON-encoded array of CLOB token IDs (`'["yesId","noId"]'`).
     *  Used to pull price history. Sometimes pre-parsed to `string[]`
     *  by upstream layers — `parseGammaStringArray` handles both. */
    clobTokenIds?: string | string[];
  }>;
}

interface SubMarket {
  id: string;
  title: string;
  yes: number;
  no: number;
  tokenId?: string;
}

type MarketViewTab = "categories" | "trending" | "breaking" | "new";

interface MarketsViewProps {
  events: MarketViewEvent[];
  totalResults?: number;
  viewMode: MarketViewTab;
  onViewChange: (next: MarketViewTab) => void;
  advancedFilters?: React.ReactNode;
  search?: React.ReactNode;
  isTransitioning?: boolean;
  /** ms-epoch of the latest successful fetch for the active query.
   *  Threaded through from React Query's `dataUpdatedAt`. When provided,
   *  the utility bar shows a live "Updated Xs ago" indicator. */
  dataUpdatedAt?: number;
}

const TABS: Array<{ key: MarketViewTab; label: string }> = [
  { key: "categories", label: "All" },
  { key: "trending", label: "Trending" },
  { key: "breaking", label: "Breaking" },
  { key: "new", label: "New" },
];

/**
 * Static fallback dataset for the "no history" sparkline state.
 * Renders as a flat mid-height horizontal stroke so the card geometry
 * stays intact. Used when the price-history batch returns no points for
 * an event's leader token (brand-new market, ultra-thin volume).
 */
const DUMMY_SPARK_DATA: PriceHistoryPoint[] = [
  { t: 0, p: 0.5 },
  { t: 1, p: 0.5 },
];

// ============================================================
// Data helpers — unchanged from the previous implementation.
// ============================================================
function toNumber(v: number | string | undefined): number {
  if (v === undefined || v === null) return 0;
  const n = typeof v === "string" ? Number.parseFloat(v) : v;
  return Number.isNaN(n) ? 0 : n;
}

function isGenericPlaceholderCandidate(title: string): boolean {
  return /^(?:team|app|car|player|candidate|option|choice)\s+[a-z]$/i.test(
    title.trim()
  );
}

function extractTopMarkets(event: MarketViewEvent, limit = 3): SubMarket[] {
  const markets = event.markets ?? [];
  const parsed: SubMarket[] = [];
  for (const m of markets) {
    const prices = parseGammaNumberArray(m.outcomePrices);
    if (prices.length < 2) continue;
    const yes = prices[0];
    const no = prices[1];
    if (Number.isNaN(yes) || Number.isNaN(no)) continue;
    const title = m.groupItemTitle || m.question || "Outcome";
    parsed.push({
      id: m.id,
      title,
      yes,
      no,
      tokenId: parseGammaStringArray(m.clobTokenIds)[0],
    });
  }
  const namedCandidates = parsed.filter(
    (market) => !isGenericPlaceholderCandidate(market.title)
  );
  const candidates = namedCandidates.length > 0 ? namedCandidates : parsed;
  candidates.sort((a, b) => b.yes - a.yes);
  return candidates.slice(0, limit);
}

function summarizeEvent(event: MarketViewEvent): {
  outcomes: number;
  leader: SubMarket | null;
} {
  const count = event.markets?.length || 0;
  const [leader] = extractTopMarkets(event, 1);
  return { outcomes: count, leader: leader ?? null };
}

/** Pull the YES CLOB token id of the event's leading market (the one
 *  with the highest YES price). This is what we feed to the price-
 *  history endpoint so the sparkline tracks the leader. Returns null
 *  when the event has no parseable markets or the leader's token
 *  list is missing. */
function leaderTokenId(event: MarketViewEvent): string | null {
  return extractTopMarkets(event, 1)[0]?.tokenId ?? null;
}

// ============================================================
// Sparkline — small inline SVG line chart driven by real CLOB
// price history. `data` is an array of {t, p} where p is 0..1.
// Color is fixed per render (caller decides up/down tint).
// ============================================================
function Spark({
  data,
  w = 100,
  h = 22,
  color,
  fill = false,
}: {
  data: PriceHistoryPoint[];
  w?: number;
  h?: number;
  color: string;
  fill?: boolean;
}) {
  if (!data || data.length < 2) return null;
  const ys = data.map((d) => d.p);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const range = max - min || 1;
  const step = w / (data.length - 1);
  const pts = data.map((d, i): [number, number] => [
    i * step,
    h - ((d.p - min) / range) * (h - 4) - 2,
  ]);
  const path = pts
    .map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`))
    .join(" ");
  const area = `${path} L${w},${h} L0,${h} Z`;
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
      style={{ display: "block" }}
    >
      {fill && <path d={area} fill={color} fillOpacity={0.1} />}
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ============================================================
// Utility bar — replaces the editorial hero with a data-first
// strip: breadcrumb · LIVE pulse · aggregate stats from real
// data only (markets count + 24h volume across the loaded set,
// plus an "Updated Xs ago" indicator driven by React Query's
// `dataUpdatedAt`). Traders count and open interest aren't
// available from the current API surface, so they're omitted.
// ============================================================
function UtilityBar({
  activeCount,
  totalVolume24h,
  dataUpdatedAt,
}: {
  activeCount: number;
  totalVolume24h: number;
  dataUpdatedAt?: number;
}) {
  return (
    <div
      className="grid grid-cols-[auto_1fr] items-center gap-6 px-7 py-3.5 border-b"
      style={{
        borderColor: "var(--kwm-hl)",
        background: "var(--kwm-bg)",
      }}
    >
      {/* Left — breadcrumb */}
      <div className="inline-flex items-center gap-3">
        <span
          className="inline-flex items-center gap-2 font-(family-name:--font-geist-mono) text-[12px] uppercase tracking-widest"
          style={{ color: "var(--kwm-ink)" }}
        >
          <span style={{ color: "var(--kwm-ink-3)" }}>Knoww</span>
          <span style={{ color: "var(--kwm-ink-dim) " }}>/</span>
          <span>Markets</span>
        </span>
      </div>

      {/* Right — aggregate stats (real data only) */}
      <div className="inline-flex items-center gap-4 justify-self-end font-(family-name:--font-geist-mono)">
        <Stat num={activeCount.toString()} lbl="Markets" />
        <Divider />
        <Stat num={formatVolume(totalVolume24h)} lbl="Vol 24h" />
        {dataUpdatedAt ? (
          <>
            <Divider />
            <UpdatedAgo timestamp={dataUpdatedAt} />
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Compact "Xs / Xm / Xh / Xd" formatter — matches the design's
 *  terminal-tight "Updated 1s ago" style instead of date-fns'
 *  verbose "less than a minute ago" phrasing. Sub-minute keeps the
 *  seconds granularity the design calls for; minute-and-above
 *  delegates to the canonical `relativeTime` compact style. */
function compactAgo(now: number, timestamp: number): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return relativeTime(timestamp, "compact", now);
}

/** Relative-time indicator that re-renders every 5s so the displayed
 *  value stays fresh ("1s" → "6s" → "11s" → "1m"). */
function UpdatedAgo({ timestamp }: { timestamp: number }) {
  const now = useNow(5_000);
  return (
    <span className="text-[11px]" style={{ color: "var(--kwm-ink-3)" }}>
      Updated{" "}
      <span className="tabular-nums" style={{ color: "var(--kwm-ink-2)" }}>
        {compactAgo(now, timestamp)}
      </span>{" "}
      ago
    </span>
  );
}

function Stat({ num, lbl }: { num: string; lbl: string }) {
  return (
    <div className="inline-flex items-baseline gap-2">
      <span
        className="text-[14px] font-medium tabular-nums"
        style={{ color: "var(--kwm-ink)", letterSpacing: "-0.01em" }}
      >
        {num}
      </span>
      <span
        className="font-(family-name:--font-geist-mono) text-[10px] uppercase tracking-[0.14em]"
        style={{ color: "var(--kwm-ink-3)" }}
      >
        {lbl}
      </span>
    </div>
  );
}

function Divider() {
  return <span aria-hidden="true" className="kwm-divider" />;
}

// ============================================================
// Filter bar — view tabs + advanced filter pills + search.
// Tabs use a hairline underline for the active state, matching
// the design exactly. Filters and search are passed in as slots
// so the existing `<DesktopFilterChips>` and `<MarketSearch>`
// keep working unchanged.
// ============================================================
function FilterBar({
  viewMode,
  onViewChange,
  advancedFilters,
  search,
}: {
  viewMode: MarketViewTab;
  onViewChange: (next: MarketViewTab) => void;
  advancedFilters?: React.ReactNode;
  search?: React.ReactNode;
}) {
  return (
    <div
      className="grid grid-cols-[auto_1fr_auto] items-center gap-6 px-7 h-14 border-t border-b"
      style={{ borderColor: "var(--kwm-hl)" }}
    >
      {/* Tabs */}
      <div className="flex items-center h-full">
        {TABS.map((tab, i) => {
          const isActive = viewMode === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => onViewChange(tab.key)}
              className={`relative h-full font-(family-name:--font-geist-mono) text-[12px] uppercase tracking-widest cursor-pointer transition-colors ${
                i === 0 ? "pl-0 pr-4" : "px-4"
              }`}
              style={{
                color: isActive ? "var(--kwm-ink)" : "var(--kwm-ink-3)",
              }}
            >
              {tab.label}
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute -bottom-px h-px"
                  style={{
                    left: i === 0 ? 0 : "1rem",
                    right: "1rem",
                    background: "var(--kwm-up)",
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Center spacer */}
      <div />

      {/* Right — advanced filters + search */}
      <div className="inline-flex items-center gap-2 justify-self-end">
        {advancedFilters}
        {search && (
          <>
            <span aria-hidden="true" className="kwm-divider mx-1" />
            {search}
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Section header — `§ TITLE ─────  right-meta`
// ============================================================
function SectionHeader({
  title,
  rightMeta,
}: {
  title: string;
  rightMeta?: string;
}) {
  return (
    <div className="flex items-center gap-3 px-7 pt-7 pb-3.5">
      <span
        aria-hidden="true"
        className="font-(family-name:--font-geist-mono) text-[16px] font-semibold"
        style={{ color: "var(--kwm-ink-dim)" }}
      >
        §
      </span>
      <h2
        className="m-0 font-(family-name:--font-geist-mono) text-[13px] font-semibold uppercase tracking-[0.18em]"
        style={{ color: "var(--kwm-ink)" }}
      >
        {title}
      </h2>
      <span className="flex-1 h-px" style={{ background: "var(--kwm-hl)" }} />
      {rightMeta && (
        <span
          className="font-(family-name:--font-geist-mono) text-[11px] uppercase tracking-[0.14em] tabular-nums"
          style={{ color: "var(--kwm-ink-3)" }}
        >
          {rightMeta}
        </span>
      )}
    </div>
  );
}

// ============================================================
// Featured market card — Top of Book hero strip uses three of
// these side-by-side. Header (icon + title + outcome count) →
// option rows with proportional fill bar → footer (Vol · Liq ·
// Trade ↗). Sparklines are omitted until a real price-history
// endpoint is wired in.
// ============================================================
function FeaturedCard({
  event,
  history,
  isHistoryLoading,
}: {
  event: MarketViewEvent;
  history: PriceHistoryPoint[] | undefined;
  /** True while the batch fetch is in flight. Distinguishes the
   *  "loading" state (skeleton) from "loaded but empty" (dummy flat
   *  line) so cards whose tokens never had recorded trades don't sit
   *  under a permanent pulsing placeholder. */
  isHistoryLoading: boolean;
}) {
  const topMarkets = extractTopMarkets(event, 4);
  const outcomeCount = event.markets?.length || 0;
  const isBinary = outcomeCount === 1;
  const href = event.slug ? `/events/detail/${event.slug}` : "#";
  // Spark tint tracks the leader's direction (≥50% YES = up).
  const leaderUp = topMarkets[0] ? topMarkets[0].yes >= 0.5 : true;
  const sparkColor = leaderUp ? "var(--kwm-up)" : "var(--kwm-down)";

  return (
    <Link
      href={href}
      className="kwm-tob-card group flex flex-col rounded-[14px] border overflow-hidden transition-all duration-200 hover:-translate-y-px"
      style={{
        borderColor: "var(--kwm-hl)",
        background: "var(--kwm-panel)",
      }}
    >
      {/* Head — icon + title block + optional 30D sparkline at the
          right edge (renders only once history loads). */}
      <div className="grid grid-cols-[44px_1fr_auto] items-center gap-3.5 px-4 pt-4 pb-3.5">
        <div
          className="flex items-center justify-center h-11 w-11 rounded-[10px] overflow-hidden"
          style={{
            background: "var(--kwm-bg-3)",
            border: "1px solid var(--kwm-hl-2)",
          }}
        >
          {event.image ? (
            <Image
              src={event.image}
              alt=""
              width={44}
              height={44}
              className="object-cover h-full w-full"
            />
          ) : (
            <span
              className="font-(family-name:--font-geist-mono) text-[16px] font-semibold"
              style={{ color: "var(--kwm-ink-2)" }}
            >
              {event.title.slice(0, 1)}
            </span>
          )}
        </div>
        <div className="min-w-0">
          <div
            className="text-[16px] font-medium leading-snug line-clamp-2"
            style={{ color: "var(--kwm-ink)", letterSpacing: "-0.01em" }}
          >
            {event.title}
          </div>
          <div
            className="font-(family-name:--font-geist-mono) text-[10px] uppercase tracking-[0.14em] mt-1"
            style={{ color: "var(--kwm-ink-3)" }}
          >
            {outcomeCount > 1 ? `${outcomeCount} Outcomes` : "Binary"}
          </div>
        </div>
        {history && history.length >= 2 ? (
          <Spark data={history} w={60} h={24} color={sparkColor} />
        ) : isHistoryLoading ? (
          // Sparkline skeleton — matches Spark's 60×24 footprint so the
          // card geometry doesn't shift when history arrives.
          <div
            className="w-[60px] h-[24px] rounded-sm animate-pulse"
            style={{ background: "var(--kwm-hl-2)" }}
            aria-hidden="true"
          />
        ) : (
          // Dummy flat line — fetch completed but the CLOB token has no
          // recorded trades (e.g. brand-new or ultra-thin markets). A
          // muted, mid-height horizontal stroke keeps the card geometry
          // intact without misrepresenting movement.
          <span title="No 30-day history" className="inline-flex">
            <Spark
              data={DUMMY_SPARK_DATA}
              w={60}
              h={24}
              color="var(--kwm-ink-dim)"
            />
          </span>
        )}
      </div>

      {/* Outcome rows with proportional fill bar.
          When `outcomePrices` hasn't arrived for the markets yet (initial
          Gamma response is sometimes thin), we render placeholder rows
          rather than a bare "X outcomes · multi-market" caption — keeps
          card height stable so the layout doesn't reflow on data arrival. */}
      <div className="flex flex-col gap-1 px-4 pb-3.5 pt-1">
        {topMarkets.length > 0
          ? topMarkets.slice(0, isBinary ? 1 : 4).map((m, i) => {
              const pct = Math.round(m.yes * 100);
              const isLeader = i === 0;
              const isUp = m.yes >= 0.5 || isLeader;
              return (
                <OutcomeRow
                  key={m.id}
                  name={isBinary ? `YES at ${formatCents(m.yes)}` : m.title}
                  pct={pct}
                  isUp={isUp}
                />
              );
            })
          : [0, 1, 2, 3].map((i) => <OutcomeRowSkeleton key={i} />)}
      </div>

      {/* Footer — mt-auto pins it to the card bottom so the three
          equal-height grid cards align even when titles wrap to two
          lines and push the content block taller. */}
      <div
        className="mt-auto flex items-center justify-between px-4 py-3.5 border-t font-(family-name:--font-geist-mono)"
        style={{
          borderColor: "var(--kwm-hl)",
          background: "var(--kwm-bg-2)",
        }}
      >
        <FootStat
          lbl="Vol 24h"
          val={`${formatVolume(toNumber(event.volume24hr))}`}
        />
        <FootStat
          lbl="Liq"
          val={`${formatVolume(
            toNumber(event.liquidityClob) || toNumber(event.liquidity)
          )}`}
        />
        <span
          className="text-[10px] uppercase tracking-[0.14em] inline-flex items-center gap-1"
          style={{ color: "var(--kwm-up)" }}
        >
          Trade <ArrowUR />
        </span>
      </div>
    </Link>
  );
}

function OutcomeRow({
  name,
  pct,
  isUp,
}: {
  name: string;
  pct: number;
  isUp: boolean;
}) {
  return (
    <div
      className="grid grid-cols-[14px_1fr_auto] items-center gap-3 px-2.5 pt-2.5 pb-3 rounded-lg transition-colors hover:bg-(--kwm-hover)"
      style={{ background: "transparent" }}
    >
      <span
        aria-hidden="true"
        className="w-1.5 h-1.5 rounded-full justify-self-center"
        style={{
          background: isUp ? "var(--kwm-up)" : "var(--kwm-down)",
          opacity: 0.75,
        }}
      />
      <span
        className="text-[13.5px] font-medium truncate"
        style={{
          color: "var(--kwm-ink)",
          letterSpacing: "-0.005em",
        }}
      >
        {name}
      </span>
      <span
        className="font-(family-name:--font-geist-mono) text-[14px] font-medium tabular-nums min-w-[44px] text-right"
        style={{ color: "var(--kwm-ink)" }}
      >
        {pct}%
      </span>
      <span className={`kwm-track col-span-3 mt-1.5${isUp ? "" : " kwm-down"}`}>
        <span className="kwm-fill" style={{ width: `${Math.max(pct, 1)}%` }} />
      </span>
    </div>
  );
}

/**
 * Skeleton row used inside FeaturedCard while `outcomePrices` data is
 * en-route. Mirrors OutcomeRow's exact grid + spacing so the card height
 * stays stable when real rows replace it. Uses the panel's hl-2 token
 * for the placeholder bars so it tracks every theme.
 */
function OutcomeRowSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="grid grid-cols-[14px_1fr_auto] items-center gap-3 px-2.5 pt-2.5 pb-3 rounded-lg"
      style={{ background: "transparent" }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full justify-self-center animate-pulse"
        style={{ background: "var(--kwm-hl-2)" }}
      />
      <span
        className="h-3.5 rounded-sm animate-pulse w-[60%]"
        style={{ background: "var(--kwm-hl-2)" }}
      />
      <span
        className="h-3.5 rounded-sm animate-pulse w-10"
        style={{ background: "var(--kwm-hl-2)" }}
      />
      <span className="kwm-track col-span-3 mt-1.5">
        <span
          className="kwm-fill animate-pulse"
          style={{
            width: "30%",
            background: "var(--kwm-hl-2)",
          }}
        />
      </span>
    </div>
  );
}

function FootStat({ lbl, val }: { lbl: string; val: string }) {
  return (
    <div className="inline-flex items-center gap-2">
      <span
        className="font-(family-name:--font-geist-mono) text-[10px] uppercase tracking-[0.14em]"
        style={{ color: "var(--kwm-ink-3)" }}
      >
        {lbl}
      </span>
      <span
        className="text-[12px] tabular-nums"
        style={{ color: "var(--kwm-ink)", letterSpacing: "-0.01em" }}
      >
        {val}
      </span>
    </div>
  );
}

function ArrowUR() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="9 7 17 7 17 15" />
    </svg>
  );
}

// ============================================================
// The Book — dense table backed entirely by real fields.
// Columns: Market · Leader · 30D · Vol 24h ± · Liquidity ·
// Trade button. The 30D sparkline is driven by the price-history
// batch endpoint; the Vol 24h ± delta is computed from
// volume24hr / volume1wk.
//
// A "Move" column previously sat between Liquidity and Trade. It
// was removed: the batch runs at hourly fidelity, so the last two
// points differ by well under half a cent for most markets and
// `Math.round` collapsed them to 0 — which rendered as the same
// em-dash as "no history at all". The column was empty for the
// overwhelming majority of rows and could not distinguish "flat"
// from "unknown". The 30D sparkline carries direction instead.
// ============================================================
const BOOK_GRID =
  "grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_110px_140px_120px_100px] items-center gap-4";

function BookHead() {
  return (
    <div
      className={`${BOOK_GRID} kwm-frost sticky top-0 z-5 px-5 py-3.5 border-b font-(family-name:--font-geist-mono) text-[10px] font-medium uppercase tracking-[0.14em]`}
      style={{
        background: "color-mix(in oklch, var(--kwm-bg-2) 80%, transparent)",
        borderColor: "var(--kwm-hl)",
        color: "var(--kwm-ink-3)",
      }}
    >
      <span className="font-semibold text-(--kwm-ink-2)">Market</span>
      <span className="text-right">Leader</span>
      <span className="text-right">30D</span>
      <span className="text-right">
        Vol 24h <span style={{ color: "var(--kwm-up)" }}>↓</span>
      </span>
      <span className="text-right">Liquidity</span>
      <span />
    </div>
  );
}

function BookRow({
  event,
  history,
}: {
  event: MarketViewEvent;
  history: PriceHistoryPoint[] | undefined;
}) {
  const { outcomes, leader } = summarizeEvent(event);
  const href = event.slug ? `/events/detail/${event.slug}` : "#";
  const vol24 = toNumber(event.volume24hr);
  const vol1wk = toNumber(event.volume1wk);
  const liq = toNumber(event.liquidityClob) || toNumber(event.liquidity);
  const leaderPct = leader ? Math.round(leader.yes * 100) : null;
  const leaderIsDown = leader ? leader.yes < 0.5 : false;
  // Vol 24h delta = how today's volume compares to the trailing
  // weekly daily-average. Positive means today is hotter than the
  // last 7 days on average; negative means cooler. Skip when either
  // input is zero so we don't divide by zero or print noise.
  const volDelta =
    vol24 > 0 && vol1wk > 0 ? (vol24 / (vol1wk / 7) - 1) * 100 : null;
  // Spark tint follows the leader's overall direction — green for
  // up (yes ≥ 50%), red for down. Falls back to ink-3 if no leader.
  const sparkColor = leader
    ? leaderIsDown
      ? "var(--kwm-down)"
      : "var(--kwm-up)"
    : "var(--kwm-ink-3)";

  return (
    <Link
      href={href}
      className={`group ${BOOK_GRID} relative px-5 py-3.5 border-b text-[13px] transition-colors`}
      style={{
        borderColor: "var(--kwm-hl)",
        color: "var(--kwm-ink)",
      }}
    >
      {/* hairline accent on hover */}
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-px opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ background: "var(--kwm-up)" }}
      />

      {/* Market */}
      <div className="flex items-center gap-3.5 min-w-0">
        <div
          className="h-9 w-9 shrink-0 rounded-md overflow-hidden flex items-center justify-center"
          style={{
            border: "1px solid var(--kwm-hl-2)",
            background: "var(--kwm-bg-3)",
          }}
        >
          {event.image ? (
            <Image
              src={event.image}
              alt=""
              width={36}
              height={36}
              className="object-cover h-full w-full"
            />
          ) : (
            <span
              className="font-(family-name:--font-geist-mono) text-[13px] font-semibold"
              style={{ color: "var(--kwm-ink-2)" }}
            >
              {event.title.slice(0, 1)}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-0.5 min-w-0">
          <span
            className="text-[14px] font-medium truncate"
            style={{ color: "var(--kwm-ink)", letterSpacing: "-0.005em" }}
          >
            {event.title}
          </span>
          <span
            className="font-(family-name:--font-geist-mono) text-[10px] uppercase tracking-widest inline-flex items-center gap-2"
            style={{ color: "var(--kwm-ink-3)" }}
          >
            <span
              className="px-1.5 py-0.5 rounded-sm"
              style={{
                border: "1px solid var(--kwm-hl-2)",
                color: "var(--kwm-ink-2)",
              }}
            >
              {outcomes > 1 ? `×${outcomes}` : "BIN"}
            </span>
          </span>
        </div>
      </div>

      {/* Leader */}
      <div className="text-right inline-flex items-baseline gap-2.5 justify-end min-w-0">
        {leader ? (
          <>
            <span
              className="text-[13px] truncate"
              style={{ color: "var(--kwm-ink-2)" }}
            >
              {leader.title}
            </span>
            <span
              className="font-(family-name:--font-geist-mono) text-[13px] font-medium tabular-nums shrink-0"
              style={{
                color: leaderIsDown ? "var(--kwm-down)" : "var(--kwm-up)",
              }}
            >
              {leaderPct}%
            </span>
          </>
        ) : (
          <span
            className="font-(family-name:--font-geist-mono) text-[12px] tabular-nums"
            style={{ color: "var(--kwm-ink-3)" }}
          >
            —
          </span>
        )}
      </div>

      {/* 30D sparkline (real CLOB price history of the leader's YES
          token). Some leader tokens — typically newly-created or low-
          volume markets — return an empty history from CLOB. Show a
          dash in that case so the column reads as "no history" rather
          than visually collapsing. */}
      <div className="justify-self-end">
        {history && history.length >= 2 ? (
          <Spark data={history} w={100} h={22} color={sparkColor} />
        ) : (
          <span
            className="font-(family-name:--font-geist-mono) text-[12px] tabular-nums"
            style={{ color: "var(--kwm-ink-dim)" }}
            title="No 30-day history"
          >
            —
          </span>
        )}
      </div>

      {/* Vol 24h — value + delta vs. weekly daily-average */}
      <span className="text-right font-(family-name:--font-geist-mono) tabular-nums">
        <span
          className="text-[13px]"
          style={{ color: "var(--kwm-ink)", letterSpacing: "-0.01em" }}
        >
          {formatVolume(vol24)}
        </span>
        {volDelta !== null && Math.abs(volDelta) >= 0.1 ? (
          <span
            className="ml-1.5 text-[10px] tracking-[0.04em]"
            style={{
              color: volDelta < 0 ? "var(--kwm-down)" : "var(--kwm-up)",
            }}
          >
            {volDelta >= 0 ? "+" : ""}
            {volDelta.toFixed(1)}%
          </span>
        ) : null}
      </span>

      {/* Liquidity */}
      <span
        className="text-right font-(family-name:--font-geist-mono) text-[13px] tabular-nums"
        style={{ color: "var(--kwm-ink)", letterSpacing: "-0.01em" }}
      >
        {formatVolume(liq)}
      </span>

      {/* Trade */}
      <span className="justify-self-end">
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md font-(family-name:--font-geist-mono) text-[10px] uppercase tracking-widest transition-all"
          style={{
            border: "1px solid var(--kwm-hl-2)",
            background: "transparent",
            color: "var(--kwm-ink-2)",
          }}
        >
          <span className="group-hover:text-(--kwm-up) transition-colors">
            Trade
          </span>
          <ArrowUR />
        </span>
      </span>
    </Link>
  );
}

/** Skeleton — preserved as a named export because `home-content.tsx`
 *  imports it for the infinite-scroll loading state. */
export function TableSkeleton({ rows = 15 }: { rows?: number }) {
  return (
    <div className="kw-app animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className={`${BOOK_GRID} px-5 py-3.5 border-b`}
          style={{ borderColor: "var(--kwm-hl)" }}
        >
          <div className="flex items-center gap-3.5">
            <div
              className="h-9 w-9 rounded-md"
              style={{ background: "var(--kwm-bg-3)" }}
            />
            <div className="flex flex-col gap-1.5 flex-1">
              <div
                className="h-3.5 rounded-sm"
                style={{
                  background: "var(--kwm-bg-3)",
                  width: `${45 + ((i * 13) % 40)}%`,
                }}
              />
              <div
                className="h-2.5 w-24 rounded-sm"
                style={{ background: "var(--kwm-bg-3)" }}
              />
            </div>
          </div>
          <div
            className="h-3 w-28 rounded-sm justify-self-end"
            style={{ background: "var(--kwm-bg-3)" }}
          />
          <div
            className="h-3 w-20 rounded-sm justify-self-end"
            style={{ background: "var(--kwm-bg-3)" }}
          />
          <div
            className="h-3 w-20 rounded-sm justify-self-end"
            style={{ background: "var(--kwm-bg-3)" }}
          />
          <div
            className="h-3 w-16 rounded-sm justify-self-end"
            style={{ background: "var(--kwm-bg-3)" }}
          />
          <div
            className="h-6 w-20 rounded-md justify-self-end"
            style={{ background: "var(--kwm-bg-3)" }}
          />
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Default export
// ============================================================
export function MarketsView({
  events,
  totalResults,
  viewMode,
  onViewChange,
  advancedFilters,
  search,
  isTransitioning = false,
  dataUpdatedAt,
}: MarketsViewProps) {
  const sorted = useMemo(
    () =>
      [...events].sort(
        (a, b) => toNumber(b.volume24hr) - toNumber(a.volume24hr)
      ),
    [events]
  );

  const totalVolume = useMemo(
    () => sorted.reduce((sum, e) => sum + toNumber(e.volume24hr), 0),
    [sorted]
  );

  // Collect the leader YES token id for every visible event. We cap
  // at 40 (the batch endpoint's hard limit) — at 1 page (~20 events)
  // we're well under that, so no actual truncation in practice.
  const tokenByEventId = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of sorted) {
      const t = leaderTokenId(e);
      if (t) map.set(e.id, t);
    }
    return map;
  }, [sorted]);

  const tokenIds = useMemo(
    () => Array.from(tokenByEventId.values()).slice(0, 40),
    [tokenByEventId]
  );

  const { data: historyByToken, isPending: isHistoryPending } =
    useBatchPriceHistory(tokenIds, {
      enabled: tokenIds.length > 0,
    });

  /** Helper exposed to row/card components: given an event, return
   *  the 30D history for its leader's YES token, if loaded. */
  const historyFor = (eventId: string): PriceHistoryPoint[] | undefined => {
    const token = tokenByEventId.get(eventId);
    return token ? historyByToken?.get(token) : undefined;
  };
  // True only while the batch fetch is still in flight — used by
  // FeaturedCard / BookRow to distinguish "loading" (show skeleton)
  // from "loaded with no data" (show dummy flat-line). Without this,
  // events whose CLOB token never had recorded trades sit forever
  // under a pulsing skeleton even though the response already came
  // back with `histories: []`.
  const isHistoryLoading = tokenIds.length > 0 && isHistoryPending;

  if (events.length === 0 && !isTransitioning) return null;

  // Top of Book prefers multi-outcome events: a binary card renders a
  // single sparse row next to neighbors with four, breaking the strip's
  // visual rhythm. Binaries only backfill when the current view has
  // fewer than three multi-outcome events, so the hero never collapses.
  const featured = sorted.filter((e) => (e.markets?.length || 0) > 1);
  featured.splice(3);
  for (const event of sorted) {
    if (featured.length >= 3) break;
    if (!featured.includes(event)) featured.push(event);
  }
  const tableRows = sorted.filter((e) => !featured.includes(e));
  const activeCount = totalResults ?? sorted.length;

  return (
    <div className="-mx-3 sm:-mx-4 md:-mx-6 lg:-mx-8 min-h-[calc(100vh-4rem)]">
      {/* TopNav is rendered by `<ChromeHeader />` in home-content.tsx at
          the page level — same mounting pattern as every other product
          route. This wrapper hosts the markets-specific terminal chrome
          (utility bar → filter bar → book). The negative horizontal
          margins bleed past the parent main's `px-*` so the terminal
          extends edge-to-edge. */}
      <UtilityBar
        activeCount={activeCount}
        totalVolume24h={totalVolume}
        dataUpdatedAt={dataUpdatedAt}
      />
      <FilterBar
        viewMode={viewMode}
        onViewChange={onViewChange}
        advancedFilters={advancedFilters}
        search={search}
      />

      {/* Top of Book */}
      <section>
        <SectionHeader
          title="Top of Book"
          rightMeta={`${featured.length} / ${activeCount} MARKETS`}
        />
        <div className="grid grid-cols-3 gap-4 px-7">
          {isTransitioning
            ? [0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-[260px] rounded-[14px] border animate-pulse"
                  style={{
                    borderColor: "var(--kwm-hl)",
                    background: "var(--kwm-panel)",
                  }}
                />
              ))
            : featured.map((event, i) => (
                <FeaturedCard
                  key={`${event.id}-${i}`}
                  event={event}
                  history={historyFor(event.id)}
                  isHistoryLoading={isHistoryLoading}
                />
              ))}
        </div>
      </section>

      {/* The Book */}
      <section className="pb-20">
        <SectionHeader title="The Book" rightMeta="SORTED · VOL ↓" />
        <div className="px-7">
          <BookHead />
          <div>
            {isTransitioning ? (
              <TableSkeleton />
            ) : (
              tableRows.map((event, i) => (
                <BookRow
                  key={`${event.id}-${i}`}
                  event={event}
                  history={historyFor(event.id)}
                />
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
