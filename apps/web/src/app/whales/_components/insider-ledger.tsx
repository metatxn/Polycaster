"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import type {
  SuspicionFactor,
  SuspiciousActivity,
} from "@/hooks/use-insider-activity";
import {
  formatAccountAge,
  getSuspicionRiskLevel,
} from "@/hooks/use-insider-activity";
import { formatCurrencyCompact } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import {
  displayName,
  formatTimeAgo,
  isAnimatedImageUrl,
} from "../_lib/formatters";

interface InsiderLedgerProps {
  activities: SuspiciousActivity[];
  walletSearch: string;
}

/**
 * Suspicious trade ledger. Each row surfaces a young-account /
 * contrarian / repeat-offender signal. Click to expand the factor
 * breakdown that produced the suspicion score. Same broadsheet
 * structure as the activity ledger.
 */
export function InsiderLedger({
  activities,
  walletSearch,
}: InsiderLedgerProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = walletSearch.trim().toLowerCase();
    if (!q) return activities;
    return activities.filter(
      (a) =>
        a.account.address.toLowerCase().includes(q) ||
        a.account.name?.toLowerCase().includes(q) ||
        a.market.title.toLowerCase().includes(q)
    );
  }, [activities, walletSearch]);

  const handleToggle = (id: string) => {
    setExpanded((current) => (current === id ? null : id));
  };

  return (
    <section className="flex flex-col">
      <header className="flex items-baseline justify-between flex-wrap gap-3 pb-3">
        <div>
          <h2 className="font-editorial italic text-xl sm:text-2xl text-foreground">
            Suspicious Activity
          </h2>
          <p className="text-[11px] text-muted-foreground font-editorial italic mt-1">
            Young accounts buying into contrarian positions. Signal, not proof.
          </p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground tabular-nums">
          {filtered.length} {filtered.length === 1 ? "flag" : "flags"}
        </span>
      </header>

      <div className="border-y border-border/60">
        {/* Column headers */}
        <div className="hidden sm:grid grid-cols-[52px_84px_minmax(0,1fr)_minmax(0,1.5fr)_52px_96px_24px] gap-3 px-3 py-2 border-b border-border/40 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <span>Risk</span>
          <span>Time</span>
          <span>Wallet / Age</span>
          <span>Market</span>
          <span className="text-right">Side</span>
          <span className="text-right">Amount</span>
          <span aria-hidden />
        </div>

        {filtered.length === 0 ? (
          <div className="py-10 px-3 text-center space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              No suspicious activity at the current sensitivity
            </p>
            <p className="text-xs text-muted-foreground/80 font-editorial italic max-w-md mx-auto">
              Live detector is gated on fresh-account / size-hiding / timing-
              cluster patterns. In quieter markets, try{" "}
              <strong>Aggressive</strong> in the filters above, or widen the
              wallet search.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {filtered.map((a) => (
              <InsiderRow
                key={a.id}
                activity={a}
                isExpanded={expanded === a.id}
                onToggle={() => handleToggle(a.id)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function InsiderRow({
  activity,
  isExpanded,
  onToggle,
}: {
  activity: SuspiciousActivity;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const display = displayName(activity.account.name, activity.account.address);
  const risk = getSuspicionRiskLevel(activity.analysis.suspicionScore);
  const isBuy = activity.trade.side === "BUY";
  const fired = activity.analysis.firedArchetypes ?? [];
  const tier = activity.analysis.sortPriority ?? 0;

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "w-full px-3 py-3 sm:py-2.5 text-left text-sm transition-colors",
          tier >= 3
            ? "bg-violet-50/70 dark:bg-violet-950/25 hover:bg-violet-100/80 dark:hover:bg-violet-950/40"
            : tier === 2
              ? "bg-rose-50/60 dark:bg-rose-950/20 hover:bg-rose-100/70 dark:hover:bg-rose-950/35"
              : tier === 1
                ? "bg-amber-50/50 dark:bg-amber-950/15 hover:bg-amber-100/60 dark:hover:bg-amber-950/25"
                : "hover:bg-muted/40"
        )}
      >
        {/* Desktop: 7-column grid */}
        <div className="hidden sm:grid grid-cols-[52px_84px_minmax(0,1fr)_minmax(0,1.5fr)_52px_96px_24px] gap-3 items-center">
          <span
            className={cn(
              "inline-flex items-center justify-center h-[22px] px-1.5 text-[10px] font-mono font-bold tabular-nums rounded-sm w-fit",
              risk === "CRITICAL" && "bg-foreground text-background",
              risk === "HIGH" && "border border-foreground/80 text-foreground",
              risk === "MEDIUM" && "border border-border text-muted-foreground",
              risk === "LOW" &&
                "border border-border/50 text-muted-foreground/70"
            )}
          >
            {Math.round(activity.analysis.suspicionScore)}
          </span>

          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {formatTimeAgo(activity.timestamp)}
          </span>

          <div className="flex items-center gap-2 min-w-0">
            <div className="relative w-5 h-5 shrink-0 rounded-sm overflow-hidden bg-muted">
              {activity.account.profileImage ? (
                <Image
                  src={activity.account.profileImage}
                  alt={display}
                  fill
                  sizes="20px"
                  className="object-cover"
                  unoptimized={isAnimatedImageUrl(
                    activity.account.profileImage
                  )}
                />
              ) : (
                <span className="w-full h-full flex items-center justify-center font-mono text-[8px] font-semibold text-foreground/40">
                  {activity.account.address.slice(2, 4).toUpperCase()}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <span className="block truncate font-medium text-foreground">
                {display}
              </span>
              <span className="block font-mono text-[10px] tabular-nums text-muted-foreground">
                {formatAccountAge(activity.account.accountAgeHours)} old ·{" "}
                {activity.account.totalTrades} trades
              </span>
            </div>
            {activity.analysis.repeatOffender && (
              <span className="shrink-0 inline-flex items-center px-1.5 h-[18px] text-[9px] font-mono font-semibold uppercase tracking-[0.14em] bg-foreground/85 text-background rounded-sm">
                Repeat
              </span>
            )}
            {activity.analysis.isContrarian && (
              <span className="shrink-0 inline-flex items-center px-1.5 h-[18px] text-[9px] font-mono font-semibold uppercase tracking-[0.14em] border border-foreground/60 text-foreground rounded-sm">
                Contra
              </span>
            )}
            {fired.map((id) => (
              <ArchetypeChip key={id} id={id} />
            ))}
          </div>

          <div className="min-w-0">
            <span className="block truncate text-foreground/85">
              {activity.market.title}
            </span>
            <span className="block font-mono text-[10px] tabular-nums text-muted-foreground">
              {activity.trade.outcome} @{" "}
              {(activity.trade.price * 100).toFixed(0)}¢
            </span>
          </div>

          <span
            className={cn(
              "justify-self-end inline-flex items-center justify-center px-1.5 h-[18px] text-[9px] font-mono font-semibold uppercase tracking-[0.14em] rounded-sm w-fit",
              isBuy
                ? "bg-foreground text-background"
                : "bg-background border border-foreground/60 text-foreground"
            )}
          >
            {activity.trade.side}
          </span>

          <span className="text-right font-mono tabular-nums font-semibold text-foreground">
            {formatCurrencyCompact(activity.trade.usdcAmount)}
          </span>

          <span aria-hidden className="text-muted-foreground">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </span>
        </div>

        {/* Mobile: stacked rows */}
        <div className="sm:hidden flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center justify-center h-[20px] px-1.5 text-[10px] font-mono font-bold tabular-nums rounded-sm w-fit",
                  risk === "CRITICAL" && "bg-foreground text-background",
                  risk === "HIGH" &&
                    "border border-foreground/80 text-foreground",
                  risk === "MEDIUM" &&
                    "border border-border text-muted-foreground",
                  risk === "LOW" &&
                    "border border-border/50 text-muted-foreground/70"
                )}
              >
                {Math.round(activity.analysis.suspicionScore)}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground tabular-nums">
                {formatTimeAgo(activity.timestamp)}
              </span>
              <span
                className={cn(
                  "inline-flex items-center justify-center px-1.5 h-[18px] text-[9px] font-mono font-semibold uppercase tracking-[0.14em] rounded-sm w-fit",
                  isBuy
                    ? "bg-foreground text-background"
                    : "bg-background border border-foreground/60 text-foreground"
                )}
              >
                {activity.trade.side}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono tabular-nums font-semibold text-foreground">
                {formatCurrencyCompact(activity.trade.usdcAmount)}
              </span>
              <span aria-hidden className="text-muted-foreground shrink-0">
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 min-w-0">
            <div className="relative w-6 h-6 shrink-0 rounded-sm overflow-hidden bg-muted">
              {activity.account.profileImage ? (
                <Image
                  src={activity.account.profileImage}
                  alt={display}
                  fill
                  sizes="24px"
                  className="object-cover"
                  unoptimized={isAnimatedImageUrl(
                    activity.account.profileImage
                  )}
                />
              ) : (
                <span className="w-full h-full flex items-center justify-center font-mono text-[9px] font-semibold text-foreground/40">
                  {activity.account.address.slice(2, 4).toUpperCase()}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <span className="block truncate font-medium text-foreground">
                {display}
              </span>
              <span className="block font-mono text-[10px] tabular-nums text-muted-foreground">
                {formatAccountAge(activity.account.accountAgeHours)} old ·{" "}
                {activity.account.totalTrades} trades
              </span>
            </div>
          </div>

          {(activity.analysis.repeatOffender ||
            activity.analysis.isContrarian ||
            fired.length > 0) && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {activity.analysis.repeatOffender && (
                <span className="inline-flex items-center px-1.5 h-[16px] text-[9px] font-mono font-semibold uppercase tracking-[0.14em] bg-foreground/85 text-background rounded-sm">
                  Repeat
                </span>
              )}
              {activity.analysis.isContrarian && (
                <span className="inline-flex items-center px-1.5 h-[16px] text-[9px] font-mono font-semibold uppercase tracking-[0.14em] border border-foreground/60 text-foreground rounded-sm">
                  Contra
                </span>
              )}
              {fired.map((id) => (
                <ArchetypeChip key={id} id={id} />
              ))}
            </div>
          )}

          <div className="min-w-0">
            <span className="block truncate text-foreground/85 text-[13px]">
              {activity.market.title}
            </span>
            <span className="block font-mono text-[10px] tabular-nums text-muted-foreground">
              {activity.trade.outcome} @{" "}
              {(activity.trade.price * 100).toFixed(0)}¢
            </span>
          </div>
        </div>
      </button>

      {isExpanded && (
        <InsiderFactorBreakdown
          activity={activity}
          onOpenMarket={activity.market.eventSlug || activity.market.slug}
        />
      )}
    </div>
  );
}

const ARCHETYPE_LABEL: Record<string, string> = {
  account_loader: "Fresh-account loader",
  size_hider: "Size-hiding accumulator",
  timing_cluster: "Timing cluster",
  category_specialist: "Category specialist with edge",
  funding_cluster: "On-chain funding cluster",
  owner_cluster: "Shared Safe-owner cluster",
};

const FUNDER_CATEGORY_LABEL: Record<string, string> = {
  cex: "Centralized exchange",
  bridge: "Cross-chain bridge",
  self_custody: "Self-custody wallet",
  unknown: "Unknown",
};

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function polygonscanUrl(addr: string): string {
  return `https://polygonscan.com/address/${addr}`;
}

function InsiderFactorBreakdown({
  activity,
  onOpenMarket,
}: {
  activity: SuspiciousActivity;
  onOpenMarket: string;
}) {
  // Only show archetypes that actually fired — the `archetypes` array
  // includes zero-score entries for every detector, which would clutter
  // the drilldown if we rendered them all.
  const firedScores = (activity.analysis.archetypes ?? []).filter(
    (a) => a.score >= a.threshold
  );
  const owner = activity.analysis.owner;
  const funding = activity.analysis.funding;

  return (
    <div className="px-3 pb-4 pt-3 bg-muted/30 border-t border-border/30 space-y-4">
      {activity.analysis.reason && (
        <p className="text-[13px] text-foreground/90 font-editorial italic leading-snug max-w-3xl">
          {activity.analysis.reason}
        </p>
      )}

      {/* On-chain evidence — owner EOA + first-funder — surfaces the
          Phase 4/5 structural signals with Polygonscan links. Only
          rendered when at least one is present. */}
      {(owner?.primaryOwner || funding?.firstFunderAddress) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border border-border/40 rounded-sm p-3 bg-background/60">
          {owner?.primaryOwner && (
            <div>
              <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground mb-1">
                Safe primary owner
              </div>
              <a
                href={polygonscanUrl(owner.primaryOwner)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-foreground hover:underline tabular-nums"
              >
                {shortAddr(owner.primaryOwner)} →
              </a>
              {owner.owners && owner.owners.length > 1 && (
                <div className="text-[10px] text-muted-foreground/80 mt-0.5">
                  {owner.owners.length} owners total
                </div>
              )}
            </div>
          )}
          {funding?.firstFunderAddress && (
            <div>
              <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground mb-1">
                First funded by
              </div>
              <a
                href={polygonscanUrl(funding.firstFunderAddress)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-foreground hover:underline tabular-nums"
              >
                {shortAddr(funding.firstFunderAddress)} →
              </a>
              <div className="text-[10px] text-muted-foreground/80 mt-0.5">
                {FUNDER_CATEGORY_LABEL[funding.firstFunderCategory] ?? "—"}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Per-archetype factor groups. Each fired archetype gets its
          own labeled section with its score and the factors that
          contributed — far more readable than a flat factor list
          when 2-3 archetypes fire together. */}
      {firedScores.length > 0 && (
        <div className="space-y-3">
          {firedScores.map((s) => (
            <div key={s.archetype}>
              <div className="flex items-baseline gap-2 mb-1.5">
                <ArchetypeChip id={s.archetype} />
                <span className="text-[11px] font-medium text-foreground">
                  {ARCHETYPE_LABEL[s.archetype] ?? s.archetype}
                </span>
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                  score {s.score}/{s.threshold}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 pl-1">
                {s.factors.map((f) => (
                  <FactorRow key={f.name} factor={f} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-4 pt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <span>
          {activity.analysis.marketsInvolved}{" "}
          {activity.analysis.marketsInvolved === 1 ? "market" : "markets"}
        </span>
        <span>
          Sentiment:{" "}
          <span className="text-foreground">
            {activity.analysis.marketSentiment.toLowerCase()}
          </span>
        </span>
        <span className="flex-1" />
        <Link
          href={`/events/detail/${onOpenMarket}`}
          className="inline-flex items-center gap-1 px-2 py-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          Open market →
        </Link>
        <Link
          href={`/profile/${activity.account.address}`}
          className="inline-flex items-center gap-1 px-2 py-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          Open wallet →
        </Link>
      </div>
    </div>
  );
}

/**
 * Compact per-archetype chip shared with the backtest UI. Muted tone
 * for noisy archetypes, amber for specialist, rose for funding-
 * cluster (the Phase 4 "gold tier" signal).
 */
function ArchetypeChip({ id }: { id: string }) {
  const label =
    id === "account_loader"
      ? "FRESH"
      : id === "size_hider"
        ? "HIDER"
        : id === "timing_cluster"
          ? "CLUSTER"
          : id === "category_specialist"
            ? "SPECIALIST"
            : id === "funding_cluster"
              ? "FUNDING"
              : id === "owner_cluster"
                ? "OWNER"
                : id.toUpperCase();
  const tone =
    id === "account_loader"
      ? "bg-muted-foreground/15 text-muted-foreground"
      : id === "size_hider"
        ? "bg-foreground text-background"
        : id === "timing_cluster"
          ? "bg-background border border-foreground/60 text-foreground"
          : id === "category_specialist"
            ? "bg-amber-500 text-background shadow-sm"
            : id === "funding_cluster"
              ? "bg-rose-600 text-background shadow-sm"
              : id === "owner_cluster"
                ? "bg-violet-600 text-background shadow-sm"
                : "bg-background border border-foreground/60 text-foreground";
  return (
    <span
      className={cn(
        "shrink-0 inline-flex items-center px-1.5 h-[18px] text-[9px] font-mono font-semibold uppercase tracking-[0.14em] rounded-sm",
        tone
      )}
    >
      {label}
    </span>
  );
}

function FactorRow({ factor }: { factor: SuspicionFactor }) {
  return (
    <div className="flex items-start gap-3 text-xs">
      <span className="shrink-0 w-8 text-right font-mono tabular-nums font-semibold text-foreground">
        +{factor.points}
      </span>
      <div className="flex-1 min-w-0">
        <span className="font-semibold text-foreground">{factor.name}</span>
        <span className="text-muted-foreground"> — {factor.description}</span>
      </div>
    </div>
  );
}
