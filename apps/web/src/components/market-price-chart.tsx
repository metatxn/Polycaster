"use client";

import { createLogger } from "@knoww/logger";
import { useQuery } from "@tanstack/react-query";

const log = createLogger("market-price-chart");

import {
  type CrosshairMode,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  LineSeries,
  type LineStyle,
  type LineType,
  TickMarkType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Price history data point from Polymarket API
 * @see https://docs.polymarket.com/api-reference/pricing/get-price-history-for-a-traded-token
 */
interface PriceHistoryPoint {
  t: number; // UTC timestamp (seconds)
  p: number; // Price (0-1)
}

interface TokenInfo {
  tokenId: string;
  name: string;
  color: string;
}

// Stable empty-array references for unset props. Using `= []` inline in
// the parameter destructuring re-allocates on every render, which makes
// downstream useMemo/useEffect deps unstable and can chain into an
// infinite render loop (most visible on the Graph tab + ALL time range
// where the downstream effect calls `chart.timeScale().fitContent()`).
const EMPTY_TOKENS: TokenInfo[] = [];
const EMPTY_STRINGS: string[] = [];

interface MarketPriceChartProps {
  /** Primary series — always rendered. For multi-outcome events this is
   *  the YES token for each candidate. */
  tokens?: TokenInfo[];
  /** Secondary series — rendered only when the "Both" toggle is on. For
   *  multi-outcome events this is the NO token for each candidate, paired
   *  with `tokens` by index. */
  secondaryTokens?: TokenInfo[];
  /** Token ID of the currently-selected candidate. When provided, that
   *  series renders with a thicker line and is the only one to show a
   *  dashed current-price marker on the right edge. Other series still
   *  render in their configured colors but stay visually subordinate. */
  activeTokenId?: string;
  /** Fallback: outcome names (used if tokens not provided) */
  outcomes?: string[];
  /** Fallback: current outcome prices (used if tokens not provided) */
  outcomePrices?: string[];
  /** ISO date string for when the market/event started */
  startDate?: string;
  /** Default time range selection (defaults to "ALL") */
  defaultTimeRange?: TimeRange;
  /** Called when per-outcome price changes for the active time range are available */
  onOutcomeRangeChanges?: (changes: number[]) => void;
  /** Hide the "Both" outcomes toggle (primary-only view, no user toggle).
   *  Used by the compact per-candidate chart inside the outcomes table,
   *  where YES/NO mirror each other and the toggle adds no signal. */
  hideBothToggle?: boolean;
}

export type TimeRange = "1H" | "6H" | "1D" | "1W" | "1M" | "ALL";

// Map time range to startTs offset (seconds ago from now)
const timeRangeToStartTsOffset: Record<TimeRange, number> = {
  "1H": 60 * 60,
  "6H": 6 * 60 * 60,
  "1D": 24 * 60 * 60,
  "1W": 7 * 24 * 60 * 60,
  "1M": 30 * 24 * 60 * 60,
  ALL: 365 * 24 * 60 * 60,
};

// Map time range to fidelity (resolution in minutes). Tightened from the
// original set — fewer minutes per bucket means more data points, which
// is the single biggest factor in how smooth a line looks. With the
// monotonic-curve interpolation on, dense data + curved interpolation
// reads as a proper time-series chart; sparse data reads as "hand-drawn".
// ALL is handled separately by `computeFidelityFromSpan`: we don't want
// a year of 1-minute data for mature markets, but we DO want minute-level
// data for a market that's only been live for a day.
const timeRangeToFidelity: Record<Exclude<TimeRange, "ALL">, number> = {
  "1H": 1,
  "6H": 1,
  "1D": 5,
  "1W": 30,
  "1M": 120,
};

/**
 * Choose a fidelity for the "ALL" range that gives ~300-500 points no
 * matter how old or young the market is. `spanSeconds` is the actual
 * elapsed span we're fetching (startDate → now, or a 1-year fallback).
 */
function computeFidelityFromSpan(spanSeconds: number): number {
  const spanMinutes = spanSeconds / 60;
  // Target ~400 points. Fidelity has to land on a whole minute.
  const raw = Math.max(1, Math.round(spanMinutes / 400));
  // Snap to common buckets so the API cache has a chance to hit.
  const buckets = [1, 5, 15, 30, 60, 120, 240, 360, 720, 1440];
  for (const b of buckets) {
    if (raw <= b) return b;
  }
  return 1440;
}

const DEFAULT_COLORS = [
  "hsl(25, 95%, 53%)", // Orange
  "hsl(221, 83%, 53%)", // Blue
  "hsl(280, 100%, 70%)", // Purple/Pink
  "hsl(142, 76%, 36%)", // Green
];

interface BatchPriceHistoryResponse {
  success: boolean;
  histories?: Array<{ tokenId: string; history: PriceHistoryPoint[] }>;
  error?: string;
}

/**
 * Fetch price history for many tokens in a single round trip.
 * The server fans out to Polymarket in parallel and each upstream call is
 * individually cached (60s), so repeated batches reuse the cache.
 */
async function fetchPriceHistoryBatch(
  tokenIds: string[],
  startTs: number,
  fidelity: number
): Promise<Map<string, PriceHistoryPoint[]>> {
  const valid = tokenIds.filter((id) => id && id.length > 10);
  const result = new Map<string, PriceHistoryPoint[]>();
  if (valid.length === 0) return result;

  try {
    const response = await fetch("/api/markets/price-history/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenIds: valid, startTs, fidelity }),
    });
    if (!response.ok) {
      log.warn("batch_price_history.fetch_failed", { status: response.status });
      return result;
    }
    const data = (await response.json()) as BatchPriceHistoryResponse;
    if (!data.success || !data.histories) return result;
    for (const entry of data.histories) {
      result.set(entry.tokenId, entry.history);
    }
    return result;
  } catch (error) {
    log.error("batch_price_history.fetch_error", { error });
    return result;
  }
}

/**
 * Pick theme-appropriate chart colors by reading CSS custom properties.
 * The app uses Tailwind's dark-class strategy; we recompute on theme flip.
 */
function readThemeColors() {
  if (typeof window === "undefined") {
    return {
      text: "#6b7280",
      grid: "rgba(148, 163, 184, 0.15)",
      crosshair: "rgba(148, 163, 184, 0.5)",
    };
  }
  const isDark = document.documentElement.classList.contains("dark");
  return {
    text: isDark ? "rgb(148, 163, 184)" : "rgb(100, 116, 139)",
    grid: isDark ? "rgba(148, 163, 184, 0.12)" : "rgba(148, 163, 184, 0.2)",
    crosshair: isDark ? "rgba(148, 163, 184, 0.6)" : "rgba(100, 116, 139, 0.6)",
  };
}

/**
 * Convert Polymarket history points (seconds, 0–1 price) to lightweight-charts
 * line data (UTC seconds, percentage). Deduplicates by timestamp and sorts
 * ascending — lightweight-charts rejects unsorted / duplicate time values.
 */
function toLineData(
  history: PriceHistoryPoint[]
): Array<{ time: UTCTimestamp; value: number }> {
  if (history.length === 0) return [];
  const byTime = new Map<number, number>();
  for (const point of history) {
    byTime.set(point.t, point.p * 100);
  }
  return Array.from(byTime.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([t, value]) => ({ time: t as UTCTimestamp, value }));
}

export function MarketPriceChart({
  tokens = EMPTY_TOKENS,
  secondaryTokens = EMPTY_TOKENS,
  activeTokenId,
  outcomes = EMPTY_STRINGS,
  outcomePrices = EMPTY_STRINGS,
  startDate,
  defaultTimeRange = "ALL",
  onOutcomeRangeChanges,
  hideBothToggle = false,
}: MarketPriceChartProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>(defaultTimeRange);
  // `showBothOutcomes` controls whether the secondary series (NO tokens for
  // multi-outcome, NO token for single-market) are layered in alongside the
  // primary YES series. Off by default: a cleaner view that only shows YES
  // trajectories. Toggling on adds matching NO lines for each market. The
  // toggle itself is hidden when `hideBothToggle` is true, pinning the view
  // to primary-only for compact per-candidate charts.
  const [showBothOutcomes, setShowBothOutcomes] = useState(false);
  // Hover-only flag labels, Polymarket-style. Each pill is positioned at
  // the crosshair X (horizontal) and its own series' Y at the hovered time
  // (vertical). Only populated while the cursor is inside the plot;
  // cleared on crosshair leave. The persistent top-left text legend (see
  // `legendItems`) carries the at-rest identity.
  const [hoverLabels, setHoverLabels] = useState<{
    x: number;
    // When true the pill is anchored to the RIGHT of its `x` (grows
    // leftward) — used when the cursor is near the right edge so labels
    // don't spill into the price-scale gutter or the trading panel next
    // to the chart.
    flipped: boolean;
    items: Array<{
      key: string;
      name: string;
      color: string;
      pct: string;
      y: number;
    }>;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  // Manually-managed price lines that reflect the *live* on-chain price
  // (from `outcomePrices`) rather than the last history-endpoint trade,
  // which can be days stale or a dust-trade outlier.
  const currentPriceLineRef = useRef<Map<string, IPriceLine>>(new Map());
  // Latest props kept in refs so `updateLabels` can stay a stable callback
  // across renders. Avoids re-subscribing to visible-range / resize events.
  const outcomePricesRef = useRef<string[]>(outcomePrices);
  outcomePricesRef.current = outcomePrices;

  // Crosshair hover state kept in refs so the update callback can stay
  // stable. Null when the cursor is outside the plot — `updateHoverLabels`
  // clears the label state in that case. When set, `hoverValuesRef` holds
  // the per-series value at the hovered time and `crosshairXRef` holds
  // the cursor x (in container pixels) so labels can follow horizontally.
  const hoverValuesRef = useRef<Map<string, number> | null>(null);
  const crosshairXRef = useRef<number | null>(null);

  // Calculate startTs + fidelity per time range. For "ALL" we prefer the
  // market's own start date (so a 2-day-old market doesn't ask for a year
  // of data with 12-hour buckets — that's what produced the "hand-drawn"
  // look with ~4 visible points). Fidelity is then chosen to target ~400
  // data points across that span, which reads as a smooth curve once the
  // monotonic Curved interpolation is applied.
  const nowSec = Math.floor(Date.now() / 1000);
  let startTs: number;
  let fidelity: number;
  if (timeRange === "ALL") {
    const parsedStart = startDate
      ? Math.floor(new Date(startDate).getTime() / 1000)
      : Number.NaN;
    const fallback = nowSec - timeRangeToStartTsOffset.ALL;
    startTs = Number.isFinite(parsedStart)
      ? Math.min(parsedStart, nowSec)
      : fallback;
    fidelity = computeFidelityFromSpan(Math.max(60, nowSec - startTs));
  } else {
    startTs = nowSec - timeRangeToStartTsOffset[timeRange];
    fidelity = timeRangeToFidelity[timeRange];
  }

  // Combine primary + secondary tokens into the fetch set. When "Both" is
  // off, the series builder hides the secondary rows; the fetch still runs
  // so toggling on is instant (no new network round-trip).
  const allFetchTokens = useMemo(
    () => [...tokens, ...secondaryTokens],
    [tokens, secondaryTokens]
  );

  // Check if we have valid token IDs
  const hasValidTokens =
    allFetchTokens.length > 0 &&
    allFetchTokens.some((t) => t.tokenId?.length > 10);

  // Fetch price history for all tokens
  const {
    data: priceHistories,
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: [
      "priceHistory",
      allFetchTokens.map((t) => t.tokenId),
      timeRange,
      fidelity,
    ],
    queryFn: async () => {
      const byToken = await fetchPriceHistoryBatch(
        allFetchTokens.map((t) => t.tokenId),
        startTs,
        fidelity
      );
      return allFetchTokens.map((token) => ({
        tokenId: token.tokenId,
        name: token.name,
        color: token.color,
        history: byToken.get(token.tokenId) ?? [],
      }));
    },
    enabled: hasValidTokens,
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  // Resolved series config (real history when available, mock otherwise).
  // When `showBothOutcomes` is false we keep only the first outcome —
  // matching Polymarket's default single-line view.
  //
  // We deliberately *do not* fall back to mock while the query is loading or
  // refetching. If we did, a time-range switch would briefly render mock
  // lines in `DEFAULT_COLORS` (orange) and then swap to the real series'
  // token colors (green) — that's the "orange flash before green" flicker.
  // Instead we render an empty series list during loading; the loader
  // overlay covers the empty chart. Mock is only used after the query has
  // settled with genuinely no history (ghost markets, API outages).
  const series = useMemo(() => {
    const hasRealData =
      priceHistories &&
      priceHistories.length > 0 &&
      priceHistories.some((ph) => ph.history.length > 0);

    let resolved: Array<{
      key: string;
      name: string;
      color: string;
      data: Array<{ time: UTCTimestamp; value: number }>;
    }>;

    if (hasRealData) {
      // Use live `allFetchTokens` colors/names first so selection-driven
      // recoloring (e.g. highlighting the selected candidate) takes effect
      // even when the React Query cache still holds the old values.
      resolved = priceHistories.map((ph, idx) => ({
        key: ph.tokenId,
        name: allFetchTokens[idx]?.name || ph.name,
        color:
          allFetchTokens[idx]?.color ||
          ph.color ||
          DEFAULT_COLORS[idx % DEFAULT_COLORS.length],
        data: toLineData(ph.history),
      }));
    } else if (!isLoading && !isFetching) {
      // Query settled, still no data → show mock so the UI isn't empty.
      // Use the parent-supplied token colors (if any) so ghost markets
      // still render in the correct brand rather than a random default.
      resolved = generateMockSeries(outcomes, outcomePrices, timeRange).map(
        (m, idx) => ({
          key: m.key,
          name: m.name,
          color:
            tokens[idx]?.color ||
            m.color ||
            DEFAULT_COLORS[idx % DEFAULT_COLORS.length],
          data: toLineData(m.history),
        })
      );
    } else {
      // Loading / refetching → render no series. Loader overlay handles the
      // visual feedback; the chart canvas stays blank until data lands.
      resolved = [];
    }

    // `resolved` is keyed 1:1 with `allFetchTokens`: first N entries are the
    // primary (YES) series, next M entries are the secondary (NO) series.
    // Without "Both", slice off the secondary block.
    if (!showBothOutcomes && secondaryTokens.length > 0) {
      return resolved.slice(0, tokens.length);
    }
    return resolved;
  }, [
    priceHistories,
    isLoading,
    isFetching,
    allFetchTokens,
    tokens,
    secondaryTokens,
    outcomes,
    outcomePrices,
    timeRange,
    showBothOutcomes,
  ]);

  // Keep the latest `series` reachable from stable callbacks (visible-range,
  // resize). Direct closure capture would require re-subscribing to those
  // events every render.
  const seriesForLabelsRef = useRef(series);
  seriesForLabelsRef.current = series;

  // Hover-only label refresh. Reads the latest crosshair state from refs,
  // emits flag labels positioned at the cursor X + each series' Y at that
  // hovered time, or clears the state when the cursor is off the plot.
  // Stable (empty deps) so crosshair/resize/visible-range subscriptions
  // don't need to rewire on each render.
  const updateHoverLabels = useCallback(() => {
    const x = crosshairXRef.current;
    const hoverMap = hoverValuesRef.current;
    if (x === null || !hoverMap || !chartRef.current) {
      setHoverLabels((prev) => (prev === null ? prev : null));
      return;
    }

    const currentSeries = seriesForLabelsRef.current;
    const items: Array<{
      key: string;
      name: string;
      color: string;
      pct: string;
      y: number;
    }> = [];

    for (const s of currentSeries) {
      const lineApi = seriesRef.current.get(s.key);
      if (!lineApi || s.data.length === 0) continue;
      const price = hoverMap.get(s.key);
      if (price === undefined) continue;

      const y = lineApi.priceToCoordinate(price);
      if (y === null || !Number.isFinite(y)) continue;

      items.push({
        key: s.key,
        name: s.name,
        color: s.color,
        pct: `${price.toFixed(1)}%`,
        y,
      });
    }

    // Collision-dodge + viewport clamping. Pills are sorted by Y, then
    // pushed downward so they don't stack. A second pass pulls them back
    // up if the lowest one would fall below the plot area — otherwise the
    // bottom cluster (3 markets at 2-3%) would sit on top of the time-
    // axis labels.
    const MIN_GAP = 22;
    const HALF = 11; // roughly the pill's half-height for center offset
    items.sort((a, b) => a.y - b.y);
    for (let i = 1; i < items.length; i++) {
      if (items[i].y - items[i - 1].y < MIN_GAP) {
        items[i].y = items[i - 1].y + MIN_GAP;
      }
    }

    // Ask lightweight-charts for the actual plot area dimensions. The
    // container's clientHeight/clientWidth include the time-axis strip
    // at the bottom and the price-scale gutter on the right, so using
    // them directly was letting pills overflow into those regions.
    const container = containerRef.current;
    const containerW = container?.clientWidth ?? 800;
    const containerH = container?.clientHeight ?? 400;
    const chart = chartRef.current;
    const timeAxisH = chart ? chart.timeScale().height() : 28;
    const priceAxisW = chart ? chart.priceScale("right").width() : 56;
    const plotBottom = containerH - timeAxisH;
    const plotRight = containerW - priceAxisW;

    const bottomBound = plotBottom - HALF - 4;
    const topBound = HALF + 4;
    if (items.length > 0) {
      const overflow = items[items.length - 1].y - bottomBound;
      if (overflow > 0) {
        for (const it of items) it.y = Math.max(topBound, it.y - overflow);
        // Re-resolve collisions after the shift.
        for (let i = 1; i < items.length; i++) {
          if (items[i].y - items[i - 1].y < MIN_GAP) {
            items[i].y = items[i - 1].y + MIN_GAP;
          }
        }
      }
    }

    // Horizontal flip: if there isn't room for ~200px of label between
    // the cursor and the start of the price-scale gutter, anchor pills
    // to the LEFT of the cursor so they grow inward.
    const LABEL_RESERVE = 200;
    const flipped = x + LABEL_RESERVE > plotRight;

    setHoverLabels({ x, flipped, items });
  }, []);

  // Persistent top-left legend — at-rest identity (name + live %) for
  // every series. Mirrors Polymarket's resting state. Hover values live in
  // the flag labels, not here, so this renders the live prices only.
  const legendItems = useMemo(
    () =>
      series.map((s, idx) => {
        const rawLive = outcomePrices[idx];
        const liveNum =
          rawLive !== undefined ? Number.parseFloat(rawLive) : Number.NaN;
        const pct = Number.isFinite(liveNum)
          ? liveNum * 100
          : s.data.length > 0
            ? s.data[s.data.length - 1].value
            : null;
        return {
          key: s.key,
          name: s.name,
          color: s.color,
          pct: pct !== null ? `${Math.round(pct)}%` : "—",
        };
      }),
    [series, outcomePrices]
  );

  // Initialize / teardown the chart once. All per-render updates go through
  // setData / applyOptions below, not recreation, so switching time ranges
  // doesn't rebuild the canvas.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const colors = readThemeColors();
    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      autoSize: false,
      layout: {
        background: { color: "transparent" },
        textColor: colors.text,
        attributionLogo: false,
      },
      grid: {
        // Polymarket-style: horizontal gridlines only, no vertical rules.
        vertLines: { visible: false },
        horzLines: { color: colors.grid },
      },
      rightPriceScale: {
        borderVisible: false,
        // Reserve ~10% headroom at the top so the floating legend pill
        // (top-left of the plot) never overlaps the current-price dashed
        // line. With top:0.02 a high current price like 73% mapped to the
        // very top of the canvas and the horizontal price-line cut
        // through the legend text.
        // Extra top headroom so the highest axis label (e.g. 70%) has
        // room to render without clipping against the top edge of the
        // plot. Bottom stays tight — 0% sits at the baseline anyway.
        scaleMargins: { top: 0.16, bottom: 0.04 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        // Default formatter strips the month for day-of-month ticks, which
        // produces a confusing bare "6" for an isolated first data point.
        // Keep the month on day ticks, the year on year ticks, and the
        // library's own output for month / time ticks.
        tickMarkFormatter: (time: Time, tickMarkType: TickMarkType) => {
          const t = (time as number) * 1000;
          const d = new Date(t);
          switch (tickMarkType) {
            case TickMarkType.Year:
              return d.toLocaleDateString("en-US", { year: "numeric" });
            case TickMarkType.Month:
              return d.toLocaleDateString("en-US", { month: "short" });
            case TickMarkType.DayOfMonth:
              return d.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              });
            case TickMarkType.Time:
            case TickMarkType.TimeWithSeconds:
              return d.toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              });
            default:
              return d.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              });
          }
        },
      },
      crosshair: {
        mode: 1 satisfies CrosshairMode,
        vertLine: {
          color: colors.crosshair,
          width: 1,
          style: 2 satisfies LineStyle, // dashed
          labelBackgroundColor: colors.text,
        },
        horzLine: {
          color: colors.crosshair,
          width: 1,
          style: 2 satisfies LineStyle,
          labelBackgroundColor: colors.text,
        },
      },
      localization: {
        priceFormatter: (p: number) => `${p.toFixed(0)}%`,
      },
      handleScale: false,
      handleScroll: false,
    });

    chartRef.current = chart;

    // ResizeObserver keeps the chart snapped to the container's actual size.
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      chart.applyOptions({ width, height });
      // Price-to-coordinate mapping shifts with canvas height; re-emit
      // labels if the user is mid-hover.
      updateHoverLabels();
    });
    ro.observe(container);

    // Visible-range changes (pan/zoom, time-range switch) also move the
    // price auto-fit, so re-emit labels if hovering.
    chart.timeScale().subscribeVisibleLogicalRangeChange(updateHoverLabels);

    // React to Tailwind dark-class flips so colors stay correct across themes.
    const themeObserver = new MutationObserver(() => {
      const next = readThemeColors();
      chart.applyOptions({
        layout: { textColor: next.text },
        grid: {
          vertLines: { color: next.grid },
          horzLines: { color: next.grid },
        },
        crosshair: {
          vertLine: {
            color: next.crosshair,
            labelBackgroundColor: next.text,
          },
          horzLine: {
            color: next.crosshair,
            labelBackgroundColor: next.text,
          },
        },
      });
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    // Crosshair handler: updates the end-of-line flag labels to show the
    // hovered-time values (so they track the cursor vertically, like
    // Polymarket) and renders a minimal date-only tooltip. The per-series
    // name + value was moved out of the tooltip into the flag labels
    // themselves, so the tooltip is now a single timestamp badge.
    const tooltip = tooltipRef.current;
    const crosshairHandler: Parameters<typeof chart.subscribeCrosshairMove>[0] =
      (param) => {
        const point = param.point;
        if (!point || point.x < 0 || point.y < 0 || !param.time) {
          if (tooltip) tooltip.style.display = "none";
          if (
            hoverValuesRef.current !== null ||
            crosshairXRef.current !== null
          ) {
            hoverValuesRef.current = null;
            crosshairXRef.current = null;
            updateHoverLabels();
          }
          return;
        }

        // Collect each series' value at the hovered time so every flag
        // label can snap to its own y. `param.seriesData` only contains
        // the crosshair-tracked series, so we look up the nearest data
        // point in each series' own array using the hovered timestamp.
        const hoverTime = param.time as number;
        const hoverMap = new Map<string, number>();
        for (const s of seriesForLabelsRef.current) {
          if (s.data.length === 0) continue;
          const data = s.data;
          // Binary search for the first point >= hoverTime; data is
          // time-sorted by construction.
          let lo = 0;
          let hi = data.length - 1;
          while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if ((data[mid].time as number) < hoverTime) lo = mid + 1;
            else hi = mid;
          }
          let idx = lo;
          // Pick the nearer of idx and idx-1.
          if (
            idx > 0 &&
            Math.abs((data[idx - 1].time as number) - hoverTime) <
              Math.abs((data[idx].time as number) - hoverTime)
          ) {
            idx = idx - 1;
          }
          const pt = data[idx];
          if (pt) hoverMap.set(s.key, pt.value);
        }
        hoverValuesRef.current = hoverMap.size > 0 ? hoverMap : null;
        crosshairXRef.current = hoverMap.size > 0 ? point.x : null;
        updateHoverLabels();

        if (!tooltip) return;

        const timeSeconds = param.time as UTCTimestamp;
        const d = new Date((timeSeconds as number) * 1000);
        const dateLabel = d.toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });

        tooltip.innerHTML = `<div style="font-size:11px;color:${colors.text};font-weight:500;white-space:nowrap;">${dateLabel}</div>`;

        // Position the badge near the cursor, clamped to container.
        const containerRect = container.getBoundingClientRect();
        const tipWidth = tooltip.offsetWidth || 120;
        const tipHeight = tooltip.offsetHeight || 24;
        let left = point.x + 12;
        let top = point.y - tipHeight - 8;
        if (left + tipWidth > containerRect.width) {
          left = point.x - tipWidth - 12;
        }
        if (top < 0) top = point.y + 12;
        tooltip.style.display = "block";
        tooltip.style.left = `${Math.max(0, left)}px`;
        tooltip.style.top = `${Math.max(0, top)}px`;
      };
    chart.subscribeCrosshairMove(crosshairHandler);

    return () => {
      chart.unsubscribeCrosshairMove(crosshairHandler);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(updateHoverLabels);
      themeObserver.disconnect();
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current.clear();
      seriesConfigRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateHoverLabels]);

  // Keep a ref to the current series config so the crosshair handler can
  // read the latest names / colors without retriggering the chart-init effect.
  const seriesConfigRef = useRef<Map<string, { name: string; color: string }>>(
    new Map()
  );

  // Sync series data / config on every data change.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const currentKeys = new Set(series.map((s) => s.key));

    // Remove stale series (e.g. token list changed).
    for (const [key, s] of seriesRef.current.entries()) {
      if (!currentKeys.has(key)) {
        chart.removeSeries(s);
        seriesRef.current.delete(key);
        seriesConfigRef.current.delete(key);
      }
    }

    // Upsert each current series. When `activeTokenId` is provided, that
    // series gets a thicker line and is the ONLY one with a right-axis
    // current-price marker. All other series still render in their own
    // colors but drop the axis labels to keep the right gutter clean.
    for (const s of series) {
      let line = seriesRef.current.get(s.key);
      const isFirst = s.key === series[0]?.key;
      const isActive = activeTokenId ? s.key === activeTokenId : isFirst; // fallback: no explicit active → first series wins
      if (!line) {
        line = chart.addSeries(LineSeries, {
          color: s.color,
          lineWidth: isActive ? 3 : 2,
          // Monotonic curved interpolation between points — mirrors the
          // polished Recharts/Polymarket look. Straight-segment default
          // (LineType.Simple) reads as "hand-drawn" when points are sparse.
          lineType: 2 satisfies LineType, // Curved
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerRadius: 4,
        });
        seriesRef.current.set(s.key, line);

        // "Tipping point" reference line at 50% — anchored to the first
        // series so there's exactly one across the whole chart.
        if (isFirst) {
          line.createPriceLine({
            price: 50,
            color: "rgba(148, 163, 184, 0.5)",
            lineWidth: 1,
            lineStyle: 1 satisfies LineStyle, // dotted
            axisLabelVisible: false,
            title: "",
          });
        }
      } else {
        // Re-apply lineType too: when this effect re-runs on an existing
        // series, `applyOptions` is the only path to update curve style.
        // Skipping it here meant series created before the Curved default
        // stayed as straight segments across HMR / time-range switches.
        line.applyOptions({
          color: s.color,
          lineWidth: isActive ? 3 : 2,
          lineType: 2 satisfies LineType, // Curved
        });
      }
      line.setData(s.data);
      seriesConfigRef.current.set(s.key, { name: s.name, color: s.color });

      // Current-price marker — only for the active series. Drawing a
      // dashed line + label per candidate in a 10-way chart made the
      // right axis unreadable with overlapping labels.
      const idx = series.findIndex((x) => x.key === s.key);
      const currentRaw = outcomePrices[idx];
      const currentNum =
        currentRaw !== undefined ? Number.parseFloat(currentRaw) : Number.NaN;
      const currentPct = Number.isFinite(currentNum)
        ? currentNum * 100
        : s.data.length > 0
          ? s.data[s.data.length - 1].value
          : null;

      const previousPriceLine = currentPriceLineRef.current.get(s.key);
      if (previousPriceLine) {
        line.removePriceLine(previousPriceLine);
        currentPriceLineRef.current.delete(s.key);
      }
      if (isActive && currentPct !== null) {
        const newPriceLine = line.createPriceLine({
          price: currentPct,
          color: s.color,
          lineWidth: 1,
          lineStyle: 2 satisfies LineStyle, // dashed
          // Right-axis name label suppressed — the top-left legend already
          // carries the active series' name + %, so duplicating it on the
          // axis would clip against the top grid line.
          axisLabelVisible: false,
          title: "",
        });
        currentPriceLineRef.current.set(s.key, newPriceLine);
      }
    }

    // Clean up priceLines for removed series.
    for (const [key] of currentPriceLineRef.current) {
      if (!currentKeys.has(key)) {
        currentPriceLineRef.current.delete(key);
      }
    }

    // Fit the visible range to the data whenever a new time range loads.
    if (series.some((s) => s.data.length > 0)) {
      chart.timeScale().fitContent();
    }

    // If the user is mid-hover when data/series changes, re-emit labels
    // so their Y positions track the new auto-fit. rAF so
    // `priceToCoordinate` reads the committed layout.
    const rafId = requestAnimationFrame(() => updateHoverLabels());
    return () => cancelAnimationFrame(rafId);
  }, [series, outcomePrices, activeTokenId, updateHoverLabels]);

  // Report per-outcome price-change deltas to the parent. Unchanged from the
  // recharts implementation.
  const outcomeRangeChanges = useMemo(() => {
    if (!priceHistories || priceHistories.length === 0) {
      return [];
    }

    const hasAnyData = priceHistories.some((ph) => ph.history.length > 0);
    if (!hasAnyData) {
      return [];
    }

    return priceHistories.map((ph, idx) => {
      if (ph.history.length === 0) {
        return 0;
      }

      const sortedHistory = [...ph.history].sort((a, b) => a.t - b.t);
      const startPrice = sortedHistory[0]?.p;
      const currentPrice = Number.parseFloat(outcomePrices[idx] ?? "");
      const endPrice = Number.isFinite(currentPrice)
        ? currentPrice
        : sortedHistory[sortedHistory.length - 1]?.p;

      if (!Number.isFinite(startPrice) || !Number.isFinite(endPrice)) {
        return 0;
      }

      return Math.trunc((endPrice - startPrice) * 100);
    });
  }, [outcomePrices, priceHistories]);

  useEffect(() => {
    onOutcomeRangeChanges?.(outcomeRangeChanges);
  }, [onOutcomeRangeChanges, outcomeRangeChanges]);

  const timeRanges: TimeRange[] = ["1H", "6H", "1D", "1W", "1M", "ALL"];

  return (
    <div className="space-y-2">
      {/* Persistent top-left legend — rendered ABOVE the plot as a sibling
          (not an overlay) so it can't collide with grid lines or axis
          labels at the top of the chart. Mirrors Polymarket's resting-
          state identity row. */}
      {legendItems.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs font-medium">
          {legendItems.map((item) => (
            <div key={item.key} className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-foreground">{item.name}</span>
              <span className="text-muted-foreground tabular-nums">
                {item.pct}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="w-full min-h-[200px] h-[220px] sm:h-[300px] md:h-[360px] lg:h-[400px] max-h-[60vh] relative">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            Failed to load price history
          </div>
        ) : null}
        <div
          ref={containerRef}
          role="img"
          aria-label="Price history chart"
          className={cn(
            "absolute inset-0 transition-opacity duration-500 ease-out",
            isLoading ? "opacity-0" : "opacity-100"
          )}
        />
        {/* Hover-only flag labels, Polymarket-style. Positioned at the
            crosshair X (so they follow the cursor horizontally) and each
            series' value-Y for the hovered time (so they track vertically
            as the cursor moves). Collision-dodged by `updateHoverLabels`. */}
        {hoverLabels && hoverLabels.items.length > 0 && (
          <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
            {hoverLabels.items.map((item) => (
              <div
                key={item.key}
                className="absolute flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm tabular-nums"
                style={{
                  left: `${
                    hoverLabels.flipped
                      ? hoverLabels.x - 10
                      : hoverLabels.x + 10
                  }px`,
                  top: `${item.y}px`,
                  transform: hoverLabels.flipped
                    ? "translate(-100%, -50%)"
                    : "translateY(-50%)",
                  backgroundColor: item.color,
                  textShadow: "0 1px 2px rgba(0,0,0,0.35)",
                }}
              >
                <span className="truncate max-w-[180px]">{item.name}</span>
                <span className="opacity-90">{item.pct}</span>
              </div>
            ))}
          </div>
        )}
        <div
          ref={tooltipRef}
          role="tooltip"
          className="pointer-events-none absolute z-10 hidden rounded-lg border border-border bg-background/95 p-3 shadow-xl backdrop-blur-sm"
          style={{ display: "none" }}
        />
      </div>

      {/* Time Range Selectors + Both-outcomes toggle */}
      <div className="flex items-center justify-center gap-2">
        {timeRanges.map((range) => (
          <Button
            key={range}
            type="button"
            variant={timeRange === range ? "default" : "ghost"}
            size="sm"
            onClick={() => setTimeRange(range)}
            className="h-8 px-3"
          >
            {range}
          </Button>
        ))}
        {/* Only offer the toggle when:
            - the caller hasn't suppressed it (per-candidate charts do),
            - and there's more than one outcome to toggle to. */}
        {!hideBothToggle &&
          (priceHistories?.length ?? tokens.length ?? outcomes.length) > 1 && (
            <Button
              type="button"
              variant={showBothOutcomes ? "default" : "ghost"}
              size="sm"
              onClick={() => setShowBothOutcomes((v) => !v)}
              className="h-8 px-3 ml-2"
              aria-pressed={showBothOutcomes}
              title="Show both outcomes"
            >
              Both
            </Button>
          )}
      </div>
    </div>
  );
}

/**
 * Mock per-outcome series used when no real price history is available
 * (ghost markets, network errors, or markets that haven't traded yet).
 * Shape matches what the real API path produces, so downstream logic is
 * identical.
 */
interface MockSeries {
  key: string;
  name: string;
  color: string;
  history: PriceHistoryPoint[];
}

function generateMockSeries(
  outcomes: string[],
  outcomePrices: string[],
  timeRange: TimeRange
): MockSeries[] {
  const parsedPrices =
    outcomePrices.length > 0
      ? outcomePrices.map((p) => Number.parseFloat(p))
      : [0.5, 0.5];
  const names = outcomes.length > 0 ? outcomes : ["Yes", "No"];

  let dataPoints: number;
  let intervalMs: number;
  switch (timeRange) {
    case "1H":
      dataPoints = 12;
      intervalMs = 5 * 60 * 1000;
      break;
    case "6H":
      dataPoints = 24;
      intervalMs = 15 * 60 * 1000;
      break;
    case "1D":
      dataPoints = 24;
      intervalMs = 60 * 60 * 1000;
      break;
    case "1W":
      dataPoints = 28;
      intervalMs = 6 * 60 * 60 * 1000;
      break;
    case "1M":
      dataPoints = 30;
      intervalMs = 24 * 60 * 60 * 1000;
      break;
    case "ALL":
      dataPoints = 90;
      intervalMs = 24 * 60 * 60 * 1000;
      break;
  }

  const now = Date.now();
  return parsedPrices.map((basePrice, idx) => {
    const history: PriceHistoryPoint[] = [];
    for (let i = 0; i <= dataPoints; i++) {
      const timestampMs = now - (dataPoints - i) * intervalMs;
      const variance = (Math.random() - 0.5) * 0.05;
      const trend = basePrice * 0.1 * (i / dataPoints) - basePrice * 0.05;
      const price = Math.max(
        0.01,
        Math.min(0.99, basePrice + trend + variance)
      );
      history.push({
        t: Math.floor(timestampMs / 1000),
        p: price,
      });
    }
    return {
      key: `mock-${idx}`,
      name: names[idx] ?? `Outcome ${idx + 1}`,
      color: DEFAULT_COLORS[idx % DEFAULT_COLORS.length],
      history,
    };
  });
}

// Silence unused-import warning — this type is re-exported for call-sites
// that want to hold a Time value directly.
export type { Time };
