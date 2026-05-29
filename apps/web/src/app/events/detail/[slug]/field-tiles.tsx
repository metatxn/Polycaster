"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  type PriceHistoryPoint,
  useBatchPriceHistory,
} from "@/hooks/use-price-history-batch";
import { cn } from "@/lib/utils";

/**
 * Field tiles — the top-N contender tiles rendered above the chart on
 * multi-outcome event-detail pages. Each tile shows the outcome's name +
 * rank, leading %, cents sub-text, 24h move pill, a 30D sparkline, and
 * payout odds + volume. Clicking a tile selects that market for the
 * chart and trading panel — same contract as the previous
 * `CandidateTicker`.
 *
 * Visual system follows the `Knoww Market Detail` design handoff. All
 * colors derive from `--kwm-*` tokens inside `.kw-app` so the tile
 * tracks the active theme automatically — only the per-outcome accent
 * is a fixed palette color (passed in via the parent's `color` field).
 */

export interface FieldTilesMarket {
  id: string;
  groupItemTitle: string;
  /** YES probability 0..1 (NOT a percent). */
  yesProbability: number;
  /** YES price as a string ("0.173" etc). */
  yesPrice: string;
  /** 24h price change in *percentage points* of the YES price
   *  (e.g. 1.1 = +1.1¢, -30 = -30¢). Matches the value already produced
   *  by `toDisplayPercentagePointChange` in `event-detail-client.tsx`. */
  change: number;
  /** Whether the change field has a real upstream value (vs the default 0). */
  hasOneDayPriceChange?: boolean;
  /** Market 24h dollar volume. */
  volume: string;
  /** Per-outcome accent color — already assigned by the parent's palette. */
  color: string;
  /** CLOB YES token id — used to look up the sparkline series. */
  yesTokenId: string;
}

interface FieldTilesProps {
  markets: FieldTilesMarket[];
  selectedMarketId: string;
  onSelectMarket: (id: string) => void;
  /** Total number of outcomes the event actually has — used for the
   *  "5 of 48" right-meta label. */
  totalOutcomes?: number;
  /** Live-feed connection state — drives the LIVE pulse next to the
   *  right-meta label. */
  isLive?: boolean;
}

/* ─────────── Sparkline (mini SVG inline chart) ─────────── */

function Spark({
  data,
  color,
  width = 70,
  height = 20,
}: {
  data: PriceHistoryPoint[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (!data || data.length < 2) return null;
  const ys = data.map((d) => d.p);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const pts = data.map((d, i): [number, number] => [
    i * step,
    height - ((d.p - min) / range) * (height - 4) - 2,
  ]);
  const path = pts
    .map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`))
    .join(" ");
  const area = `${path} L${width},${height} L0,${height} Z`;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      style={{ display: "block" }}
      preserveAspectRatio="none"
    >
      <path d={area} fill={color} fillOpacity={0.1} />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ─────────── Formatters ─────────── */

function formatPctBig(pct0to1: number): string {
  const clamped = Math.max(0, Math.min(1, pct0to1));
  return Math.round(clamped * 100).toString();
}

function formatCents(price: string): string {
  const n = Number.parseFloat(price);
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}¢`;
}

function formatPayoutOdds(yesPrice: string): string {
  const p = Number.parseFloat(yesPrice);
  if (!Number.isFinite(p) || p <= 0) return "—";
  const odds = 1 / p;
  if (odds >= 100) return `${Math.round(odds)}×`;
  if (odds >= 10) return `${odds.toFixed(0)}×`;
  return `${odds.toFixed(1)}×`;
}

function formatVolume(volume: string): string {
  const n = Number.parseFloat(volume);
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(2)}K`;
  return `$${n.toFixed(0)}`;
}

/** Format the 24h change as a tiny cents delta — design displays this
 *  as `▲ 1.1` / `▼ 0.4` / `— 0.0`. Input is in percentage points of YES
 *  price (1.1 = +1.1¢). */
function formatChangeCents(changePp: number): {
  arrow: string;
  value: string;
  tone: "up" | "down" | "flat";
} {
  if (!Number.isFinite(changePp) || Math.abs(changePp) < 0.05) {
    return { arrow: "—", value: "0.0", tone: "flat" };
  }
  const tone = changePp > 0 ? "up" : "down";
  const arrow = changePp > 0 ? "▲" : "▼";
  const value = Math.abs(changePp).toFixed(1);
  return { arrow, value, tone };
}

/* ─────────── Tile ─────────── */

function FieldTile({
  market,
  rank,
  isSelected,
  history,
  onSelect,
}: {
  market: FieldTilesMarket;
  rank: number;
  isSelected: boolean;
  history: PriceHistoryPoint[] | undefined;
  onSelect: () => void;
}) {
  const big = formatPctBig(market.yesProbability / 100);
  const cents = formatCents(market.yesPrice);
  const odds = formatPayoutOdds(market.yesPrice);
  const vol = formatVolume(market.volume);
  // Always render the change pill so all tiles share the same vertical
  // rhythm. When the upstream `oneDayPriceChange` is missing we show a
  // dimmed em-dash placeholder rather than collapsing the row, which
  // previously made Brazil-style tiles look visually shorter than the
  // others (chat feedback).
  const change = market.hasOneDayPriceChange
    ? formatChangeCents(market.change)
    : { arrow: "—", value: "—", tone: "flat" as const };

  const toneColor =
    change.tone === "up"
      ? "var(--kwm-up)"
      : change.tone === "down"
        ? "var(--kwm-down)"
        : "var(--kwm-ink-dim)";
  const toneBg =
    change.tone === "up"
      ? "var(--kwm-up-soft)"
      : change.tone === "down"
        ? "var(--kwm-down-soft)"
        : "transparent";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      className={cn(
        "kwm-fld relative text-left rounded-md border transition-colors",
        "flex flex-col gap-1 px-2.5 py-2 min-w-[170px] lg:min-w-0"
      )}
      style={{
        borderColor: isSelected ? "var(--kwm-hl-3)" : "var(--kwm-hl)",
        background: isSelected ? "var(--kwm-bg-3)" : "var(--kwm-bg-2)",
        boxShadow: isSelected ? "inset 0 0 0 1px var(--kwm-hl-2)" : undefined,
      }}
    >
      {/* Accent bar — colored vertical rail on the left edge */}
      <span
        aria-hidden="true"
        className="absolute left-0 top-2 bottom-2 w-[2px] rounded-sm"
        style={{ background: market.color, opacity: 0.85 }}
      />

      {/* Top row: name + rank */}
      <div className="flex items-center justify-between gap-2 pl-1.5">
        <span
          className="inline-flex items-center gap-2 text-[13px] font-medium truncate"
          style={{ color: "var(--kwm-ink)", letterSpacing: "-0.005em" }}
        >
          <span
            className="inline-block h-[14px] w-[14px] rounded-[3px] border shrink-0"
            style={{
              background: market.color,
              borderColor: "var(--kwm-hl-2)",
            }}
            aria-hidden="true"
          />
          <span className="truncate">{market.groupItemTitle}</span>
        </span>
        <span
          className="font-mono text-[10px] tabular-nums shrink-0"
          style={{ color: "var(--kwm-ink-dim)", letterSpacing: "0.10em" }}
        >
          #{rank}
        </span>
      </div>

      {/* Middle row: big % + cents + 24h move pill (left col)
                     sparkline (right col, lg+) */}
      <div className="grid grid-cols-[1fr_auto] gap-2 items-center pl-1.5">
        <div className="flex items-baseline gap-1.5 flex-wrap min-w-0">
          <span
            className="font-medium leading-none"
            style={{
              color: "var(--kwm-ink)",
              fontSize: "22px",
              letterSpacing: "-0.035em",
            }}
          >
            {big}
            <span
              style={{
                fontSize: "13px",
                color: "var(--kwm-ink-3)",
                marginLeft: "1px",
              }}
            >
              %
            </span>
          </span>
          <span
            className="font-mono tabular-nums"
            style={{ color: "var(--kwm-ink-3)", fontSize: "11px" }}
          >
            <b style={{ color: "var(--kwm-ink-2)", fontWeight: 500 }}>
              {cents}
            </b>
          </span>
          <span
            role="status"
            className="font-mono tabular-nums px-1.5 py-px rounded-sm shrink-0"
            style={{
              color: toneColor,
              background: toneBg,
              fontSize: "10px",
              letterSpacing: "0.04em",
            }}
            title={
              market.hasOneDayPriceChange
                ? "24-hour change"
                : "24-hour change unavailable"
            }
          >
            {change.arrow} {change.value}
          </span>
        </div>
        <div className="hidden sm:block">
          {history && history.length >= 2 ? (
            <Spark data={history} color={market.color} width={64} height={20} />
          ) : (
            <span
              className="block w-16 h-[1px]"
              style={{ background: "var(--kwm-hl)" }}
              aria-hidden="true"
            />
          )}
        </div>
      </div>

      {/* Foot row: payout odds + volume */}
      <div
        className="flex items-baseline justify-between font-mono pl-1.5 pt-0.5"
        style={{
          fontSize: "10px",
          color: "var(--kwm-ink-dim)",
          letterSpacing: "0.04em",
        }}
      >
        <span style={{ color: "var(--kwm-ink-2)" }}>{odds} payout</span>
        <span style={{ color: "var(--kwm-ink-3)" }}>{vol}</span>
      </div>
    </button>
  );
}

/* ─────────── FieldTiles ─────────── */

export function FieldTiles({
  markets,
  selectedMarketId,
  onSelectMarket,
  totalOutcomes,
  isLive,
}: FieldTilesProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
    // Only run when the selected id changes — not on every parent re-render,
    // which would yank the user's manual scroll position back to center.
  }, []);

  const top = markets.slice(0, 5);

  // Fetch the 30D sparkline for each tile's YES token in a single batch.
  // Deduped + sorted inside the hook so the query key stays stable.
  const tokenIds = useMemo(
    () => top.map((m) => m.yesTokenId).filter(Boolean),
    [top]
  );
  const { data: historyByToken } = useBatchPriceHistory(tokenIds, {
    enabled: tokenIds.length > 0,
  });

  if (markets.length === 0) return null;

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center gap-3 pt-3 pb-2">
        <span
          className="font-mono"
          style={{ color: "var(--kwm-ink-dim)", fontSize: "14px" }}
          aria-hidden="true"
        >
          §
        </span>
        <h3
          className="m-0 font-mono"
          style={{
            color: "var(--kwm-ink-2)",
            fontSize: "11px",
            fontWeight: 500,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
          }}
        >
          The Field
        </h3>
        <span
          className="flex-1 h-px"
          style={{ background: "var(--kwm-hl)" }}
          aria-hidden="true"
        />
        <span
          className="font-mono flex items-center gap-1.5"
          style={{
            color: "var(--kwm-ink-dim)",
            fontSize: "10px",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
          }}
        >
          {top.length}
          {totalOutcomes && totalOutcomes > top.length
            ? ` of ${totalOutcomes}`
            : ""}
          {isLive && (
            <>
              <span style={{ color: "var(--kwm-hl-2)" }}>·</span>
              <span className="inline-flex items-center gap-1">
                <span className="kwm-pulse" aria-hidden="true" />
                <span style={{ color: "var(--kwm-up)" }}>LIVE</span>
              </span>
            </>
          )}
        </span>
      </div>

      {/* Tile grid — 5 cols at lg+, horizontal scroll below.
          `minmax(0, 1fr)` so each column shrinks correctly. */}
      <div
        ref={scrollRef}
        className={cn(
          "flex gap-1.5 overflow-x-auto scrollbar-hide",
          "lg:grid lg:gap-1.5 lg:overflow-visible"
        )}
        style={{
          gridTemplateColumns:
            top.length > 0
              ? `repeat(${top.length}, minmax(0, 1fr))`
              : undefined,
        }}
      >
        {top.map((m, i) => {
          const isSelected = m.id === selectedMarketId;
          return (
            <div
              key={m.id}
              ref={isSelected ? selectedRef : undefined}
              className="contents lg:block"
            >
              <FieldTile
                market={m}
                rank={i + 1}
                isSelected={isSelected}
                history={historyByToken?.get(m.yesTokenId)}
                onSelect={() => onSelectMarket(m.id)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
