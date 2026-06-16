"use client";

import { Loader2, RotateCcw } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import type {
  CalibrationSummary,
  LiveExecutionConfigSummary,
  LiveOrderRecordSummary,
  PortfolioPnl,
  PositionSummary,
  WatchlistItem,
} from "./types";

export function Metric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="border-y border-(--kwm-hl-2) py-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3)">
        {label}
      </div>
      <div className="mt-1 font-(family-name:--font-geist) font-semibold text-2xl">
        {value}
      </div>
    </div>
  );
}

export function LiveOrdersPanel({
  orders,
  config,
  watchlist,
}: {
  orders: LiveOrderRecordSummary[];
  config: LiveExecutionConfigSummary | null;
  watchlist: WatchlistItem[];
}) {
  const watchById = useMemo(() => {
    const map = new Map<string, WatchlistItem>();
    for (const item of watchlist) map.set(item.id, item);
    return map;
  }, [watchlist]);

  if (!config) return null;

  const modeLabel = !config.enabled
    ? "OFF"
    : config.dryRun
      ? "DRY-RUN"
      : config.confirmedReal
        ? "LIVE"
        : "LIVE (unconfirmed)";
  const modeClass = !config.enabled
    ? "border-(--kwm-hl-2) text-(--kwm-ink-3)"
    : config.dryRun
      ? "border-amber-600/70 text-(--kwm-warn) dark:text-amber-400"
      : config.confirmedReal
        ? "border-rose-600/70 text-rose-700 dark:text-rose-400"
        : "border-rose-600/70 text-rose-700 dark:text-rose-400";
  const counts = orders.reduce(
    (acc, order) => {
      acc.total += 1;
      if (order.status === "DRY_RUN") acc.dryRun += 1;
      else if (order.status === "POSTED") acc.posted += 1;
      else if (order.status === "OPEN") acc.open += 1;
      else if (order.status === "PARTIALLY_FILLED") acc.partial += 1;
      else if (order.status === "FILLED") acc.filled += 1;
      else if (order.status === "FAILED") acc.failed += 1;
      else if (order.status === "CANCELED") acc.canceled += 1;
      return acc;
    },
    {
      total: 0,
      dryRun: 0,
      posted: 0,
      open: 0,
      partial: 0,
      filled: 0,
      failed: 0,
      canceled: 0,
    }
  );

  return (
    <section className="border-y border-(--kwm-hl-2) py-4 mb-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-mono text-xs uppercase tracking-[0.14em]">
            Live Orders
          </h2>
          <p className="mt-1 text-xs text-(--kwm-ink-3)">
            EIP-712 signed audit trail · dry-run signs but does not submit ·
            Polymarket CLOB chain {config.chainId}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`font-mono uppercase tracking-[0.12em] px-2 py-1 border ${modeClass}`}
          >
            {modeLabel}
          </span>
          {!config.hasWalletKey && config.enabled && (
            <span className="font-mono uppercase tracking-[0.12em] px-2 py-1 border border-rose-600/70 text-rose-700 dark:text-rose-400">
              NO KEY
            </span>
          )}
          {config.emergencyStop && (
            <span className="font-mono uppercase tracking-[0.12em] px-2 py-1 border border-rose-600/70 text-rose-700 dark:text-rose-400">
              STOP
            </span>
          )}
          {config.enabled &&
            !config.dryRun &&
            !config.hasCredentialEncryptionKey && (
              <span className="font-mono uppercase tracking-[0.12em] px-2 py-1 border border-amber-600/70 text-(--kwm-warn) dark:text-amber-400">
                CREDS NOT CACHED
              </span>
            )}
          <span className="text-(--kwm-ink-3)">
            cap{" "}
            <span className="font-mono text-(--kwm-ink)">
              ${config.maxLiveNotionalUsd}
            </span>
          </span>
          {(config.dailyOrderCap || config.dailyNotionalCap) && (
            <span className="text-(--kwm-ink-3)">
              daily{" "}
              <span className="font-mono text-(--kwm-ink)">
                {config.dailyOrderCap ?? "∞"} / $
                {config.dailyNotionalCap ?? "∞"}
              </span>
            </span>
          )}
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-3 sm:grid-cols-8 gap-3 text-xs">
        <CountTile label="Total" value={counts.total} />
        <CountTile label="Dry-run" value={counts.dryRun} />
        <CountTile label="Posted" value={counts.posted} />
        <CountTile label="Open" value={counts.open} />
        <CountTile label="Partial" value={counts.partial} />
        <CountTile label="Filled" value={counts.filled} />
        <CountTile label="Failed" value={counts.failed} />
        <CountTile label="Canceled" value={counts.canceled} />
      </dl>
      {orders.length === 0 ? (
        <p className="mt-3 text-xs text-(--kwm-ink-3)">
          No live orders yet. Set <code>AGENT_EXECUTION_MODE=live</code> on a
          run to start producing signed audit rows.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {orders.slice(0, 8).map((order) => (
            <LiveOrderRow
              key={order.idempotencyKey}
              order={order}
              question={
                watchById.get(order.watchlistItemId)?.question ??
                `${order.tokenId.slice(0, 14)}…`
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CountTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-(--kwm-hl-2) px-2 py-1">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3)">
        {label}
      </div>
      <div className="font-(family-name:--font-geist) font-semibold text-lg">
        {value}
      </div>
    </div>
  );
}

function LiveOrderRow({
  order,
  question,
}: {
  order: LiveOrderRecordSummary;
  question: string;
}) {
  const statusClass =
    order.status === "FILLED"
      ? "border-emerald-600/70 text-(--kwm-up) dark:text-(--kwm-up)"
      : order.status === "PARTIALLY_FILLED"
        ? "border-teal-600/70 text-teal-700 dark:text-teal-400"
        : order.status === "FAILED" || order.status === "CANCELED"
          ? "border-rose-600/70 text-rose-700 dark:text-rose-400"
          : order.status === "POSTED" || order.status === "OPEN"
            ? "border-sky-600/70 text-sky-700 dark:text-sky-400"
            : "border-amber-600/70 text-(--kwm-warn) dark:text-amber-400";
  return (
    <details className="border border-(--kwm-hl-2) px-3 py-2">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-xs">
        <span
          className={`font-mono uppercase tracking-[0.12em] px-2 py-0.5 border ${statusClass}`}
        >
          {order.status}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3)">
          {order.side}
        </span>
        <span className="font-medium line-clamp-1">{question}</span>
        <span className="ml-auto font-mono text-[10px] text-(--kwm-ink-3)">
          ${order.requestedSizeUsd} @ {order.price}
        </span>
      </summary>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-(--kwm-ink-3)">
        <dt>Idempotency key</dt>
        <dd className="font-mono text-(--kwm-ink) break-all">
          {order.idempotencyKey}
        </dd>
        <dt>Created</dt>
        <dd className="font-mono text-(--kwm-ink)">
          {new Date(order.createdAt).toLocaleString()}
        </dd>
        <dt>Filled</dt>
        <dd className="font-mono text-(--kwm-ink)">
          ${order.filledNotionalUsd} / {order.filledShares} shares
        </dd>
        {order.averageFillPrice && (
          <>
            <dt>Avg fill</dt>
            <dd className="font-mono text-(--kwm-ink)">
              {order.averageFillPrice}
            </dd>
          </>
        )}
        {order.lastSyncedAt && (
          <>
            <dt>Last sync</dt>
            <dd className="font-mono text-(--kwm-ink)">
              {new Date(order.lastSyncedAt).toLocaleString()}
            </dd>
          </>
        )}
        {order.orderId && (
          <>
            <dt>Order ID</dt>
            <dd className="font-mono text-(--kwm-ink) break-all">
              {order.orderId}
            </dd>
          </>
        )}
        {order.error && (
          <>
            <dt>Error</dt>
            <dd className="font-mono text-rose-700 dark:text-rose-400 line-clamp-2">
              {order.error}
            </dd>
          </>
        )}
      </dl>
      {order.signedOrderHash && (
        <div className="mt-2 border-t border-(--kwm-hl-2) pt-2 font-mono text-[10px] text-(--kwm-ink-3)">
          <span className="font-sans">signed-order sha256:</span>{" "}
          <span className="break-all">{order.signedOrderHash}</span>
        </div>
      )}
    </details>
  );
}

export function PositionsPanel({
  positions,
  portfolio,
  watchlist,
}: {
  positions: PositionSummary[];
  portfolio: PortfolioPnl | null;
  watchlist: WatchlistItem[];
}) {
  const watchById = useMemo(() => {
    const map = new Map<string, WatchlistItem>();
    for (const item of watchlist) map.set(item.id, item);
    return map;
  }, [watchlist]);
  const open = positions.filter((p) => p.status === "OPEN");
  const closed = positions.filter((p) => p.status === "CLOSED");
  const realized = portfolio ? Number.parseFloat(portfolio.realizedPnlUsd) : 0;
  const realizedClass =
    realized > 0
      ? "text-(--kwm-up) dark:text-(--kwm-up)"
      : realized < 0
        ? "text-rose-700 dark:text-rose-400"
        : "text-(--kwm-ink)";
  return (
    <section className="border-y border-(--kwm-hl-2) py-4 mb-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="font-mono text-xs uppercase tracking-[0.14em]">
            Positions
          </h2>
          <p className="mt-1 text-xs text-(--kwm-ink-3)">
            Lifecycle state per market · close on contradicting vote, time-exit,
            or resolution
          </p>
        </div>
        <div className="flex gap-4 text-xs">
          <span>
            <span className="font-mono uppercase tracking-[0.12em] text-(--kwm-ink-3)">
              Open
            </span>{" "}
            <span className="font-(family-name:--font-geist) font-semibold text-lg">
              {open.length}
            </span>
          </span>
          <span>
            <span className="font-mono uppercase tracking-[0.12em] text-(--kwm-ink-3)">
              Closed
            </span>{" "}
            <span className="font-(family-name:--font-geist) font-semibold text-lg">
              {closed.length}
            </span>
          </span>
          <span>
            <span className="font-mono uppercase tracking-[0.12em] text-(--kwm-ink-3)">
              Realized P&amp;L
            </span>{" "}
            <span
              className={`font-(family-name:--font-geist) font-semibold text-lg ${realizedClass}`}
            >
              {realized < 0 ? "-" : ""}${Math.abs(realized).toFixed(2)}
            </span>
          </span>
        </div>
      </div>
      {positions.length === 0 ? (
        <p className="mt-3 text-xs text-(--kwm-ink-3)">
          No positions yet. The agent will open one the next time a run produces
          an approved BUY decision on a watchlist item.
        </p>
      ) : (
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {positions.slice(0, 9).map((position) => (
            <PositionCard
              key={position.id}
              position={position}
              question={
                watchById.get(position.watchlistItemId)?.question ??
                position.tokenId.slice(0, 12)
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PositionCard({
  position,
  question,
}: {
  position: PositionSummary;
  question: string;
}) {
  const realized =
    position.realizedPnlUsd !== null
      ? Number.parseFloat(position.realizedPnlUsd)
      : null;
  const pnlClass =
    realized === null
      ? "text-(--kwm-ink-3)"
      : realized > 0
        ? "text-(--kwm-up) dark:text-(--kwm-up)"
        : realized < 0
          ? "text-rose-700 dark:text-rose-400"
          : "text-(--kwm-ink)";
  return (
    <div className="border border-(--kwm-hl-2) p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-sm line-clamp-2">{question}</div>
        <span
          className={`font-mono text-[10px] uppercase tracking-[0.12em] px-2 py-0.5 border ${
            position.status === "OPEN"
              ? "border-amber-600/70 text-(--kwm-warn) dark:text-amber-400"
              : "border-(--kwm-hl-2) text-(--kwm-ink-3)"
          }`}
        >
          {position.status}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-(--kwm-ink-3)">
        <dt>Entry</dt>
        <dd className="text-right font-mono text-(--kwm-ink)">
          {position.shares} @ {position.entryPrice}
        </dd>
        <dt>Notional</dt>
        <dd className="text-right font-mono text-(--kwm-ink)">
          ${position.entryNotionalUsd}
        </dd>
        {position.status === "CLOSED" && (
          <>
            <dt>Exit</dt>
            <dd className="text-right font-mono text-(--kwm-ink)">
              {position.exitPrice}
              {position.closeReason ? ` · ${position.closeReason}` : ""}
            </dd>
            <dt>Realized P&amp;L</dt>
            <dd className={`text-right font-mono ${pnlClass}`}>
              {realized !== null && realized < 0 ? "-" : ""}$
              {realized !== null ? Math.abs(realized).toFixed(2) : "0.00"}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

export function CalibrationPanel({
  calibration,
  refreshing,
  onRefresh,
}: {
  calibration: CalibrationSummary | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const models = calibration?.models ?? [];
  return (
    <section className="border-y border-(--kwm-hl-2) py-4 mb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-mono text-xs uppercase tracking-[0.14em]">
            Calibration
          </h2>
          <p className="mt-1 text-xs text-(--kwm-ink-3)">
            Per-model Brier score over resolved markets · lower is better · 0.25
            is no-skill
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={refreshing}
        >
          {refreshing ? (
            <Loader2 className="mr-2 h-3 w-3 animate-spin" />
          ) : (
            <RotateCcw className="mr-2 h-3 w-3" />
          )}
          Refresh resolutions
        </Button>
      </div>
      {models.length === 0 ? (
        <p className="mt-3 text-xs text-(--kwm-ink-3)">
          No resolved markets yet. Once watchlist items pass their end time,
          click Refresh resolutions to fetch outcomes from Polymarket.
        </p>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 md:grid-cols-3">
          {models.map((model) => (
            <div
              key={model.provider}
              className="border border-(--kwm-hl-2) px-3 py-2"
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3) truncate">
                {model.provider}
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="font-(family-name:--font-geist) font-semibold text-xl">
                  {model.brierMean.toFixed(3)}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3)">
                  n={model.count}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function StatusPill({
  label,
  ready,
  value,
}: {
  label: string;
  ready: boolean;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border border-(--kwm-hl-2) px-3 py-2">
      <span className="font-mono uppercase tracking-[0.12em] text-(--kwm-ink-3)">
        {label}
      </span>
      <span className={ready ? "text-(--kwm-up)" : "text-(--kwm-warn)"}>
        {value}
      </span>
    </div>
  );
}
