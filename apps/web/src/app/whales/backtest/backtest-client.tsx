"use client";

import { ChevronLeft, Loader2, Play } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Navbar } from "@/components/navbar";
import { formatCurrencyCompact } from "@/lib/formatters";
import type { BacktestResult } from "@/lib/insider/backtest";
import { cn } from "@/lib/utils";

interface RunOptions {
  maxDaysAgo: number;
  minDaysAgo: number;
  minDurationHours: number;
  minVolumeUsd: number;
  maxMarkets: number;
  minSuspicionScore: number;
  minTradeUsd: number;
}

// Phase 3/4 baseline config — tuned to produce enough specialist-
// eligible wallets that gold/silver sortPriority tiers actually
// render. Lower values (e.g. minTradeUsd=$500) drown the sample in
// crypto-threshold markets where no one has a measurable specialty,
// so gold/silver never fires and the new UI looks broken.
const DEFAULT_OPTIONS: RunOptions = {
  maxDaysAgo: 21,
  minDaysAgo: 2,
  minDurationHours: 24,
  minVolumeUsd: 10000,
  maxMarkets: 30,
  minSuspicionScore: 30,
  minTradeUsd: 200,
};

export function BacktestClient() {
  const router = useRouter();
  const [options, setOptions] = useState<RunOptions>(DEFAULT_OPTIONS);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateOption = useCallback(
    <K extends keyof RunOptions>(key: K, value: number) => {
      setOptions((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const run = useCallback(async () => {
    setIsRunning(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        maxDaysAgo: options.maxDaysAgo.toString(),
        minDaysAgo: options.minDaysAgo.toString(),
        minDurationHours: options.minDurationHours.toString(),
        minVolumeUsd: options.minVolumeUsd.toString(),
        maxMarkets: options.maxMarkets.toString(),
        minScore: options.minSuspicionScore.toString(),
        minTradeUsd: options.minTradeUsd.toString(),
      });
      const res = await fetch(`/api/whales/backtest?${params.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as BacktestResult;
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setIsRunning(false);
    }
  }, [options]);

  return (
    <div className="kw-app min-h-screen relative overflow-x-hidden bg-(--kwm-bg) text-(--kwm-ink) selection:bg-(--kwm-ink)/15">
      <Navbar />

      <main className="relative z-10 px-3 sm:px-4 md:px-6 lg:px-8 pt-4 sm:pt-6 pb-24 xl:pb-8 max-w-6xl mx-auto">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-[0.12em] text-(--kwm-ink-3) mb-6">
          <button
            type="button"
            onClick={() => router.push("/whales")}
            className="flex items-center gap-1 hover:text-(--kwm-ink) transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            <span>Whales</span>
          </button>
          <span className="text-border/80">&rsaquo;</span>
          <span className="text-(--kwm-ink)">Insider Backtest</span>
        </div>

        {/* Hero — upright Geist (matches the rest of the functional product
            chrome; italic Fraunces is reserved for narrative empty states). */}
        <header className="mb-8 pb-4 border-b border-(--kwm-hl)">
          <div className="flex items-baseline gap-3 mb-1">
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-(--kwm-ink-3)">
              § Insider Backtest
            </span>
          </div>
          <h1 className="font-(family-name:--font-geist) font-semibold text-3xl sm:text-4xl leading-[1.05] tracking-tight text-(--kwm-ink)">
            Replay the detector
          </h1>
          <p className="mt-3 text-sm sm:text-base text-(--kwm-ink-3) leading-snug max-w-2xl">
            Run the current detector against resolved Polymarket markets.
            Measure whether flagged trades actually win more often than the
            market base rate — and by how much.
          </p>
        </header>

        {/* Controls — editable so you can push harder configs without
            editing code. Specialist firings need roomy samples; the
            Phase 3/4 sweet spot has been 30 markets × $200 min trade. */}
        <section className="border-y border-(--kwm-hl) py-4 mb-8 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4">
          <Control
            label="Window"
            value={`${options.minDaysAgo}-${options.maxDaysAgo}d`}
            hint="age of resolved markets"
          />
          <NumberControl
            label="Markets"
            value={options.maxMarkets}
            hint="sampled per run"
            min={5}
            max={60}
            step={5}
            disabled={isRunning}
            onChange={(v) => updateOption("maxMarkets", v)}
          />
          <NumberControl
            label="Min Score"
            value={options.minSuspicionScore}
            hint="suspicion threshold"
            min={0}
            max={100}
            step={5}
            disabled={isRunning}
            onChange={(v) => updateOption("minSuspicionScore", v)}
          />
          <NumberControl
            label="Min Trade $"
            value={options.minTradeUsd}
            hint="usd filter"
            min={0}
            max={10000}
            step={100}
            disabled={isRunning}
            onChange={(v) => updateOption("minTradeUsd", v)}
          />
        </section>

        <div className="flex items-center gap-3 mb-10">
          <button
            type="button"
            disabled={isRunning}
            onClick={run}
            className={cn(
              "inline-flex items-center gap-2 px-4 py-2 bg-(--kwm-ink) text-(--kwm-bg) text-sm font-medium tracking-tight hover:opacity-90 transition-opacity disabled:opacity-60",
              isRunning && "cursor-wait"
            )}
          >
            {isRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {isRunning ? "Running backtest…" : "Run backtest"}
          </button>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3)">
            ~30-120s · paginates live against Polymarket
          </span>
        </div>

        {error && (
          <div className="mb-10 p-4 border border-(--kwm-down)/40 bg-(--kwm-down-soft) text-sm">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-down) mb-1">
              Backtest failed
            </div>
            <code className="text-(--kwm-down)">{error}</code>
          </div>
        )}

        {isRunning && !result && (
          <div className="py-24 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-(--kwm-ink-3)">
            Fetching resolved markets, trades, and trader histories…
          </div>
        )}

        {result && <Results result={result} />}
      </main>
    </div>
  );
}

function Control({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3)">
        {label}
      </div>
      <div className="mt-1 font-(family-name:--font-geist) font-semibold tracking-tight text-2xl text-(--kwm-ink)">
        {value}
      </div>
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3)">
        {hint}
      </div>
    </div>
  );
}

function NumberControl({
  label,
  value,
  hint,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  hint: string;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3)">
        {label}
      </div>
      <input
        type="number"
        name={label.toLowerCase().replace(/\s+/g, "-")}
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          const next = Number.parseFloat(e.target.value);
          if (!Number.isFinite(next)) return;
          onChange(Math.min(max, Math.max(min, next)));
        }}
        className="mt-1 font-(family-name:--font-geist) font-semibold tracking-tight text-2xl text-(--kwm-ink) bg-transparent border-b border-(--kwm-hl-2) focus:border-(--kwm-ink) focus:outline-none w-full max-w-[7ch] tabular-nums disabled:opacity-60"
      />
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3)">
        {hint}
      </div>
    </div>
  );
}

function Results({ result }: { result: BacktestResult }) {
  const lift = result.winRateLift;
  const liftColor =
    lift > 1.2
      ? "text-(--kwm-up)"
      : lift < 0.9
        ? "text-(--kwm-down)"
        : "text-(--kwm-ink)";

  return (
    <>
      {/* Headline numbers */}
      <section className="border-y border-(--kwm-hl) py-6 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-6 mb-12">
        <HeadlineStat
          label="Markets scanned"
          value={result.marketsScanned.toString()}
          hint={`${result.totalTrades.toLocaleString()} trades total`}
        />
        <HeadlineStat
          label="Flagged trades"
          value={result.flaggedTrades.toLocaleString()}
          hint={`${result.uniqueFlaggedWallets} unique wallets`}
        />
        <HeadlineStat
          label="Win rate lift"
          value={`${lift.toFixed(2)}×`}
          hint={`flagged ${(result.flagged.winRate * 100).toFixed(1)}% · base ${(result.baseline.winRate * 100).toFixed(1)}%`}
          valueClassName={liftColor}
        />
        <HeadlineStat
          label="Mean profit / share"
          value={
            (result.flagged.meanProfitPerShare >= 0 ? "+" : "") +
            (result.flagged.meanProfitPerShare * 100).toFixed(1) +
            "¢"
          }
          hint={`base ${(result.baseline.meanProfitPerShare * 100).toFixed(1)}¢`}
          valueClassName={
            result.flagged.meanProfitPerShare > 0
              ? "text-(--kwm-up)"
              : "text-(--kwm-down)"
          }
        />
      </section>

      {/* Per-archetype breakdown — Phase 2 */}
      {result.perArchetype && result.perArchetype.length > 0 && (
        <section className="mb-12">
          <h2 className="font-(family-name:--font-geist) font-semibold tracking-tight text-2xl text-(--kwm-ink) mb-4">
            Per-archetype
          </h2>
          <p className="text-sm text-(--kwm-ink-3) mb-4 max-w-2xl">
            Each archetype is an independent detector. The ensemble flags a
            trade if any of them fires. Per-archetype numbers show which pattern
            is actually catching edge vs. which is noise — precisely where to
            spend the next phase's effort.
          </p>
          <div className="border-y border-(--kwm-hl)">
            <div className="hidden sm:grid grid-cols-[minmax(0,1.5fr)_70px_80px_90px_80px_80px] gap-3 px-3 py-2 border-b border-(--kwm-hl) font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3)">
              <span>Archetype</span>
              <span className="text-right">Flagged</span>
              <span className="text-right">Win %</span>
              <span className="text-right">Lift vs base</span>
              <span className="text-right">P@5</span>
              <span className="text-right">P@20</span>
            </div>
            {result.perArchetype.map((a) => {
              const liftColor =
                a.winRateLift > 1.2
                  ? "text-(--kwm-up)"
                  : a.winRateLift < 0.9
                    ? "text-(--kwm-down)"
                    : "text-(--kwm-ink)";
              const p5 = a.precisionAtK.find((p) => p.k === 5);
              const p20 = a.precisionAtK.find((p) => p.k === 20);
              return (
                <div
                  key={a.archetype}
                  className="grid grid-cols-[minmax(0,1.5fr)_70px_80px_90px_80px_80px] gap-3 px-3 py-3 border-b border-(--kwm-hl) items-center text-sm"
                >
                  <span className="text-(--kwm-ink)">{a.label}</span>
                  <span className="text-right font-mono tabular-nums">
                    {a.flaggedCount}
                  </span>
                  <span className="text-right font-mono tabular-nums">
                    {a.aggregate.count > 0
                      ? `${(a.aggregate.winRate * 100).toFixed(1)}%`
                      : "—"}
                  </span>
                  <span
                    className={cn(
                      "text-right font-mono tabular-nums font-semibold",
                      a.aggregate.count > 0 && liftColor
                    )}
                  >
                    {a.aggregate.count > 0
                      ? `${a.winRateLift.toFixed(2)}×`
                      : "—"}
                  </span>
                  <span className="text-right font-mono tabular-nums text-(--kwm-ink-3)">
                    {p5 && p5.n > 0
                      ? `${(p5.precision * 100).toFixed(0)}%`
                      : "—"}
                  </span>
                  <span className="text-right font-mono tabular-nums text-(--kwm-ink-3)">
                    {p20 && p20.n > 0
                      ? `${(p20.precision * 100).toFixed(0)}%`
                      : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Precision@K */}
      <section className="mb-12">
        <h2 className="font-(family-name:--font-geist) font-semibold tracking-tight text-2xl text-(--kwm-ink) mb-4">
          Precision @ K
        </h2>
        <p className="text-sm text-(--kwm-ink-3) mb-4 max-w-xl">
          Of the top-K highest-scored flagged trades, what fraction actually won
          at resolution. This is the honest reading of "accuracy" when we have
          no human-labeled ground truth.
        </p>
        <div className="border-y border-(--kwm-hl)">
          <div className="grid grid-cols-[60px_1fr_80px] gap-3 px-3 py-2 border-b border-(--kwm-hl) font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3)">
            <span>K</span>
            <span>Precision</span>
            <span className="text-right">N</span>
          </div>
          {result.precisionAtK.map((row) => (
            <div
              key={row.k}
              className="grid grid-cols-[60px_1fr_80px] gap-3 px-3 py-3 border-b border-(--kwm-hl) items-center text-sm"
            >
              <span className="font-mono tabular-nums text-(--kwm-ink-3)">
                {row.k}
              </span>
              <div className="flex items-center gap-3">
                <span className="font-(family-name:--font-geist) font-semibold text-lg text-(--kwm-ink) tabular-nums min-w-[3.5rem]">
                  {(row.precision * 100).toFixed(1)}%
                </span>
                <div className="flex-1 h-px bg-border/60 overflow-hidden max-w-xs">
                  <div
                    className="h-full bg-(--kwm-ink)"
                    style={{ width: `${row.precision * 100}%` }}
                  />
                </div>
              </div>
              <span className="text-right font-mono tabular-nums text-(--kwm-ink-3)">
                {row.n}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Per-market breakdown */}
      <section className="mb-12">
        <h2 className="font-(family-name:--font-geist) font-semibold tracking-tight text-2xl text-(--kwm-ink) mb-4">
          Per-market
        </h2>
        <div className="border-y border-(--kwm-hl)">
          <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_90px_80px_80px_96px] gap-3 px-3 py-2 border-b border-(--kwm-hl) font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3)">
            <span>Market</span>
            <span className="text-right">Volume</span>
            <span className="text-right">Flagged</span>
            <span className="text-right">Flagged WR</span>
            <span className="text-right">Base WR</span>
          </div>
          {result.perMarket.map((m) => (
            <div
              key={m.conditionId}
              className="grid grid-cols-[minmax(0,1fr)_90px_80px_80px_96px] gap-3 px-3 py-2 border-b border-(--kwm-hl) items-center text-sm hover:bg-(--kwm-bg-2) transition-colors"
            >
              <span className="truncate text-(--kwm-ink)/85" title={m.question}>
                {m.question}
              </span>
              <span className="text-right font-mono tabular-nums text-(--kwm-ink-3)">
                {formatCurrencyCompact(m.volumeUsd)}
              </span>
              <span className="text-right font-mono tabular-nums">
                {m.flaggedTrades}
              </span>
              <span className="text-right font-mono tabular-nums">
                {m.flagged.count > 0
                  ? `${(m.flagged.winRate * 100).toFixed(0)}%`
                  : "—"}
              </span>
              <span className="text-right font-mono tabular-nums text-(--kwm-ink-3)">
                {m.baseline.count > 0
                  ? `${(m.baseline.winRate * 100).toFixed(0)}%`
                  : "—"}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Top flagged */}
      <section className="mb-12">
        <h2 className="font-(family-name:--font-geist) font-semibold tracking-tight text-2xl text-(--kwm-ink) mb-3">
          Top flagged trades
        </h2>
        <p className="text-sm text-(--kwm-ink-3) mb-4 max-w-2xl">
          Four-tier sort:{" "}
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-violet-600" />
            <span className="text-(--kwm-ink) font-medium">platinum</span>
          </span>{" "}
          (specialist + funding + shared Safe-owner, Phase 5),{" "}
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-rose-600" />
            <span className="text-(--kwm-ink) font-medium">gold</span>
          </span>{" "}
          (specialist + one stacking signal, Phase 4),{" "}
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
            <span className="text-(--kwm-ink) font-medium">silver</span>
          </span>{" "}
          (specialist or owner-cluster alone), baseline (other archetypes).
          Within each tier, trades are ordered by ensemble max score.
        </p>
        <div className="border-y border-(--kwm-hl)">
          <div className="hidden sm:grid grid-cols-[48px_130px_minmax(0,1fr)_150px_60px_72px_96px] gap-3 px-3 py-2 border-b border-(--kwm-hl) font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3)">
            <span>Score</span>
            <span>Wallet</span>
            <span>Market</span>
            <span>Archetypes</span>
            <span className="text-right">Side</span>
            <span className="text-right">USD</span>
            <span className="text-right">P&amp;L</span>
          </div>
          {result.topFlagged.map((t, i) => {
            const isWin = t.pnl.isWin;
            const isPlatinum = t.sortPriority >= 3;
            const isGold = t.sortPriority === 2;
            const isSilver = t.sortPriority === 1;
            return (
              <div
                key={`${t.wallet}-${t.tradeTimestamp}-${i}`}
                className={cn(
                  "grid grid-cols-[48px_130px_minmax(0,1fr)_150px_60px_72px_96px] gap-3 px-3 py-2 border-b border-(--kwm-hl) items-center text-sm transition-colors",
                  isPlatinum
                    ? "bg-violet-50/70 dark:bg-violet-950/25 hover:bg-violet-100/80 dark:hover:bg-violet-950/40"
                    : isGold
                      ? "bg-rose-50/60 dark:bg-rose-950/20 hover:bg-rose-100/70 dark:hover:bg-rose-950/35"
                      : isSilver
                        ? "bg-amber-50/50 dark:bg-amber-950/15 hover:bg-amber-100/60 dark:hover:bg-amber-950/25"
                        : "hover:bg-(--kwm-bg-2)"
                )}
              >
                <span className="font-mono tabular-nums font-semibold text-(--kwm-ink)">
                  {t.score}
                </span>
                <Link
                  href={`/profile/${t.wallet}`}
                  className="truncate text-(--kwm-ink)/85 hover:text-(--kwm-ink)"
                >
                  {t.walletName ??
                    `${t.wallet.slice(0, 6)}…${t.wallet.slice(-4)}`}
                </Link>
                <span
                  className="truncate text-(--kwm-ink)/85"
                  title={t.marketQuestion}
                >
                  {t.marketQuestion}
                </span>
                <span className="inline-flex items-center gap-1 flex-wrap">
                  {t.firedArchetypes.map((id) => (
                    <ArchetypeChip key={id} id={id} />
                  ))}
                </span>
                <span className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3)">
                  {t.side}
                </span>
                <span className="text-right font-mono tabular-nums text-(--kwm-ink-3)">
                  {formatCurrencyCompact(t.usdValue)}
                </span>
                <span
                  className={cn(
                    "text-right font-mono tabular-nums font-semibold",
                    isWin ? "text-(--kwm-up)" : "text-(--kwm-down)"
                  )}
                >
                  {t.pnl.profit >= 0 ? "+" : ""}
                  {formatCurrencyCompact(t.pnl.profit)}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <footer className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3) pt-6 border-t border-(--kwm-hl)">
        Generated {new Date(result.generatedAt).toLocaleString()} · runtime{" "}
        {(result.runtimeMs / 1000).toFixed(1)}s
      </footer>
    </>
  );
}

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
      ? "bg-(--kwm-ink-3)/15 text-(--kwm-ink-3)"
      : id === "size_hider"
        ? "bg-(--kwm-ink) text-(--kwm-bg)"
        : id === "category_specialist"
          ? "bg-amber-500 text-(--kwm-bg)"
          : id === "funding_cluster"
            ? "bg-rose-600 text-(--kwm-bg)"
            : id === "owner_cluster"
              ? "bg-violet-600 text-(--kwm-bg)"
              : "bg-(--kwm-panel) border border-(--kwm-ink)/60 text-(--kwm-ink)";
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 h-[18px] text-[9px] font-mono font-semibold uppercase tracking-[0.14em]",
        tone
      )}
    >
      {label}
    </span>
  );
}

function HeadlineStat({
  label,
  value,
  hint,
  valueClassName,
}: {
  label: string;
  value: string;
  hint: string;
  valueClassName?: string;
}) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3)">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-(family-name:--font-geist) font-semibold tracking-tight text-3xl sm:text-4xl text-(--kwm-ink) tabular-nums",
          valueClassName
        )}
      >
        {value}
      </div>
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-(--kwm-ink-3)">
        {hint}
      </div>
    </div>
  );
}
