"use client";

import { useId, useMemo } from "react";
import { formatCurrencyCompact } from "@/lib/formatters";
import type { PressurePoint } from "../_lib/aggregates";

interface WhalePressureChartProps {
  series: PressurePoint[];
  height?: number;
}

/**
 * Pressure tape. Each vertical mark is a time bucket — buy volume
 * extends above the centerline, sell volume below. Overlaid is a
 * single thin path tracing cumulative NET flow (buy minus sell). A
 * glance tells you:
 *   - where the rhythm clustered (dense bars) vs. quiet stretches
 *   - which side dominated each bucket (asymmetry around zero)
 *   - overall directional bias through the window (net path rising
 *     or falling, and where it ended)
 *
 * Replaces the earlier dual-monotonic cumulative chart, which could
 * only climb up and so hid the direction of pressure.
 */
export function WhalePressureChart({
  series,
  height = 140,
}: WhalePressureChartProps) {
  const gradId = useId();

  const chart = useMemo(() => {
    if (series.length < 2) return null;

    const maxBar = Math.max(
      ...series.map((p) => Math.max(p.bucketBuy, p.bucketSell))
    );
    if (maxBar <= 0) return null;

    // Cumulative net scaled to its own axis (secondary), so it reads
    // cleanly regardless of bar magnitude.
    const netVals = series.map((p) => p.net);
    const maxAbsNet = Math.max(
      Math.abs(Math.min(...netVals, 0)),
      Math.abs(Math.max(...netVals, 0)),
      1
    );

    const w = 1000;
    const h = 100;
    const padY = 6;
    const midY = h / 2;
    const halfH = midY - padY;

    const x = (t: number) => t * w;
    const yBar = (v: number) => (v / maxBar) * halfH;
    const yNet = (v: number) => midY - (v / maxAbsNet) * halfH;

    // Bar widths: leave a hair of gap between buckets.
    const barGap = 2;
    const barW = Math.max(1, w / series.length - barGap);

    const bars = series.map((p, i) => {
      const cx = x(p.t);
      const buyH = yBar(p.bucketBuy);
      const sellH = yBar(p.bucketSell);
      return {
        key: i,
        x: cx - barW / 2,
        buyY: midY - buyH,
        buyH,
        sellY: midY,
        sellH,
        width: barW,
      };
    });

    const netPath = series
      .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t)},${yNet(p.net)}`)
      .join(" ");

    // Fill area between net path and centerline for subtle direction.
    const netArea = `${netPath} L${x(1)},${midY} L${x(0)},${midY} Z`;

    const finalNet = series[series.length - 1].net;
    const finalNetY = yNet(finalNet);

    return {
      w,
      h,
      midY,
      bars,
      netPath,
      netArea,
      finalNet,
      finalNetY,
    };
  }, [series]);

  if (!chart) {
    return (
      <div
        className="border-b border-(--kwm-hl-2)/50 flex items-center justify-center text-[10px] font-mono uppercase tracking-[0.14em] text-(--kwm-ink-dim)"
        style={{ height }}
      >
        Not enough data for the selected window
      </div>
    );
  }

  const netIsPositive = chart.finalNet >= 0;

  return (
    <div className="border-b border-(--kwm-hl-2)/50 py-4 relative">
      {/* Caption */}
      <div className="flex items-center justify-between px-1 pb-2 font-mono text-[10px] uppercase tracking-[0.14em]">
        <span className="text-(--kwm-ink-3)">
          Pressure tape — bars per bucket · line traces net flow
        </span>
        <div className="flex items-center gap-3 text-(--kwm-ink-3)">
          <LegendSwatch kind="bar-up" label="Buy" />
          <LegendSwatch kind="bar-down" label="Sell" />
          <LegendSwatch kind="line" label="Net" />
        </div>
      </div>

      <svg
        viewBox={`0 0 ${chart.w} ${chart.h}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="img"
        aria-label="Whale buy and sell pressure across window"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.14" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Net cumulative — area fill beneath the path, subtle */}
        <path
          d={chart.netArea}
          fill={`url(#${gradId})`}
          className="text-(--kwm-ink)"
        />

        {/* Per-bucket bars */}
        <g className="text-(--kwm-ink)">
          {chart.bars.map((b) => (
            <g key={b.key}>
              {b.buyH > 0 && (
                <rect
                  x={b.x}
                  y={b.buyY}
                  width={b.width}
                  height={b.buyH}
                  fill="currentColor"
                  fillOpacity="0.85"
                />
              )}
              {b.sellH > 0 && (
                <rect
                  x={b.x}
                  y={b.sellY}
                  width={b.width}
                  height={b.sellH}
                  fill="currentColor"
                  fillOpacity="0.3"
                />
              )}
            </g>
          ))}
        </g>

        {/* Zero centerline — drawn on top so bars don't look joined */}
        <line
          x1="0"
          y1={chart.midY}
          x2={chart.w}
          y2={chart.midY}
          stroke="currentColor"
          strokeOpacity="0.35"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />

        {/* Net cumulative — thin path on top */}
        <path
          d={chart.netPath}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeOpacity="0.95"
          vectorEffect="non-scaling-stroke"
          className="text-(--kwm-ink)"
        />
      </svg>

      {/* Final net readout pinned to the right edge */}
      <div className="absolute right-1 bottom-1 font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3) flex items-baseline gap-1.5">
        <span>Net</span>
        <span className="text-(--kwm-ink) tabular-nums font-semibold">
          {netIsPositive ? "+" : "−"}
          {formatCurrencyCompact(Math.abs(chart.finalNet))}
        </span>
      </div>
    </div>
  );
}

function LegendSwatch({
  kind,
  label,
}: {
  kind: "bar-up" | "bar-down" | "line";
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {kind === "bar-up" && (
        <span className="inline-block h-2 w-[3px] bg-foreground/85" />
      )}
      {kind === "bar-down" && (
        <span className="inline-block h-2 w-[3px] bg-foreground/30" />
      )}
      {kind === "line" && (
        <span className="inline-block h-px w-4 bg-foreground" />
      )}
      <span>{label}</span>
    </span>
  );
}
