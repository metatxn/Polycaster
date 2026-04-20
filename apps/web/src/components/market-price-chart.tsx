"use client";

import { useQuery } from "@tanstack/react-query";
import {
  type CrosshairMode,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  LineSeries,
  type LineStyle,
  TickMarkType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Price history data point from Polymarket API
 * @see https://docs.polymarket.com/api-reference/pricing/get-price-history-for-a-traded-token
 */
interface PriceHistoryPoint {
  t: number; // UTC timestamp (seconds)
  p: number; // Price (0-1)
}

interface PriceHistoryResponse {
  success: boolean;
  history?: PriceHistoryPoint[];
  error?: string;
}

interface TokenInfo {
  tokenId: string;
  name: string;
  color: string;
}

interface MarketPriceChartProps {
  /** Array of token IDs with their names for fetching price history */
  tokens?: TokenInfo[];
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

// Map time range to fidelity (resolution in minutes)
const timeRangeToFidelity: Record<TimeRange, number> = {
  "1H": 1,
  "6H": 5,
  "1D": 15,
  "1W": 60,
  "1M": 360,
  ALL: 720,
};

const DEFAULT_COLORS = [
  "hsl(25, 95%, 53%)", // Orange
  "hsl(221, 83%, 53%)", // Blue
  "hsl(280, 100%, 70%)", // Purple/Pink
  "hsl(142, 76%, 36%)", // Green
];

/**
 * Fetch price history for a token using startTs and fidelity
 * @see https://docs.polymarket.com/api-reference/pricing/get-price-history-for-a-traded-token
 */
async function fetchPriceHistory(
  tokenId: string,
  startTs: number,
  fidelity: number
): Promise<PriceHistoryPoint[]> {
  if (!tokenId || tokenId.length < 10) {
    return [];
  }

  try {
    const params = new URLSearchParams({
      startTs: startTs.toString(),
      fidelity: fidelity.toString(),
    });

    const response = await fetch(
      `/api/markets/price-history/${tokenId}?${params.toString()}`
    );

    if (!response.ok) {
      console.warn(`Failed to fetch price history for ${tokenId}`);
      return [];
    }

    const data: PriceHistoryResponse = await response.json();

    if (!data.success || !data.history) {
      return [];
    }

    return data.history;
  } catch (error) {
    console.error("Error fetching price history:", error);
    return [];
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
  tokens = [],
  outcomes = [],
  outcomePrices = [],
  defaultTimeRange = "ALL",
  onOutcomeRangeChanges,
}: MarketPriceChartProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>(defaultTimeRange);
  // Polymarket shows a single outcome by default; both-outcomes is opt-in.
  // A single line reads as calm/focused; two lines read as busy.
  const [showBothOutcomes, setShowBothOutcomes] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<Map<string, ISeriesApi<"Line">>>(new Map());
  // Manually-managed price lines that reflect the *live* on-chain price
  // (from `outcomePrices`) rather than the last history-endpoint trade,
  // which can be days stale or a dust-trade outlier.
  const currentPriceLineRef = useRef<Map<string, IPriceLine>>(new Map());

  // Calculate startTs based on time range (seconds since epoch)
  const startTs =
    Math.floor(Date.now() / 1000) - timeRangeToStartTsOffset[timeRange];
  const fidelity = timeRangeToFidelity[timeRange];

  // Check if we have valid token IDs
  const hasValidTokens =
    tokens.length > 0 && tokens.some((t) => t.tokenId?.length > 10);

  // Fetch price history for all tokens
  const {
    data: priceHistories,
    isLoading,
    isFetching,
    error,
  } = useQuery({
    queryKey: [
      "priceHistory",
      tokens.map((t) => t.tokenId),
      timeRange,
      fidelity,
    ],
    queryFn: async () => {
      const histories = await Promise.all(
        tokens.map(async (token) => ({
          tokenId: token.tokenId,
          name: token.name,
          color: token.color,
          history: await fetchPriceHistory(token.tokenId, startTs, fidelity),
        }))
      );
      return histories;
    },
    enabled: hasValidTokens,
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  // Resolved series config (real history when available, mock otherwise).
  // When `showBothOutcomes` is false we keep only the first outcome — matching
  // Polymarket's default single-line view.
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
      resolved = priceHistories.map((ph, idx) => ({
        key: ph.tokenId,
        name: ph.name,
        color:
          ph.color ||
          tokens[idx]?.color ||
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

    return showBothOutcomes ? resolved : resolved.slice(0, 1);
  }, [
    priceHistories,
    isLoading,
    isFetching,
    tokens,
    outcomes,
    outcomePrices,
    timeRange,
    showBothOutcomes,
  ]);

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
        scaleMargins: { top: 0.1, bottom: 0.02 },
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
    });
    ro.observe(container);

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

    // Tooltip driven by crosshair moves — DOM overlay, not part of the canvas.
    const tooltip = tooltipRef.current;
    const crosshairHandler: Parameters<typeof chart.subscribeCrosshairMove>[0] =
      (param) => {
        if (!tooltip) return;
        if (
          !param.point ||
          param.point.x < 0 ||
          param.point.y < 0 ||
          !param.time
        ) {
          tooltip.style.display = "none";
          return;
        }

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

        type Row = { label: string; value: number; color: string };
        const rows: Row[] = [];
        for (const [key, s] of seriesRef.current.entries()) {
          const pointData = param.seriesData.get(s) as
            | { value?: number }
            | undefined;
          if (!pointData || typeof pointData.value !== "number") continue;
          const conf = seriesConfigRef.current.get(key);
          if (!conf) continue;
          rows.push({
            label: conf.name,
            value: pointData.value,
            color: conf.color,
          });
        }
        rows.sort((a, b) => b.value - a.value);

        if (rows.length === 0) {
          tooltip.style.display = "none";
          return;
        }

        tooltip.innerHTML = `
        <div style="font-size:11px;color:${colors.text};margin-bottom:6px;font-weight:500;">${dateLabel}</div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          ${rows
            .map(
              (r) => `
                <div style="display:flex;align-items:center;gap:8px;">
                  <span style="padding:1px 6px;border-radius:4px;font-size:11px;font-weight:600;color:white;background:${r.color};">${r.label}</span>
                  <span style="font-size:13px;font-weight:700;">${r.value.toFixed(1)}%</span>
                </div>`
            )
            .join("")}
        </div>
      `;

        // Position tooltip near the cursor, clamped to container bounds.
        const containerRect = container.getBoundingClientRect();
        const tipWidth = tooltip.offsetWidth || 160;
        const tipHeight = tooltip.offsetHeight || 60;
        let left = param.point.x + 16;
        let top = param.point.y + 16;
        if (left + tipWidth > containerRect.width) {
          left = param.point.x - tipWidth - 16;
        }
        if (top + tipHeight > containerRect.height) {
          top = param.point.y - tipHeight - 16;
        }
        tooltip.style.display = "block";
        tooltip.style.left = `${Math.max(0, left)}px`;
        tooltip.style.top = `${Math.max(0, top)}px`;
      };
    chart.subscribeCrosshairMove(crosshairHandler);

    return () => {
      chart.unsubscribeCrosshairMove(crosshairHandler);
      themeObserver.disconnect();
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current.clear();
      seriesConfigRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    // Upsert each current series.
    for (const s of series) {
      let line = seriesRef.current.get(s.key);
      const isFirst = s.key === series[0]?.key;
      if (!line) {
        line = chart.addSeries(LineSeries, {
          color: s.color,
          lineWidth: 2,
          // We manage the current-price marker ourselves (see below) using
          // the parent-supplied live on-chain price — disable the built-in
          // dashed line + right-axis badge that otherwise latches onto the
          // last data point, which can be days stale or an outlier trade.
          priceLineVisible: false,
          lastValueVisible: false,
          // No title on the series itself — the managed price line below
          // already renders "Yes 73%" on the right axis. Setting `title`
          // here would duplicate the outcome name next to it.
          crosshairMarkerRadius: 4,
        });
        seriesRef.current.set(s.key, line);

        // "Tipping point" reference line at 50% — anchored to the first
        // series so there's exactly one across the whole chart regardless
        // of single/both-outcomes mode. Used as a visual anchor for "which
        // side of the coin flip is the market currently leaning to".
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
        line.applyOptions({ color: s.color });
      }
      line.setData(s.data);
      seriesConfigRef.current.set(s.key, { name: s.name, color: s.color });

      // Current-price marker — prefer the parent's `outcomePrices` (live
      // on-chain) over the last historical data point. Always in sync
      // across outcomes (Yes + No always sum to 100), unlike last-trade
      // values which can come from different moments per token.
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
      if (currentPct !== null) {
        const newPriceLine = line.createPriceLine({
          price: currentPct,
          color: s.color,
          lineWidth: 1,
          lineStyle: 2 satisfies LineStyle, // dashed
          axisLabelVisible: true,
          title: s.name,
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
  }, [series, outcomePrices]);

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

  // Legend rendered as an overlay inside the chart area (Polymarket-style).
  // Previously the parent page rendered its own legend in a CardHeader,
  // adding ~48px of vertical chrome above the plot. Embedding it here lets
  // the parent drop that header and the chart sits flush at the top of
  // the card. We still show each series' name + current price.
  const legendItems = useMemo(
    () =>
      series.map((s, idx) => {
        // Mirror the current-price-marker logic: prefer the parent's live
        // `outcomePrices[idx]` (always in sync across outcomes) over the
        // last historical data point, which can be days stale or an
        // outlier trade. Fall back to the last data point only if no
        // live price is available.
        const currentRaw = outcomePrices[idx];
        const currentNum =
          currentRaw !== undefined ? Number.parseFloat(currentRaw) : Number.NaN;
        const pct = Number.isFinite(currentNum)
          ? currentNum * 100
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

  return (
    <div className="space-y-2">
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
          className="absolute inset-0"
        />
        {/* Floating legend overlay — top-left corner of the plot. Each
            item has its own pill with a translucent background + blur so
            the chart line underneath doesn't pass through the text. Pointer
            events disabled so hover still hits the canvas beneath. */}
        {legendItems.length > 0 && (
          <div className="pointer-events-none absolute left-3 top-2 z-10 flex flex-wrap items-center gap-2 text-xs font-medium">
            {legendItems.map((item) => (
              <div
                key={item.key}
                className="flex items-center gap-1.5 rounded-full border border-border/50 bg-background/80 px-2 py-0.5 shadow-sm backdrop-blur-sm"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-foreground">
                  {item.name} {item.pct}
                </span>
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
        {/* Only offer the toggle when there's more than one outcome to toggle to */}
        {(priceHistories?.length ?? tokens.length ?? outcomes.length) > 1 && (
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
