"use client";

import { parseGammaNumberArray } from "@knoww/shared-types/polymarket";
import Image from "next/image";
import Link from "next/link";
import { useMemo } from "react";
import { TopNav } from "@/components/top-nav";
import { formatVolume } from "@/lib/formatters";

/**
 * Markets view — trading-terminal aesthetic for /markets at lg+.
 *
 * The desktop-only surface is structured as four stacked layers:
 *   1. Auto-scrolling ticker strip (top 12 markets by 24h volume)
 *   2. Editorial header with Fraunces italic accent on "markets"
 *   3. "Top of Book" hero strip — 3 featured markets with YES/NO split bars
 *   4. Dense data table — every other market as a ~56px row
 *
 * Numeric cells use JetBrains Mono (`font-mono`) and `tabular-nums` so
 * prices align across rows.
 *
 * Mobile/tablet (< lg) fall back to the standard card grid, which is
 * rendered by the parent; this component only mounts at lg+.
 */

// Public contract — the minimal event shape this view needs. Kept loose
// on purpose so both the paginated hook's events and the SSR initial
// events fit without casting.
//
// `question`, `groupItemTitle`, and `outcomePrices` on the sub-markets
// are optional because they're only included when the API is called
// with `?markets=full`. Without them, the top-candidates list falls
// back to just the outcome count.
export interface MarketViewEvent {
  id: string;
  slug?: string;
  title: string;
  image?: string;
  volume?: string;
  volume24hr?: number | string;
  liquidity?: number | string;
  liquidityClob?: number | string;
  markets?: Array<{
    id: string;
    question?: string;
    groupItemTitle?: string;
    outcomes?: string;
    outcomePrices?: string;
  }>;
}

/** One sub-market summarized for row rendering. `title` prefers
 *  groupItemTitle (the short candidate name like "Oklahoma City
 *  Thunder") and falls back to question ("Will the Thunder win?") when
 *  the group title isn't set. */
interface SubMarket {
  id: string;
  title: string;
  yes: number;
  no: number;
}

/** Tab modes that drive the event list — aligned with the existing
 *  ViewMode type from home-content.tsx. Kept as a string literal here so
 *  this module doesn't need to import from home-content (which would
 *  risk a circular import). */
type MarketViewTab = "categories" | "trending" | "breaking" | "new";

interface MarketsViewProps {
  events: MarketViewEvent[];
  totalResults?: number;
  /** Active tab for the primary market filter. */
  viewMode: MarketViewTab;
  /** Invoked when the user picks a new tab. Parent decides whether to
   *  wrap in startTransition for non-urgent updates. */
  onViewChange: (next: MarketViewTab) => void;
  /** Slot for the existing `<DesktopFilterChips>` — advanced filters
   *  (Created date, Liquidity, Status, Tags, Volume window). Rendered
   *  inline in the pro filter bar without any wrapping. */
  advancedFilters?: React.ReactNode;
  /** Slot for the existing `<MarketSearch>` component. */
  search?: React.ReactNode;
  /** When true, render a table-shaped skeleton in place of the rows.
   *  Used for tab-switch transitions so the loading state matches the
   *  pro aesthetic (no card skeletons bleeding through). */
  isTransitioning?: boolean;
}

const TABS: Array<{ key: MarketViewTab; label: string }> = [
  { key: "categories", label: "All" },
  { key: "trending", label: "Trending" },
  { key: "breaking", label: "Breaking" },
  { key: "new", label: "New" },
];

/** Terminal-style filter bar. Mono-caps tab labels with a thin primary
 *  underline marking the active tab. Advanced filter chips and search
 *  live on the right, separated by a hairline. Renders only inside
 *  MarketsView — the card-grid layout keeps its original styling. */
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
    <div className="flex items-center justify-between gap-6 border-y border-border/60 px-1 py-3">
      {/* Tabs */}
      <div className="flex items-center gap-1">
        {TABS.map((tab) => {
          const isActive = viewMode === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => onViewChange(tab.key)}
              className={`group relative px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.15em] transition-colors ${
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
              {/* Hairline underline anchors the active tab without
                  changing layout. Inactive tabs show a faint hover
                  underline to hint interactivity. */}
              <span
                className={`absolute left-3 right-3 -bottom-[13px] h-px transition-[background-color,opacity] ${
                  isActive
                    ? "bg-primary opacity-100"
                    : "bg-foreground/40 opacity-0 group-hover:opacity-100"
                }`}
              />
            </button>
          );
        })}
      </div>

      {/* Right side — advanced filters + search */}
      <div className="flex items-center gap-4">
        {advancedFilters && (
          <div className="flex items-center gap-1.5">{advancedFilters}</div>
        )}
        {search && (
          <>
            <span aria-hidden="true" className="h-4 w-px bg-border/60" />
            {search}
          </>
        )}
      </div>
    </div>
  );
}

/** Convert a 0-1 decimal price (e.g. "0.68") to a ¢-suffixed integer
 *  string ("68¢"). Used for YES/NO outcome prices. Returns "—" for
 *  missing or non-numeric input. */
function formatCents(price: number | string | null | undefined): string {
  if (price === undefined || price === null) return "—";
  const n = typeof price === "string" ? Number.parseFloat(price) : price;
  if (Number.isNaN(n)) return "—";
  return `${Math.round(n * 100)}¢`;
}

/** Numeric volume coerce — tolerates number-ish strings from the API. */
function toNumber(v: number | string | undefined): number {
  if (v === undefined || v === null) return 0;
  const n = typeof v === "string" ? Number.parseFloat(v) : v;
  return Number.isNaN(n) ? 0 : n;
}

/** Extract the top N sub-markets of an event, sorted by YES price
 *  descending. This is the "Polymarket home-page treatment" — for a
 *  multi-candidate event like "2026 NBA Champion", returns the two or
 *  three highest-probability teams so they can be surfaced inline.
 *
 *  Returns an empty array when:
 *  - The event has no markets
 *  - The sub-markets came back slim (no `outcomePrices`) — happens when
 *    the API call didn't include `?markets=full`. Callers fall back to
 *    the outcome count in that case.
 *
 *  For a truly binary event (1 market, YES/NO), returns a single entry. */
function extractTopMarkets(event: MarketViewEvent, limit = 3): SubMarket[] {
  const markets = event.markets ?? [];
  const parsed: SubMarket[] = [];
  for (const m of markets) {
    const prices = parseGammaNumberArray(m.outcomePrices);
    if (prices.length < 2) continue;
    const yes = prices[0];
    const no = prices[1];
    if (Number.isNaN(yes) || Number.isNaN(no)) continue;
    parsed.push({
      id: m.id,
      title: m.groupItemTitle || m.question || "Outcome",
      yes,
      no,
    });
  }
  parsed.sort((a, b) => b.yes - a.yes);
  return parsed.slice(0, limit);
}

/** Event-level summary: outcome count + the leader (highest YES
 *  price). Leader is null for events with no parseable sub-markets. */
function summarizeEvent(event: MarketViewEvent): {
  outcomes: number;
  leader: SubMarket | null;
} {
  const count = event.markets?.length || 0;
  const [leader] = extractTopMarkets(event, 1);
  return { outcomes: count, leader: leader ?? null };
}

/** The YES/NO split bar — the product's primary visual primitive. A
 *  horizontal strip that splits proportionally to the market's implied
 *  probability. YES is brand green, NO is a dampened crimson. */
function SplitBar({
  yes,
  no,
  showLabels = false,
  compact = false,
}: {
  yes: number | null;
  no: number | null;
  showLabels?: boolean;
  compact?: boolean;
}) {
  if (yes === null || no === null) {
    return (
      <div
        className={`w-full ${compact ? "h-1.5" : "h-2"} rounded-full bg-muted/60 overflow-hidden`}
      />
    );
  }
  const yesPct = Math.max(0, Math.min(100, yes * 100));
  const noPct = Math.max(0, Math.min(100, no * 100));

  return (
    <div className="w-full">
      <div
        className={`flex w-full ${compact ? "h-1.5" : "h-2"} rounded-full overflow-hidden bg-muted/40`}
        role="img"
        aria-label={`YES ${Math.round(yesPct)}% · NO ${Math.round(noPct)}%`}
      >
        <div
          className="h-full bg-emerald-600/85 dark:bg-emerald-500/80"
          style={{ width: `${yesPct}%` }}
        />
        <div
          className="h-full bg-rose-600/70 dark:bg-rose-500/65"
          style={{ width: `${noPct}%` }}
        />
      </div>
      {showLabels && (
        <div className="mt-2 flex justify-between font-mono text-[11px] tabular-nums">
          <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
            YES {formatCents(yes)}
          </span>
          <span className="text-rose-700 dark:text-rose-400 font-semibold">
            NO {formatCents(no)}
          </span>
        </div>
      )}
    </div>
  );
}

/** Auto-scrolling ticker strip — reuses the `@keyframes ticker` +
 *  `.kw-ticker-track` primitives from globals.css (originally built for
 *  the landing page). Content doubles so the scroll can loop
 *  seamlessly. */
function Ticker({ events }: { events: MarketViewEvent[] }) {
  // Take top 12 by 24h volume (events are already sorted upstream, but
  // this guards against the caller passing an unsorted list).
  const items = useMemo(() => {
    const sorted = [...events]
      .sort((a, b) => toNumber(b.volume24hr) - toNumber(a.volume24hr))
      .slice(0, 12);
    return sorted.map((event) => {
      // Ticker shows the single leading price per event; for binary
      // markets that's the YES, for multi-candidate events that's the
      // top candidate's YES.
      const [leader] = extractTopMarkets(event, 1);
      return {
        id: event.id,
        slug: event.slug,
        // Strip trailing "?" / punctuation — the ticker reads as a list of
        // tags, not a list of questions.
        label: event.title.replace(/\?$/, "").slice(0, 38),
        price: formatCents(leader?.yes),
        vol: formatVolume(event.volume),
      };
    });
  }, [events]);

  if (items.length === 0) return null;

  // Double the list so the infinite-scroll loop has no seam.
  const loop = [...items, ...items];

  return (
    <div className="kw-ticker-track relative overflow-hidden border-y border-border/60 bg-muted/30">
      <div className="flex gap-8 whitespace-nowrap animate-[ticker_90s_linear_infinite] py-2.5">
        {loop.map((item, i) => (
          <Link
            key={`${item.id}-${i}`}
            href={item.slug ? `/events/detail/${item.slug}` : "#"}
            className="group flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.12em] shrink-0"
          >
            <span className="h-1 w-1 rounded-full bg-emerald-500" />
            <span className="text-foreground/70 group-hover:text-foreground transition-colors">
              {item.label}
            </span>
            <span className="text-foreground font-semibold tabular-nums">
              {item.price}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {item.vol}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Featured market tile — the "Top of Book" hero strip uses three of
 *  these side-by-side. Layout:
 *   - Header: image + title
 *   - Body: either a YES/NO split bar (binary) or the top-3 candidates
 *     with inline YES prices (multi-market)
 *   - Footer: Vol 24h + Liquidity
 *
 *  For multi-market events with full data, the top candidates read as
 *  mini leaderboard rows. Without full data (slim markets from SSR or
 *  before the pro fetch lands), falls back to an "N outcomes" pill. */
function FeaturedTile({ event }: { event: MarketViewEvent }) {
  const vol24 = toNumber(event.volume24hr);
  const outcomesCount = event.markets?.length || 0;
  const topMarkets = extractTopMarkets(event, 3);
  const isBinary = outcomesCount === 1;
  const hasData = topMarkets.length > 0;
  const href = event.slug ? `/events/detail/${event.slug}` : "#";

  return (
    <Link
      href={href}
      className="group relative flex flex-col gap-4 rounded-lg border border-border bg-card/50 p-5 transition-[border-color,background-color] duration-200 hover:border-primary/50 hover:bg-card"
    >
      <div className="flex items-start gap-3">
        {event.image && (
          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md border border-border/50">
            <Image
              src={event.image}
              alt=""
              fill
              sizes="40px"
              className="object-cover"
            />
          </div>
        )}
        <h3 className="text-[15px] font-semibold leading-snug tracking-tight line-clamp-2 group-hover:text-primary transition-colors">
          {event.title}
        </h3>
      </div>

      {isBinary && hasData ? (
        // Binary market → split bar with YES/NO price labels
        <SplitBar yes={topMarkets[0].yes} no={topMarkets[0].no} showLabels />
      ) : hasData ? (
        // Multi-market → top candidates as mini leaderboard rows
        <ul className="space-y-1.5">
          {topMarkets.map((m) => (
            <li
              key={m.id}
              className="flex items-baseline justify-between gap-3 text-[13px]"
            >
              <span className="truncate text-foreground/90 font-medium">
                {m.title}
              </span>
              <span className="shrink-0 font-mono tabular-nums text-emerald-700 dark:text-emerald-400 font-semibold">
                {Math.round(m.yes * 100)}%
              </span>
            </li>
          ))}
        </ul>
      ) : (
        // No sub-market data (slim payload) → fall back to count
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          <span className="inline-flex h-5 items-center rounded bg-muted px-2 tabular-nums">
            {outcomesCount} outcomes
          </span>
          <span>multi-market</span>
        </div>
      )}

      <div className="mt-auto flex items-baseline justify-between border-t border-border/50 pt-3 font-mono text-[11px] uppercase tracking-[0.12em] tabular-nums">
        <div>
          <span className="text-muted-foreground">Vol 24h </span>
          <span className="text-foreground font-semibold">
            {formatVolume(vol24)}
          </span>
        </div>
        <div>
          <span className="text-muted-foreground">Liq </span>
          <span className="text-foreground font-semibold">
            {formatVolume(
              toNumber(event.liquidityClob) || toNumber(event.liquidity)
            )}
          </span>
        </div>
      </div>
    </Link>
  );
}

/** Shared grid template for the table header and rows — kept in one
 *  place so the two stay in lockstep as columns change.
 *  Market (2fr) | Leader (1.3fr, name + YES%) | Vol 24h | Liquidity */
const TABLE_GRID =
  "grid grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_130px_130px] items-center gap-4";

/** Table skeleton — renders during tab transitions, initial load, and
 *  infinite-scroll appends so this view never shows card skeletons.
 *  Row count matches the typical page size (20) so the layout height
 *  is stable across transitions. Each row has placeholder bars that
 *  mirror the real TableRow structure.
 *
 *  Exported so home-content.tsx can append it below the table when
 *  paginating (infinite scroll), keeping the skeleton behavior
 *  consistent across all loading surfaces. */
export function TableSkeleton({ rows = 15 }: { rows?: number }) {
  return (
    <div className="animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className={`${TABLE_GRID} border-b border-border/60 px-4 py-3`}
        >
          {/* Market thumb + title bar */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-7 w-7 shrink-0 rounded-md bg-muted/60" />
            <div
              className="h-3.5 bg-muted/60 rounded-sm"
              style={{ width: `${45 + ((i * 13) % 40)}%` }}
            />
          </div>
          {/* Leader column — wider placeholder because it holds both the
              candidate name and the YES%. */}
          <div className="h-3 w-28 bg-muted/60 rounded-sm justify-self-end" />
          <div className="h-3 w-20 bg-muted/60 rounded-sm justify-self-end" />
          <div className="h-3 w-20 bg-muted/60 rounded-sm justify-self-end" />
        </div>
      ))}
    </div>
  );
}

/** Dense table row. Monospace for all numbers, hairline dividers, left
 *  border turns primary on hover. Entire row is a Link.
 *
 *  YES/NO columns were dropped in Pass A-revised — since most events on
 *  Polymarket are multi-market (N candidates / outcomes), a single
 *  YES/NO at the event level isn't meaningful. The outcome count column
 *  (× N) carries the "click through to see positions" signal instead. */
function TableRow({ event }: { event: MarketViewEvent }) {
  const { outcomes, leader } = summarizeEvent(event);
  const href = event.slug ? `/events/detail/${event.slug}` : "#";
  const vol24 = toNumber(event.volume24hr);
  const liq = toNumber(event.liquidityClob) || toNumber(event.liquidity);

  return (
    <Link
      href={href}
      className={`group ${TABLE_GRID} border-b border-border/60 px-4 py-3 text-[13px] transition-colors hover:bg-primary/4 relative`}
    >
      {/* Border-left accent on hover — signals active row without shifting
          layout. */}
      <span className="absolute left-0 top-0 bottom-0 w-px bg-primary opacity-0 group-hover:opacity-100 transition-opacity" />

      {/* Market column: thumb + title */}
      <div className="flex items-center gap-3 min-w-0">
        {event.image ? (
          <div className="relative h-7 w-7 shrink-0 overflow-hidden rounded-md border border-border/50">
            <Image
              src={event.image}
              alt=""
              fill
              sizes="28px"
              className="object-cover"
            />
          </div>
        ) : (
          <div className="h-7 w-7 shrink-0 rounded-md border border-border/50 bg-muted" />
        )}
        <span className="truncate font-medium text-foreground/90 group-hover:text-foreground">
          {event.title}
        </span>
      </div>

      {/* Leader — for events with parseable sub-markets, shows the
          highest-YES candidate inline. Falls back to `×N` when the
          slim payload was returned without outcomePrices. */}
      {leader ? (
        <div className="flex items-baseline gap-2 min-w-0 text-right justify-end">
          <span className="truncate text-foreground/80 text-[12px]">
            {leader.title}
          </span>
          <span className="shrink-0 font-mono tabular-nums text-emerald-700 dark:text-emerald-400 font-semibold">
            {Math.round(leader.yes * 100)}%
          </span>
        </div>
      ) : (
        <span className="font-mono tabular-nums text-right text-muted-foreground">
          {outcomes > 1 ? `×${outcomes}` : "·"}
        </span>
      )}

      {/* Vol 24h */}
      <span className="font-mono tabular-nums text-right text-foreground/85">
        {formatVolume(vol24)}
      </span>

      {/* Liquidity */}
      <span className="font-mono tabular-nums text-right text-foreground/85">
        {formatVolume(liq)}
      </span>
    </Link>
  );
}

export function MarketsView({
  events,
  totalResults,
  viewMode,
  onViewChange,
  advancedFilters,
  search,
  isTransitioning = false,
}: MarketsViewProps) {
  // Sort by 24h volume so "Top of Book" is genuinely the top. Hooks run
  // unconditionally (Rules of Hooks) — the empty-state early return
  // happens after all hook calls.
  const sorted = useMemo(
    () =>
      [...events].sort(
        (a, b) => toNumber(b.volume24hr) - toNumber(a.volume24hr)
      ),
    [events]
  );

  // Aggregate stats for the editorial header meta-strip.
  const totalVolume = useMemo(
    () => sorted.reduce((sum, e) => sum + toNumber(e.volume24hr), 0),
    [sorted]
  );

  // During transitions we intentionally render with an empty events
  // array so the skeleton path kicks in; only bail when there's no
  // data AND we're not loading (true empty state — parent handles it).
  if (events.length === 0 && !isTransitioning) return null;

  const featured = sorted.slice(0, 3);
  const tableRows = sorted.slice(3);

  return (
    <div className="space-y-8">
      {/* Top nav — provides every primary link + the full category
          taxonomy + wallet + theme. */}
      <div className="-mt-[18px]">
        {/* Small negative margin pulls the nav tight to the Navbar's
            (invisible at xl+) slot — keeps the ticker and header from
            sitting too far down the viewport. */}
        <TopNav />
      </div>

      {/* Ticker strip */}
      <Ticker events={sorted} />

      {/* Editorial header */}
      <div className="flex items-end justify-between gap-6 px-1">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground mb-3">
            § KNOWW MARKETS · LIVE
          </div>
          <h1 className="text-[56px] leading-none font-bold tracking-[-0.02em]">
            Explore{" "}
            <span className="kw-editorial italic font-medium text-foreground">
              markets
            </span>
            .
          </h1>
        </div>

        <div className="pb-2 text-right font-mono text-[11px] uppercase tracking-[0.15em] tabular-nums">
          <div className="text-muted-foreground">
            <span className="text-foreground font-semibold">
              {totalResults ?? sorted.length}
            </span>{" "}
            active
          </div>
          <div className="text-muted-foreground mt-1">
            <span className="text-foreground font-semibold">
              {formatVolume(totalVolume)}
            </span>{" "}
            24h vol
          </div>
        </div>
      </div>

      {/* Pro filter bar — terminal-style tabs + advanced filters + search */}
      <FilterBar
        viewMode={viewMode}
        onViewChange={onViewChange}
        advancedFilters={advancedFilters}
        search={search}
      />

      {/* Top of Book hero strip. During transitions show 3 tile-shaped
          skeletons so the layout doesn't jump as data swaps in. */}
      <section aria-labelledby="top-of-book">
        <div className="flex items-center gap-3 mb-4 px-1">
          <h2
            id="top-of-book"
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground"
          >
            § Top of Book
          </h2>
          <div className="h-px flex-1 bg-border/60" />
        </div>
        {isTransitioning ? (
          <div className="grid grid-cols-3 gap-4 animate-pulse">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-[170px] rounded-lg border border-border bg-muted/40"
              />
            ))}
          </div>
        ) : (
          featured.length > 0 && (
            <div className="grid grid-cols-3 gap-4">
              {featured.map((event, i) => (
                <FeaturedTile key={`${event.id}-${i}`} event={event} />
              ))}
            </div>
          )
        )}
      </section>

      {/* Market table. Header always renders (gives the table an anchor
          during transitions); body swaps to TableSkeleton when loading. */}
      <section aria-labelledby="market-table">
        <div className="flex items-center gap-3 mb-2 px-1">
          <h2
            id="market-table"
            className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground"
          >
            § The Book
          </h2>
          <div className="h-px flex-1 bg-border/60" />
        </div>

        {/* Sticky header row — monospace column labels. Uses the same
            TABLE_GRID template as TableRow so columns line up. */}
        <div
          className={`sticky top-0 z-10 ${TABLE_GRID} border-b border-border bg-background/95 backdrop-blur-sm px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground`}
        >
          <span>Market</span>
          <span className="text-right">Leader</span>
          <span className="text-right">Vol 24h</span>
          <span className="text-right">Liquidity</span>
        </div>

        <div className="border-x border-b border-border rounded-b-sm">
          {isTransitioning ? (
            <TableSkeleton />
          ) : (
            tableRows.map((event, i) => (
              <TableRow key={`${event.id}-${i}`} event={event} />
            ))
          )}
        </div>
      </section>
    </div>
  );
}
