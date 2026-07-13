"use client";

import Decimal from "decimal.js";
import {
  Archive,
  Loader2,
  Play,
  Plus,
  RefreshCcw,
  RotateCcw,
  Send,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Navbar } from "@/components/navbar";
import { ProductFooter } from "@/components/product-footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  DebugBlock,
  DebugRow,
  EdgeChip,
  EvidenceList,
  EvidenceUsed,
  RelatedMarkets,
  ResolutionBadge,
  SearchDiagnostics,
  VoteCorrectness,
} from "./decision-trail";
import {
  CalibrationPanel,
  LiveOrdersPanel,
  Metric,
  PositionsPanel,
  StatusPill,
} from "./panels";
import {
  completeAgentRunIntent,
  getOrCreateAgentRunIntentKeyWithLock,
} from "./run-intent-idempotency";
import type {
  AgentStatus,
  CalibrationSummary,
  LiveExecutionConfigSummary,
  LiveOrderRecordSummary,
  Metrics,
  PortfolioPnl,
  PositionSummary,
  RunDetail,
  RunSummary,
  WatchlistItem,
} from "./types";

const emptyForm = {
  polymarketUrl: "",
  question: "",
  tokenId: "",
  conditionId: "",
  marketSlug: "",
  outcomeLabel: "",
  eventStartTime: "",
  eventEndTime: "",
  resolutionSource: "",
  newsUrls: "",
  socialNotes: "",
};

export function AgentDashboardClient() {
  const [token, setToken] = useState("");
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [selectedRun, setSelectedRun] = useState<RunDetail | null>(null);
  const [calibration, setCalibration] = useState<CalibrationSummary | null>(
    null
  );
  const [positions, setPositions] = useState<PositionSummary[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioPnl | null>(null);
  const [liveOrders, setLiveOrders] = useState<LiveOrderRecordSummary[]>([]);
  const [liveConfig, setLiveConfig] =
    useState<LiveExecutionConfigSummary | null>(null);
  const [refreshingResolutions, setRefreshingResolutions] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [runningItemId, setRunningItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const headers = useMemo(() => {
    const result: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token.trim()) result["x-knoww-agent-token"] = token.trim();
    return result;
  }, [token]);

  const api = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T> => {
      const response = await fetch(path, {
        ...init,
        headers: {
          ...headers,
          ...(init?.headers ?? {}),
        },
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      return body as T;
    },
    [headers]
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        watchlistBody,
        runsBody,
        metricsBody,
        statusBody,
        calibrationBody,
        positionsBody,
        liveOrdersBody,
      ] = await Promise.all([
        api<{ items: WatchlistItem[] }>("/api/agent/watchlist"),
        api<{ runs: RunSummary[] }>("/api/agent/runs"),
        api<{ metrics: Metrics }>("/api/agent/metrics"),
        api<{ status: AgentStatus }>("/api/agent/status"),
        api<{ calibration: CalibrationSummary }>("/api/agent/calibration"),
        api<{ positions: PositionSummary[]; pnl: PortfolioPnl }>(
          "/api/agent/positions"
        ),
        api<{
          orders: LiveOrderRecordSummary[];
          config: LiveExecutionConfigSummary;
        }>("/api/agent/live-orders"),
      ]);
      setWatchlist(watchlistBody.items);
      setRuns(runsBody.runs);
      setMetrics(metricsBody.metrics);
      setStatus(statusBody.status);
      setCalibration(calibrationBody.calibration);
      setPositions(positionsBody.positions);
      setPortfolio(positionsBody.pnl);
      setLiveOrders(liveOrdersBody.orders);
      setLiveConfig(liveOrdersBody.config);
      if (!selectedRun && runsBody.runs[0]) {
        const detail = await api<{ run: RunDetail }>(
          `/api/agent/runs/${runsBody.runs[0].id}`
        );
        setSelectedRun(detail.run);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh");
    } finally {
      setLoading(false);
    }
  }, [api, selectedRun]);

  const refreshResolutions = useCallback(async () => {
    setRefreshingResolutions(true);
    setError(null);
    try {
      await api<{ checked: number; resolved: number }>(
        "/api/agent/resolutions",
        { method: "POST" }
      );
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to refresh resolutions"
      );
    } finally {
      setRefreshingResolutions(false);
    }
  }, [api, refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const saveWatchlistItem = useCallback(async () => {
    setError(null);
    try {
      await api("/api/agent/watchlist", {
        method: "POST",
        body: JSON.stringify({
          question: form.question || undefined,
          tokenId: form.tokenId || undefined,
          polymarketUrl: form.polymarketUrl || undefined,
          conditionId: form.conditionId || undefined,
          marketSlug: form.marketSlug || undefined,
          outcomeLabel: form.outcomeLabel || undefined,
          eventStartTime: form.eventStartTime || undefined,
          eventEndTime: form.eventEndTime || undefined,
          resolutionSource: form.resolutionSource || undefined,
          newsUrls: form.newsUrls
            .split(/\s+/)
            .map((url) => url.trim())
            .filter(Boolean),
          socialNotes: form.socialNotes
            .split("\n")
            .map((note) => note.trim())
            .filter(Boolean),
          active: true,
        }),
      });
      setForm(emptyForm);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save item");
    }
  }, [api, form, refresh]);

  const runAgent = useCallback(
    async (watchlistItemId?: string) => {
      const intent = watchlistItemId ?? "all";
      const idempotencyKey = await getOrCreateAgentRunIntentKeyWithLock(
        window.localStorage,
        intent,
        navigator.locks,
        undefined,
        window.sessionStorage
      );
      setRunning(true);
      setRunningItemId(watchlistItemId ?? null);
      setError(null);
      try {
        const body = await api<{ run: RunDetail }>("/api/agent/runs", {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: JSON.stringify(
            watchlistItemId ? { watchlistItemIds: [watchlistItemId] } : {}
          ),
        });
        completeAgentRunIntent(
          window.localStorage,
          intent,
          idempotencyKey,
          window.sessionStorage
        );
        setSelectedRun(body.run);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to run agent");
      } finally {
        setRunning(false);
        setRunningItemId(null);
      }
    },
    [api, refresh]
  );

  const setWatchlistActive = useCallback(
    async (item: WatchlistItem, active: boolean) => {
      setError(null);
      try {
        await api("/api/agent/watchlist", {
          method: "POST",
          body: JSON.stringify({
            id: item.id,
            question: item.question,
            tokenId: item.tokenId,
            conditionId: item.conditionId,
            marketSlug: item.marketSlug,
            outcomeLabel: item.outcomeLabel,
            eventStartTime: item.eventStartTime,
            eventEndTime: item.eventEndTime,
            resolutionSource: item.resolutionSource,
            newsUrls: item.newsUrls,
            socialNotes: item.socialNotes,
            active,
          }),
        });
        await refresh();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to update watchlist item"
        );
      }
    },
    [api, refresh]
  );

  const selectRun = useCallback(
    async (id: string) => {
      setError(null);
      try {
        const body = await api<{ run: RunDetail }>(`/api/agent/runs/${id}`);
        setSelectedRun(body.run);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load run");
      }
    },
    [api]
  );

  return (
    <div className="kw-app min-h-screen bg-(--kwm-bg) text-(--kwm-ink) selection:bg-(--kwm-ink)/15">
      <Navbar />
      <main className="px-3 sm:px-4 md:px-6 lg:px-8 pt-4 sm:pt-6 pb-40 xl:pb-8 max-w-7xl mx-auto">
        <header
          className="mb-6 pb-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between border-b"
          style={{ borderColor: "var(--kwm-hl)" }}
        >
          <div>
            <div
              className="font-mono text-[10px] uppercase tracking-[0.14em] mb-2"
              style={{ color: "var(--kwm-ink-3)" }}
            >
              Knoww › Agent
            </div>
            <h1
              className="text-[15px] font-semibold tracking-tight"
              style={{ color: "var(--kwm-ink)" }}
            >
              Paper Agent
            </h1>
            <p
              className="mt-1 text-[12px] leading-snug max-w-2xl"
              style={{ color: "var(--kwm-ink-3)" }}
            >
              Manual paper runs with a 3-model quorum, deterministic risk gates,
              and an auditable simulated ledger.
            </p>
          </div>
          <form
            className="flex flex-col sm:flex-row gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              runAgent();
            }}
          >
            <label className="sr-only" htmlFor="agent-admin-token">
              Admin token
            </label>
            <input
              aria-hidden="true"
              autoComplete="username"
              className="hidden"
              name="username"
              readOnly
              tabIndex={-1}
              type="text"
              value="agent-admin"
            />
            <Input
              id="agent-admin-token"
              name="agentAdminToken"
              type="password"
              autoComplete="new-password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Admin token"
              className="w-full sm:w-64"
            />
            <Button type="button" variant="outline" onClick={refresh}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="h-4 w-4" />
              )}
              Refresh
            </Button>
            <Button type="submit" disabled={running}>
              {running ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Run
            </Button>
          </form>
        </header>

        {error && (
          <div className="mb-6 border border-(--kwm-down)/40 bg-(--kwm-down-soft) px-4 py-3 text-sm text-(--kwm-down)">
            {error}
          </div>
        )}

        {status && (
          <section className="mb-6 border-y border-(--kwm-hl-2) py-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="font-mono text-xs uppercase tracking-[0.14em]">
                  Agent Status
                </h2>
                <p className="mt-2 text-sm text-(--kwm-ink-3)">
                  {status?.llm?.ready
                    ? "LLM panel is configured for paper runs."
                    : `Missing ${status.llm.missing.join(", ")}. Runs will default to HOLD.`}
                </p>
              </div>
              <div className="grid gap-2 text-xs sm:grid-cols-3 md:min-w-80">
                <StatusPill
                  label="LLM panel"
                  ready={status?.llm?.ready}
                  value={status?.llm?.provider}
                />
                <StatusPill
                  label="Admin token"
                  ready={status?.admin?.configured}
                  value={status?.admin?.configured ? "configured" : "dev open"}
                />
                <StatusPill
                  label="Search"
                  ready={status?.search?.enabled}
                  value={status?.search?.mode}
                />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {status.llm.models.map((model) => (
                <span
                  className="border border-(--kwm-hl-2) px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3)"
                  key={model}
                >
                  {model}
                </span>
              ))}
              {status.search.providers.map((provider) => (
                <span
                  className="border border-(--kwm-hl-2) px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3)"
                  key={provider.provider}
                >
                  {provider?.provider}:{" "}
                  {provider?.ready
                    ? "ready"
                    : `missing ${provider?.missing.join(", ")}`}
                </span>
              ))}
            </div>
          </section>
        )}

        <section className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
          <Metric label="Runs" value={metrics?.runCount ?? 0} />
          <Metric label="Trades" value={metrics?.tradeCount ?? 0} />
          <Metric label="Holds" value={metrics?.holdCount ?? 0} />
          <Metric label="Blocked" value={metrics?.blockedCount ?? 0} />
          <Metric
            label="Notional"
            value={`$${new Decimal(metrics?.notionalUsd ?? 0).toFixed(2)}`}
          />
        </section>

        <CalibrationPanel
          calibration={calibration}
          refreshing={refreshingResolutions}
          onRefresh={refreshResolutions}
        />

        <PositionsPanel
          positions={positions}
          portfolio={portfolio}
          watchlist={watchlist}
        />

        <LiveOrdersPanel
          orders={liveOrders}
          config={liveConfig}
          watchlist={watchlist}
        />

        <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-8">
          <section className="space-y-6">
            <div className="border-y border-(--kwm-hl-2) py-4">
              <h2 className="font-mono text-xs uppercase tracking-[0.14em] mb-4">
                Watchlist
              </h2>
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveWatchlistItem();
                }}
              >
                <label className="sr-only" htmlFor="agent-polymarket-url">
                  Polymarket event URL
                </label>
                <Input
                  id="agent-polymarket-url"
                  name="polymarketUrl"
                  autoComplete="off"
                  value={form.polymarketUrl}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      polymarketUrl: event.target.value,
                    }))
                  }
                  placeholder="Polymarket event URL"
                />
                <label className="sr-only" htmlFor="agent-market-question">
                  Market question
                </label>
                <Input
                  id="agent-market-question"
                  name="question"
                  autoComplete="off"
                  value={form.question}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      question: event.target.value,
                    }))
                  }
                  placeholder="Market question"
                />
                <label className="sr-only" htmlFor="agent-token-id">
                  CLOB token id
                </label>
                <Input
                  id="agent-token-id"
                  name="tokenId"
                  autoComplete="off"
                  value={form.tokenId}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      tokenId: event.target.value,
                    }))
                  }
                  placeholder="CLOB token id"
                />
                <label className="sr-only" htmlFor="agent-condition-id">
                  Condition id
                </label>
                <Input
                  id="agent-condition-id"
                  name="conditionId"
                  autoComplete="off"
                  value={form.conditionId}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      conditionId: event.target.value,
                    }))
                  }
                  placeholder="Condition id"
                />
                <label className="sr-only" htmlFor="agent-market-slug">
                  Market slug
                </label>
                <Input
                  id="agent-market-slug"
                  name="marketSlug"
                  autoComplete="off"
                  value={form.marketSlug}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      marketSlug: event.target.value,
                    }))
                  }
                  placeholder="Market slug"
                />
                <label className="sr-only" htmlFor="agent-outcome-label">
                  Outcome label
                </label>
                <Input
                  id="agent-outcome-label"
                  name="outcomeLabel"
                  autoComplete="off"
                  value={form.outcomeLabel}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      outcomeLabel: event.target.value,
                    }))
                  }
                  placeholder="Outcome label"
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="sr-only" htmlFor="agent-event-start-time">
                      Event start time
                    </label>
                    <Input
                      id="agent-event-start-time"
                      name="eventStartTime"
                      autoComplete="off"
                      value={form.eventStartTime}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          eventStartTime: event.target.value,
                        }))
                      }
                      placeholder="Start time ISO"
                    />
                  </div>
                  <div>
                    <label className="sr-only" htmlFor="agent-event-end-time">
                      Event end time
                    </label>
                    <Input
                      id="agent-event-end-time"
                      name="eventEndTime"
                      autoComplete="off"
                      value={form.eventEndTime}
                      onChange={(event) =>
                        setForm((prev) => ({
                          ...prev,
                          eventEndTime: event.target.value,
                        }))
                      }
                      placeholder="End time ISO"
                    />
                  </div>
                </div>
                <label className="sr-only" htmlFor="agent-resolution-source">
                  Resolution source
                </label>
                <Input
                  id="agent-resolution-source"
                  name="resolutionSource"
                  autoComplete="off"
                  value={form.resolutionSource}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      resolutionSource: event.target.value,
                    }))
                  }
                  placeholder="Resolution source URL"
                />
                <label className="sr-only" htmlFor="agent-news-urls">
                  News URLs
                </label>
                <Textarea
                  id="agent-news-urls"
                  name="newsUrls"
                  value={form.newsUrls}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      newsUrls: event.target.value,
                    }))
                  }
                  placeholder="News URLs"
                  rows={3}
                />
                <label className="sr-only" htmlFor="agent-social-notes">
                  Social notes
                </label>
                <Textarea
                  id="agent-social-notes"
                  name="socialNotes"
                  value={form.socialNotes}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      socialNotes: event.target.value,
                    }))
                  }
                  placeholder="Social notes"
                  rows={3}
                />
                <Button type="submit">
                  <Plus className="h-4 w-4" />
                  {form.polymarketUrl.trim() ? "Import" : "Add"}
                </Button>
              </form>
            </div>

            <div className="space-y-2">
              {watchlist.map((item) => (
                <div
                  key={item.id}
                  className="border-b border-(--kwm-hl-2) py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{item.question}</div>
                      <div className="mt-1 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3)">
                        <span
                          className={
                            item.active
                              ? "text-(--kwm-up)"
                              : "text-(--kwm-ink-3)"
                          }
                        >
                          {item.active ? "Active" : "Archived"}
                        </span>
                        {item.outcomeLabel && <span>{item.outcomeLabel}</span>}
                        {item.marketType && <span>{item.marketType}</span>}
                        {item.eventType === "multi_market" && (
                          <span>
                            {item.eventMarketCount ?? "multi"} markets
                          </span>
                        )}
                        {item.eventEndTime && (
                          <span>
                            Ends {new Date(item.eventEndTime).toLocaleString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={!item.active || running}
                        onClick={() => runAgent(item.id)}
                      >
                        {runningItemId === item.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Play className="h-4 w-4" />
                        )}
                        Run
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={running}
                        onClick={() => setWatchlistActive(item, !item.active)}
                      >
                        {item.active ? (
                          <Archive className="h-4 w-4" />
                        ) : (
                          <RotateCcw className="h-4 w-4" />
                        )}
                        {item.active ? "Archive" : "Activate"}
                      </Button>
                    </div>
                  </div>
                  <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3) break-all">
                    {item.tokenId}
                  </div>
                </div>
              ))}
              {watchlist.length === 0 && (
                <div className="py-8 text-sm text-(--kwm-ink-3)">
                  No watchlist items.
                </div>
              )}
            </div>
          </section>

          <section className="space-y-8">
            <div>
              <h2 className="font-mono text-xs uppercase tracking-[0.14em] mb-3">
                Runs
              </h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Started</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead>Trades</TableHead>
                    <TableHead>Blocked</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow
                      key={run.id}
                      className="cursor-pointer"
                      onClick={() => selectRun(run.id)}
                    >
                      <TableCell>
                        {new Date(run.startedAt).toLocaleString()}
                      </TableCell>
                      <TableCell>{run.status}</TableCell>
                      <TableCell>{run.itemCount}</TableCell>
                      <TableCell>{run.tradeCount}</TableCell>
                      <TableCell>{run.blockedCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {selectedRun && (
              <div>
                <h2 className="font-mono text-xs uppercase tracking-[0.14em] mb-3">
                  Decision Trail
                </h2>
                <div className="space-y-5">
                  {selectedRun.items.map((item) => (
                    <article
                      key={`${selectedRun.id}-${item.watchlistItem.id}`}
                      className="border-y border-(--kwm-hl-2) py-4"
                    >
                      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <div>
                          <h3 className="font-medium">
                            {item.watchlistItem.question}
                          </h3>
                          <div className="mt-1 text-xs text-(--kwm-ink-3)">
                            Price {item.evidence.market.price} · Liquidity $
                            {item.evidence.market.liquidityUsd} ·{" "}
                            {item.evidence.market.marketType ?? "unknown"} ·{" "}
                            {item.evidence.market.eventType === "multi_market"
                              ? `${item.evidence.market.eventMarketCount ?? "multi"} markets · `
                              : ""}
                            {item.evidence.market.outcomeLabel
                              ? `Tracking ${item.evidence.market.outcomeLabel} · `
                              : ""}
                            {item.evidence.market.stale ? "Stale" : "Fresh"}
                            {item.evidence.market.eventEndTime
                              ? ` · Ends ${new Date(item.evidence.market.eventEndTime).toLocaleString()}`
                              : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {item.resolution && (
                            <ResolutionBadge resolution={item.resolution} />
                          )}
                          <div className="font-mono text-xs uppercase tracking-[0.14em]">
                            {item.decision.action}
                          </div>
                        </div>
                      </div>
                      <p className="mt-3 text-sm text-(--kwm-ink-3)">
                        {item.decision.reason}
                      </p>
                      <RelatedMarkets
                        markets={item.evidence.relatedMarkets ?? []}
                      />
                      <EvidenceUsed
                        news={item.evidence.news}
                        search={item.evidence.search ?? []}
                        social={item.evidence.social}
                      />
                      <SearchDiagnostics
                        diagnostics={item.evidence.searchDiagnostics}
                        search={item.evidence.search ?? []}
                      />
                      <div className="mt-4 grid gap-3 md:grid-cols-3">
                        {item.votes.length === 0 && (
                          <div className="border border-(--kwm-hl-2) p-3 text-xs text-(--kwm-ink-3) md:col-span-3">
                            No model votes were requested for this item.
                          </div>
                        )}
                        {item.votes.map((vote) => (
                          <div
                            key={vote.provider}
                            className="border border-(--kwm-hl-2) p-3"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-1.5 min-w-0">
                                {item.resolution && (
                                  <VoteCorrectness
                                    fairProbability={vote.fairProbability}
                                    outcomeYes={item.resolution.outcomeYes}
                                  />
                                )}
                                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3) truncate">
                                  {vote.provider}
                                </div>
                              </div>
                              {typeof vote.edgePct === "number" && (
                                <EdgeChip pct={vote.edgePct} />
                              )}
                            </div>
                            <div className="mt-2 text-sm font-medium">
                              {vote.action} ·{" "}
                              {(vote.confidence * 100).toFixed(0)}%
                              {typeof vote.fairProbability === "number" &&
                                typeof vote.marketImpliedProbability ===
                                  "number" && (
                                  <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.12em] text-(--kwm-ink-3)">
                                    fair{" "}
                                    {(vote.fairProbability * 100).toFixed(0)}%
                                    {" vs "}mkt{" "}
                                    {(
                                      vote.marketImpliedProbability * 100
                                    ).toFixed(0)}
                                    %
                                  </span>
                                )}
                            </div>
                            {vote.resolutionView && (
                              <blockquote className="mt-2 border-l-2 border-(--kwm-hl-2) pl-2 text-[11px] italic text-(--kwm-ink-3)">
                                {vote.resolutionView}
                              </blockquote>
                            )}
                            <EvidenceList
                              label="For"
                              items={vote.evidenceFor}
                              tone="positive"
                            />
                            <EvidenceList
                              label="Against"
                              items={vote.evidenceAgainst}
                              tone="negative"
                            />
                            <EvidenceList
                              label="Missing"
                              items={vote.missingEvidence}
                              tone="missing"
                            />
                            <p className="mt-2 text-xs text-(--kwm-ink-3) line-clamp-4">
                              {vote.reasoning}
                            </p>
                            {vote.debug && vote.debug.status !== "ok" && (
                              <details className="mt-3 border-t border-(--kwm-hl-2) pt-2 text-xs text-(--kwm-ink-3)">
                                <summary className="cursor-pointer font-mono uppercase tracking-widest">
                                  Debug {vote.debug.status}
                                </summary>
                                <dl className="mt-2 space-y-1">
                                  <DebugRow
                                    label="duration"
                                    value={`${vote.debug.durationMs}ms`}
                                  />
                                  {vote.debug.finishReason && (
                                    <DebugRow
                                      label="finish"
                                      value={vote.debug.finishReason}
                                    />
                                  )}
                                  {typeof vote.debug.rawTextLength ===
                                    "number" && (
                                    <DebugRow
                                      label="length"
                                      value={String(vote.debug.rawTextLength)}
                                    />
                                  )}
                                  {vote.debug.errorName && (
                                    <DebugRow
                                      label="error"
                                      value={vote.debug.errorName}
                                    />
                                  )}
                                  {vote.debug.errorMessage && (
                                    <DebugBlock
                                      label="message"
                                      value={vote.debug.errorMessage}
                                    />
                                  )}
                                  {vote.debug.validationIssues &&
                                    vote.debug.validationIssues.length > 0 && (
                                      <DebugBlock
                                        label="issues"
                                        value={vote.debug.validationIssues.join(
                                          " | "
                                        )}
                                      />
                                    )}
                                  {vote.debug.rawTextPreview && (
                                    <DebugBlock
                                      label="preview"
                                      value={vote.debug.rawTextPreview}
                                    />
                                  )}
                                </dl>
                              </details>
                            )}
                          </div>
                        ))}
                      </div>
                      {item.fill && (
                        <div className="mt-4 text-sm">
                          Fill: {item.fill.status} {item.fill.side} $
                          {item.fill.notionalUsd} for {item.fill.shares} shares
                          {item.fill.reason ? ` · ${item.fill.reason}` : ""}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
      <ProductFooter context="Agent" />
    </div>
  );
}
