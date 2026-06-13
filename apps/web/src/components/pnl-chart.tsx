"use client";

import { m } from "framer-motion";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type PnLDataPoint,
  type PnLInterval,
  usePnLHistory,
} from "@/hooks/use-pnl-history";
import { formatCurrencyCompact, formatPercent } from "@/lib/formatters";
import { cn } from "@/lib/utils";

interface PnLChartProps {
  userAddress?: string;
  height?: number;
  showIntervalSelector?: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const INTERVAL_OPTIONS: { value: PnLInterval; label: string }[] = [
  { value: "6h", label: "6H" },
  { value: "12h", label: "12H" },
  { value: "1d", label: "1D" },
  { value: "1w", label: "1W" },
  { value: "1m", label: "1M" },
  { value: "all", label: "All" },
];

// ============================================================================
// Chart Component
// ============================================================================

export function InteractiveLineChart({
  data,
  height = 200,
}: {
  data: PnLDataPoint[];
  height: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const gradientId = useId();

  // Calculate chart bounds, points, and where zero sits vertically.
  const { points, zeroY, zeroRatio, peakIdx, troughIdx, hasZeroLine } =
    useMemo(() => {
      if (data.length === 0) {
        return {
          points: [] as { x: number; y: number; data: PnLDataPoint }[],
          zeroY: 0,
          zeroRatio: 0,
          peakIdx: -1,
          troughIdx: -1,
          hasZeroLine: false,
        };
      }

      const pnlValues = data.map((d) => d.pnl);
      const min = Math.min(...pnlValues);
      const max = Math.max(...pnlValues);
      const range = max - min || 1;

      // Reserve pixel space at top and bottom of the chart so the peak/trough
      // labels can always sit OUTSIDE the line without overlapping it. Without
      // this, when max sits at the top the chart line hugs y=0 and the label
      // has nowhere to go but on top of the line.
      const TOP_RESERVE = 22;
      const BOTTOM_RESERVE = 22;
      const plotHeight = Math.max(height - TOP_RESERVE - BOTTOM_RESERVE, 1);

      const pts = data.map((d, i) => {
        const x = data.length === 1 ? 50 : (i / (data.length - 1)) * 100;
        const y = TOP_RESERVE + (1 - (d.pnl - min) / range) * plotHeight;
        return { x, y, data: d };
      });

      // Zero anchor — only meaningful when the series crosses it.
      const hasZero = min < 0 && max > 0;
      const zY = hasZero
        ? TOP_RESERVE + (1 - (0 - min) / range) * plotHeight
        : 0;
      const zRatio = hasZero ? zY / height : 0;

      const peak = pnlValues.indexOf(max);
      const trough = pnlValues.indexOf(min);

      return {
        points: pts,
        zeroY: zY,
        zeroRatio: zRatio,
        peakIdx: peak,
        troughIdx: trough,
        hasZeroLine: hasZero,
      };
    }, [data, height]);

  // Straight polyline between points.
  const linePath = useMemo(() => {
    if (points.length === 0) return "";
    return points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
      .join(" ");
  }, [points]);

  // Area fill baseline — sits on the zero line when available, otherwise
  // on the chart floor, so positive area never bleeds below the line.
  const areaPath = useMemo(() => {
    if (points.length === 0) return "";
    const baseline = hasZeroLine ? zeroY : height;
    return `${linePath} L ${points[points.length - 1].x} ${baseline} L ${
      points[0].x
    } ${baseline} Z`;
  }, [linePath, points, height, hasZeroLine, zeroY]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!containerRef.current || data.length === 0) return;

      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const relativeX = x / rect.width;

      const index = Math.round(relativeX * (data.length - 1));
      setHoveredIndex(Math.max(0, Math.min(data.length - 1, index)));
    },
    [data.length]
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredIndex(null);
  }, []);

  if (points.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-muted-foreground text-sm"
        style={{ height }}
      >
        No data available
      </div>
    );
  }

  const EMERALD = "#10b981";
  const RED = "#ef4444";
  const hoveredPoint = hoveredIndex !== null ? points[hoveredIndex] : null;
  const hoveredIsPositive = hoveredPoint ? hoveredPoint.data.pnl >= 0 : false;

  // Peak/trough only worth annotating when there's meaningful separation.
  const showMarkers =
    data.length >= 4 && peakIdx !== troughIdx && peakIdx >= 0 && troughIdx >= 0;
  const peakPt = showMarkers ? points[peakIdx] : null;
  const troughPt = showMarkers ? points[troughIdx] : null;

  return (
    <div
      ref={containerRef}
      className="relative cursor-crosshair select-none"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ height }}
      role="img"
      aria-label="P&L chart visualization"
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="overflow-visible"
        aria-hidden="true"
      >
        <defs>
          {/* Stroke gradient — sharp switch at zero. Positive half is
              emerald, negative half is red. Hard stops instead of a
              smooth ramp so the line reads like a ticker. */}
          <linearGradient
            id={`stroke-${gradientId}`}
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            {hasZeroLine ? (
              <>
                <stop offset="0%" stopColor={EMERALD} />
                <stop offset={`${zeroRatio * 100}%`} stopColor={EMERALD} />
                <stop offset={`${zeroRatio * 100}%`} stopColor={RED} />
                <stop offset="100%" stopColor={RED} />
              </>
            ) : (
              <>
                <stop
                  offset="0%"
                  stopColor={
                    points[points.length - 1].data.pnl >= 0 ? EMERALD : RED
                  }
                />
                <stop
                  offset="100%"
                  stopColor={
                    points[points.length - 1].data.pnl >= 0 ? EMERALD : RED
                  }
                />
              </>
            )}
          </linearGradient>
          {/* Area fill gradient — matches the stroke colors but faint. */}
          <linearGradient id={`fill-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
            {hasZeroLine ? (
              <>
                <stop offset="0%" stopColor={EMERALD} stopOpacity="0.18" />
                <stop
                  offset={`${zeroRatio * 100}%`}
                  stopColor={EMERALD}
                  stopOpacity="0.02"
                />
                <stop
                  offset={`${zeroRatio * 100}%`}
                  stopColor={RED}
                  stopOpacity="0.02"
                />
                <stop offset="100%" stopColor={RED} stopOpacity="0.18" />
              </>
            ) : (
              <>
                <stop
                  offset="0%"
                  stopColor={
                    points[points.length - 1].data.pnl >= 0 ? EMERALD : RED
                  }
                  stopOpacity="0.22"
                />
                <stop
                  offset="100%"
                  stopColor={
                    points[points.length - 1].data.pnl >= 0 ? EMERALD : RED
                  }
                  stopOpacity="0.02"
                />
              </>
            )}
          </linearGradient>
        </defs>

        {/* Grid rules — faint */}
        {[0.25, 0.5, 0.75].map((tick) => (
          <line
            key={tick}
            x1="0"
            y1={height * tick}
            x2="100"
            y2={height * tick}
            stroke="currentColor"
            strokeOpacity="0.05"
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* Zero reference line — only when the series crosses zero */}
        {hasZeroLine && (
          <line
            x1="0"
            y1={zeroY}
            x2="100"
            y2={zeroY}
            stroke="currentColor"
            strokeOpacity="0.35"
            strokeDasharray="2,3"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {/* Area fill */}
        <path d={areaPath} fill={`url(#fill-${gradientId})`} />

        {/* Main line */}
        <path
          d={linePath}
          fill="none"
          stroke={`url(#stroke-${gradientId})`}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* Hover vertical guide */}
        {hoveredPoint && (
          <line
            x1={hoveredPoint.x}
            y1="0"
            x2={hoveredPoint.x}
            y2={height}
            stroke="currentColor"
            strokeOpacity="0.3"
            strokeDasharray="2,3"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      {/* Zero-line label — broadsheet style */}
      {hasZeroLine && (
        <span
          className="pointer-events-none absolute font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/70 bg-background px-1"
          style={{
            left: 0,
            top: zeroY,
            transform: "translateY(-50%)",
          }}
        >
          $0
        </span>
      )}

      {/* Peak marker — sits ABOVE the line in the reserved top space.
          Horizontal anchor flips from center → left/right near the side
          edges so the label never bleeds past the panel. */}
      {peakPt &&
        (() => {
          const xAlign =
            peakPt.x < 15 ? "left" : peakPt.x > 85 ? "right" : "center";
          const tx =
            xAlign === "left" ? "0%" : xAlign === "right" ? "-100%" : "-50%";
          return (
            <div
              className="pointer-events-none absolute"
              style={{
                left: `${peakPt.x}%`,
                top: peakPt.y,
                transform: `translate(${tx}, calc(-100% - 6px))`,
              }}
            >
              <span className="block font-mono text-[9px] uppercase tracking-[0.12em] text-emerald-600 dark:text-emerald-500 tabular-nums whitespace-nowrap">
                ▲ {formatCurrencyCompact(peakPt.data.pnl)}
              </span>
            </div>
          );
        })()}

      {/* Trough marker — sits BELOW the line in the reserved bottom space. */}
      {troughPt &&
        (() => {
          const xAlign =
            troughPt.x < 15 ? "left" : troughPt.x > 85 ? "right" : "center";
          const tx =
            xAlign === "left" ? "0%" : xAlign === "right" ? "-100%" : "-50%";
          return (
            <div
              className="pointer-events-none absolute"
              style={{
                left: `${troughPt.x}%`,
                top: troughPt.y,
                transform: `translate(${tx}, 6px)`,
              }}
            >
              <span className="block font-mono text-[9px] uppercase tracking-[0.12em] text-red-600 dark:text-red-500 tabular-nums whitespace-nowrap">
                ▼ {formatCurrencyCompact(troughPt.data.pnl)}
              </span>
            </div>
          );
        })()}

      {/* Hover dot */}
      {hoveredPoint && (
        <div
          className="absolute w-2.5 h-2.5 rounded-full border-2 border-background pointer-events-none"
          style={{
            left: `${hoveredPoint.x}%`,
            top: hoveredPoint.y,
            backgroundColor: hoveredIsPositive ? EMERALD : RED,
            transform: "translate(-50%, -50%)",
          }}
        />
      )}

      {/* Hairline editorial tooltip */}
      {hoveredPoint && hoveredIndex !== null && (
        <div
          className="absolute z-20 pointer-events-none"
          style={{
            left: `${Math.min(Math.max(hoveredPoint.x, 14), 86)}%`,
            top: 4,
            transform: "translateX(-50%)",
          }}
        >
          <m.div
            initial={{ opacity: 0, y: 2 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.12 }}
            className="border border-border/60 bg-background px-3 py-2 min-w-[120px]"
          >
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground mb-1">
              {formatDate(hoveredPoint.data.timestamp)}
            </p>
            <p
              className={cn(
                "font-mono tabular-nums text-sm font-semibold",
                hoveredIsPositive ? "text-emerald-500" : "text-red-500"
              )}
            >
              {formatCurrencyCompact(hoveredPoint.data.pnl)}
            </p>
            {hoveredIndex > 0 && (
              <p
                className={cn(
                  "font-mono tabular-nums text-[10px] mt-0.5",
                  hoveredPoint.data.pnl - data[hoveredIndex - 1].pnl >= 0
                    ? "text-emerald-500"
                    : "text-red-500"
                )}
              >
                {hoveredPoint.data.pnl - data[hoveredIndex - 1].pnl >= 0
                  ? "↑"
                  : "↓"}{" "}
                {formatCurrencyCompact(
                  Math.abs(hoveredPoint.data.pnl - data[hoveredIndex - 1].pnl)
                )}
              </p>
            )}
          </m.div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function PnLChart({
  userAddress,
  height = 220,
  showIntervalSelector = true,
}: PnLChartProps) {
  const [interval, setInterval] = useState<PnLInterval>("all");

  const { data, isLoading, error } = usePnLHistory({
    userAddress,
    interval,
    fidelity:
      interval === "6h" || interval === "12h" || interval === "1d"
        ? "1h"
        : "1d",
  });

  const isPositive = (data?.summary?.endPnl || 0) >= 0;
  const hasData = data?.data && data.data.length > 0;

  const [isSmallScreen, setIsSmallScreen] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 639px)");
    setIsSmallScreen(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsSmallScreen(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  const chartHeight = isSmallScreen ? Math.min(height, 160) : height;

  return (
    <section>
      {/* Header — editorial section label + interval strip */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-3">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          P&L History
        </h2>

        {showIntervalSelector && (
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide font-mono text-[10px] uppercase tracking-[0.14em]">
            {INTERVAL_OPTIONS.map((opt) => {
              const isActive = interval === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setInterval(opt.value)}
                  className={`relative px-2 py-1.5 whitespace-nowrap transition-colors shrink-0 ${
                    isActive
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                  {isActive && (
                    <span className="absolute inset-x-2 -bottom-px h-px bg-foreground" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Content — bounded by hairline rules, no card */}
      <div className="border-y border-border/50 py-4 sm:py-5">
        {isLoading ? (
          <div className="space-y-3 sm:space-y-4">
            <div className="flex items-baseline gap-3">
              <Skeleton className="h-8 sm:h-9 w-24 sm:w-28" />
              <Skeleton className="h-5 w-24" />
            </div>
            <Skeleton className="w-full" style={{ height: chartHeight }} />
          </div>
        ) : error ? (
          <div
            className="flex items-center text-muted-foreground font-editorial italic text-sm px-1"
            style={{ height: chartHeight }}
          >
            <p>Failed to load P&L data.</p>
          </div>
        ) : !hasData ? (
          <div className="py-2 px-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground mb-2">
              No data yet
            </p>
            <p className="font-editorial italic text-lg text-muted-foreground leading-snug">
              Your P&L curve shows up here once you've traded.
            </p>
          </div>
        ) : (
          <div>
            {/* Summary */}
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3 sm:mb-5">
              <span
                className={`text-2xl sm:text-3xl font-semibold tabular-nums tracking-[-0.015em] ${
                  isPositive ? "text-emerald-500" : "text-red-500"
                }`}
              >
                {formatCurrencyCompact(data.summary.endPnl)}
              </span>
              <span
                className={`font-mono text-[11px] uppercase tracking-[0.12em] tabular-nums flex items-center gap-1 ${
                  data.summary.change >= 0 ? "text-emerald-500" : "text-red-500"
                }`}
              >
                {data.summary.change >= 0 ? "↑" : "↓"}
                {formatCurrencyCompact(Math.abs(data.summary.change))}
                <span className="text-muted-foreground/70">
                  ({formatPercent(data.summary.changePercent)})
                </span>
              </span>
            </div>

            {/* Chart */}
            <InteractiveLineChart data={data.data} height={chartHeight} />

            {/* Footer — editorial date range caption. Peak/trough
                values live inside the chart as inline markers now, so
                this row is only for the temporal span. */}
            <div className="flex justify-center items-center font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80 mt-4 pt-3 border-t border-border/40 tabular-nums">
              <span>
                {formatRangeDate(data.data[0]?.timestamp)}
                <span className="mx-2 text-border">—</span>
                {formatRangeDate(data.data[data.data.length - 1]?.timestamp)}
                <span className="mx-2 text-border">·</span>
                {data.summary.dataPoints} points
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** Short date format for the range strip: "Apr 14" */
function formatRangeDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
