"use client";

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

interface WatchlistItem {
  id: string;
  question: string;
  tokenId: string;
  conditionId?: string;
  marketSlug?: string;
  outcomeLabel?: string;
  marketType?: "binary" | "multi_outcome" | "unknown";
  eventType?: "single_market" | "multi_market" | "unknown";
  outcomes?: string[];
  oppositeOutcomeLabel?: string;
  oppositeTokenId?: string;
  eventMarketCount?: number;
  eventStartTime?: string;
  eventEndTime?: string;
  resolutionSource?: string;
  side?: "YES" | "NO";
  newsUrls: string[];
  socialNotes: string[];
  active: boolean;
}

interface RunSummary {
  id: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  itemCount: number;
  tradeCount: number;
  blockedCount: number;
}

interface RunDetail extends RunSummary {
  items: Array<{
    watchlistItem: WatchlistItem;
    evidence: {
      market: {
        price: string;
        liquidityUsd: string;
        stale: boolean;
        outcomeLabel?: string;
        marketType?: "binary" | "multi_outcome" | "unknown";
        eventType?: "single_market" | "multi_market" | "unknown";
        outcomes?: string[];
        oppositeOutcomeLabel?: string;
        oppositeTokenId?: string;
        eventMarketCount?: number;
        eventStartTime?: string;
        eventEndTime?: string;
        resolutionSource?: string;
      };
      news: Array<{ url: string; title: string }>;
      relatedMarkets?: Array<{
        question: string;
        tokenId: string;
        outcomeLabel: string;
        marketType: "binary" | "multi_outcome" | "unknown";
        eventType: "single_market" | "multi_market" | "unknown";
        eventEndTime?: string;
        price: string | null;
        active: boolean;
        selected: boolean;
      }>;
      search?: Array<{
        provider: "tavily" | "exa" | "firecrawl";
        kind: "news" | "resolution" | "social" | "web";
        query: string;
        url: string;
        title: string;
        excerpt: string;
        publishedAt: string | null;
        score: number | null;
      }>;
      searchDiagnostics?: {
        enabled: boolean;
        mode: "native" | "direct" | "both";
        query: string | null;
        maxResults: number;
        timeoutMs: number;
        providers: Array<{
          provider: "tavily" | "exa" | "firecrawl";
          ready: boolean;
          status: "ok" | "missing-key" | "failed" | "skipped";
          durationMs: number;
          resultCount: number;
          errorMessage?: string;
        }>;
      };
      social: Array<{
        text: string;
        source?:
          | "watchlist-note"
          | "polymarket-rule"
          | "polymarket-description";
      }>;
    };
    votes: Array<{
      provider: string;
      action: string;
      confidence: number;
      fairProbability: number;
      reasoning: string;
      riskFlags: string[];
      resolutionView?: string;
      marketImpliedProbability?: number;
      edgePct?: number;
      evidenceFor?: string[];
      evidenceAgainst?: string[];
      missingEvidence?: string[];
      debug?: {
        status: string;
        durationMs: number;
        rawTextLength?: number;
        rawTextPreview?: string;
        finishReason?: string;
        errorName?: string;
        errorMessage?: string;
        validationIssues?: string[];
      };
    }>;
    decision: {
      action: string;
      approved: boolean;
      confidence: number;
      reason: string;
      riskFlags: string[];
    };
    fill: {
      status: string;
      side: string;
      notionalUsd: string;
      shares: string;
      reason?: string;
    } | null;
    resolution: {
      tokenId: string;
      outcomeYes: 0 | 1;
      settlementPrice: string;
      resolvedAt: string;
    } | null;
  }>;
}

interface Metrics {
  runCount: number;
  tradeCount: number;
  holdCount: number;
  blockedCount: number;
  notionalUsd: string;
}

interface CalibrationModelStat {
  provider: string;
  brierMean: number;
  count: number;
}

interface CalibrationSummary {
  models: CalibrationModelStat[];
  resolvedVoteCount: number;
}

interface PortfolioPnl {
  openPositionCount: number;
  closedPositionCount: number;
  realizedPnlUsd: string;
  openEntryNotionalUsd: string;
}

interface LiveOrderRecordSummary {
  idempotencyKey: string;
  runId: string;
  watchlistItemId: string;
  tokenId: string;
  side: "BUY" | "SELL" | "HOLD";
  requestedSizeUsd: string;
  price: string;
  signedOrderHash: string | null;
  orderId: string | null;
  status:
    | "DRY_RUN"
    | "POSTED"
    | "OPEN"
    | "PARTIALLY_FILLED"
    | "FILLED"
    | "CANCELED"
    | "FAILED";
  submittedAt: string | null;
  filledAt: string | null;
  createdAt: string;
  filledNotionalUsd: string;
  filledShares: string;
  averageFillPrice: string | null;
  lastSyncedAt: string | null;
  balanceSnapshotJson: string | null;
  dryRun: boolean;
  error: string | null;
}

interface LiveExecutionConfigSummary {
  enabled: boolean;
  dryRun: boolean;
  confirmedReal: boolean;
  hasWalletKey: boolean;
  hasCredentialEncryptionKey?: boolean;
  emergencyStop?: boolean;
  dailyOrderCap?: string | null;
  dailyNotionalCap?: string | null;
  maxLiveNotionalUsd: string;
  clobHost: string;
  chainId: number;
}

interface PositionSummary {
  id: string;
  watchlistItemId: string;
  tokenId: string;
  side: "BUY";
  status: "OPEN" | "CLOSED";
  entryPrice: string;
  shares: string;
  entryNotionalUsd: string;
  exitPrice: string | null;
  exitNotionalUsd: string | null;
  realizedPnlUsd: string | null;
  openedAt: string;
  closedAt: string | null;
  closeReason: "contradict-vote" | "time-exit" | "resolution" | "manual" | null;
}

interface AgentStatus {
  llm: {
    provider: string;
    models: string[];
    ready: boolean;
    missing: string[];
  };
  search: {
    enabled: boolean;
    mode: "native" | "direct" | "both";
    providers: Array<{
      provider: "tavily" | "exa" | "firecrawl";
      ready: boolean;
      missing: string[];
    }>;
  };
  admin: {
    configured: boolean;
  };
}

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
      setRunning(true);
      setRunningItemId(watchlistItemId ?? null);
      setError(null);
      try {
        const body = await api<{ run: RunDetail }>("/api/agent/runs", {
          method: "POST",
          body: JSON.stringify(
            watchlistItemId ? { watchlistItemIds: [watchlistItemId] } : {}
          ),
        });
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
    <div className="kw-app min-h-screen">
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
          <div className="mb-6 border border-red-600/40 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-900 dark:text-red-100">
            {error}
          </div>
        )}

        {status && (
          <section className="mb-6 border-y border-border/60 py-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="font-mono text-xs uppercase tracking-[0.14em]">
                  Agent Status
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
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
                  className="border border-border/60 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
                  key={model}
                >
                  {model}
                </span>
              ))}
              {status.search.providers.map((provider) => (
                <span
                  className="border border-border/60 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
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
          <Metric label="Notional" value={`$${metrics?.notionalUsd ?? "0"}`} />
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
            <div className="border-y border-border/60 py-4">
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
                <div key={item.id} className="border-b border-border/60 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{item.question}</div>
                      <div className="mt-1 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        <span
                          className={
                            item.active
                              ? "text-emerald-700"
                              : "text-muted-foreground"
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
                  <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground break-all">
                    {item.tokenId}
                  </div>
                </div>
              ))}
              {watchlist.length === 0 && (
                <div className="py-8 text-sm text-muted-foreground">
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
                      className="border-y border-border/60 py-4"
                    >
                      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <div>
                          <h3 className="font-medium">
                            {item.watchlistItem.question}
                          </h3>
                          <div className="mt-1 text-xs text-muted-foreground">
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
                      <p className="mt-3 text-sm text-muted-foreground">
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
                          <div className="border border-border/60 p-3 text-xs text-muted-foreground md:col-span-3">
                            No model votes were requested for this item.
                          </div>
                        )}
                        {item.votes.map((vote) => (
                          <div
                            key={vote.provider}
                            className="border border-border/60 p-3"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-1.5 min-w-0">
                                {item.resolution && (
                                  <VoteCorrectness
                                    fairProbability={vote.fairProbability}
                                    outcomeYes={item.resolution.outcomeYes}
                                  />
                                )}
                                <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground truncate">
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
                                  <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
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
                              <blockquote className="mt-2 border-l-2 border-border/60 pl-2 text-[11px] italic text-muted-foreground">
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
                            <p className="mt-2 text-xs text-muted-foreground line-clamp-4">
                              {vote.reasoning}
                            </p>
                            {vote.debug && vote.debug.status !== "ok" && (
                              <details className="mt-3 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                                <summary className="cursor-pointer font-mono uppercase tracking-[0.1em]">
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

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border-y border-border/60 py-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-editorial italic text-2xl">{value}</div>
    </div>
  );
}

function LiveOrdersPanel({
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
    ? "border-border/60 text-muted-foreground"
    : config.dryRun
      ? "border-amber-600/70 text-amber-700 dark:text-amber-400"
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
    <section className="border-y border-border/60 py-4 mb-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-mono text-xs uppercase tracking-[0.14em]">
            Live Orders
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
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
              <span className="font-mono uppercase tracking-[0.12em] px-2 py-1 border border-amber-600/70 text-amber-700 dark:text-amber-400">
                CREDS NOT CACHED
              </span>
            )}
          <span className="text-muted-foreground">
            cap{" "}
            <span className="font-mono text-foreground">
              ${config.maxLiveNotionalUsd}
            </span>
          </span>
          {(config.dailyOrderCap || config.dailyNotionalCap) && (
            <span className="text-muted-foreground">
              daily{" "}
              <span className="font-mono text-foreground">
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
        <p className="mt-3 text-xs text-muted-foreground">
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
    <div className="border border-border/60 px-2 py-1">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="font-editorial italic text-lg">{value}</div>
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
      ? "border-emerald-600/70 text-emerald-700 dark:text-emerald-400"
      : order.status === "PARTIALLY_FILLED"
        ? "border-teal-600/70 text-teal-700 dark:text-teal-400"
        : order.status === "FAILED" || order.status === "CANCELED"
          ? "border-rose-600/70 text-rose-700 dark:text-rose-400"
          : order.status === "POSTED" || order.status === "OPEN"
            ? "border-sky-600/70 text-sky-700 dark:text-sky-400"
            : "border-amber-600/70 text-amber-700 dark:text-amber-400";
  return (
    <details className="border border-border/60 px-3 py-2">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-xs">
        <span
          className={`font-mono uppercase tracking-[0.12em] px-2 py-0.5 border ${statusClass}`}
        >
          {order.status}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          {order.side}
        </span>
        <span className="font-medium line-clamp-1">{question}</span>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          ${order.requestedSizeUsd} @ {order.price}
        </span>
      </summary>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <dt>Idempotency key</dt>
        <dd className="font-mono text-foreground break-all">
          {order.idempotencyKey}
        </dd>
        <dt>Created</dt>
        <dd className="font-mono text-foreground">
          {new Date(order.createdAt).toLocaleString()}
        </dd>
        <dt>Filled</dt>
        <dd className="font-mono text-foreground">
          ${order.filledNotionalUsd} / {order.filledShares} shares
        </dd>
        {order.averageFillPrice && (
          <>
            <dt>Avg fill</dt>
            <dd className="font-mono text-foreground">
              {order.averageFillPrice}
            </dd>
          </>
        )}
        {order.lastSyncedAt && (
          <>
            <dt>Last sync</dt>
            <dd className="font-mono text-foreground">
              {new Date(order.lastSyncedAt).toLocaleString()}
            </dd>
          </>
        )}
        {order.orderId && (
          <>
            <dt>Order ID</dt>
            <dd className="font-mono text-foreground break-all">
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
        <div className="mt-2 border-t border-border/60 pt-2 font-mono text-[10px] text-muted-foreground">
          <span className="font-sans">signed-order sha256:</span>{" "}
          <span className="break-all">{order.signedOrderHash}</span>
        </div>
      )}
    </details>
  );
}

function PositionsPanel({
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
      ? "text-emerald-700 dark:text-emerald-400"
      : realized < 0
        ? "text-rose-700 dark:text-rose-400"
        : "text-foreground";
  return (
    <section className="border-y border-border/60 py-4 mb-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="font-mono text-xs uppercase tracking-[0.14em]">
            Positions
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Lifecycle state per market · close on contradicting vote, time-exit,
            or resolution
          </p>
        </div>
        <div className="flex gap-4 text-xs">
          <span>
            <span className="font-mono uppercase tracking-[0.12em] text-muted-foreground">
              Open
            </span>{" "}
            <span className="font-editorial italic text-lg">{open.length}</span>
          </span>
          <span>
            <span className="font-mono uppercase tracking-[0.12em] text-muted-foreground">
              Closed
            </span>{" "}
            <span className="font-editorial italic text-lg">
              {closed.length}
            </span>
          </span>
          <span>
            <span className="font-mono uppercase tracking-[0.12em] text-muted-foreground">
              Realized P&amp;L
            </span>{" "}
            <span className={`font-editorial italic text-lg ${realizedClass}`}>
              {realized < 0 ? "-" : ""}${Math.abs(realized).toFixed(2)}
            </span>
          </span>
        </div>
      </div>
      {positions.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
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
      ? "text-muted-foreground"
      : realized > 0
        ? "text-emerald-700 dark:text-emerald-400"
        : realized < 0
          ? "text-rose-700 dark:text-rose-400"
          : "text-foreground";
  return (
    <div className="border border-border/60 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-sm line-clamp-2">{question}</div>
        <span
          className={`font-mono text-[10px] uppercase tracking-[0.12em] px-2 py-0.5 border ${
            position.status === "OPEN"
              ? "border-amber-600/70 text-amber-700 dark:text-amber-400"
              : "border-border/60 text-muted-foreground"
          }`}
        >
          {position.status}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <dt>Entry</dt>
        <dd className="text-right font-mono text-foreground">
          {position.shares} @ {position.entryPrice}
        </dd>
        <dt>Notional</dt>
        <dd className="text-right font-mono text-foreground">
          ${position.entryNotionalUsd}
        </dd>
        {position.status === "CLOSED" && (
          <>
            <dt>Exit</dt>
            <dd className="text-right font-mono text-foreground">
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

function CalibrationPanel({
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
    <section className="border-y border-border/60 py-4 mb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-mono text-xs uppercase tracking-[0.14em]">
            Calibration
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
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
        <p className="mt-3 text-xs text-muted-foreground">
          No resolved markets yet. Once watchlist items pass their end time,
          click Refresh resolutions to fetch outcomes from Polymarket.
        </p>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 md:grid-cols-3">
          {models.map((model) => (
            <div
              key={model.provider}
              className="border border-border/60 px-3 py-2"
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground truncate">
                {model.provider}
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-2">
                <span className="font-editorial italic text-xl">
                  {model.brierMean.toFixed(3)}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
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

function EvidenceUsed({
  news,
  search,
  social,
}: {
  news: Array<{ url: string; title: string }>;
  search: Array<{
    provider: "tavily" | "exa" | "firecrawl";
    kind: "news" | "resolution" | "social" | "web";
    query: string;
    url: string;
    title: string;
    excerpt: string;
    publishedAt: string | null;
    score: number | null;
  }>;
  social: Array<{
    text: string;
    source?: "watchlist-note" | "polymarket-rule" | "polymarket-description";
  }>;
}) {
  const newsLikeSearch = search.filter((entry) => entry.kind === "news");
  const total = news.length + search.length + social.length;
  if (total === 0) return null;
  return (
    <details className="mt-3 border-y border-border/60 py-2">
      <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        Evidence used · {total} ({social.length} social,{" "}
        {news.length + newsLikeSearch.length} news, {search.length} search)
      </summary>
      <div className="mt-2 space-y-2 text-xs">
        {social.map((entry, index) => (
          <div
            key={`social-${index}`}
            className="border-l-2 border-border/60 pl-2"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {entry.source ?? "watchlist-note"}
            </div>
            <div className="mt-0.5 text-muted-foreground line-clamp-4">
              {entry.text}
            </div>
          </div>
        ))}
        {search.map((entry, index) => (
          <div
            key={`search-${entry.provider}-${index}`}
            className="border-l-2 border-border/60 pl-2"
          >
            <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              <span>
                {entry.provider} · {entry.kind}
              </span>
              {entry.publishedAt && (
                <span>{new Date(entry.publishedAt).toLocaleDateString()}</span>
              )}
              {typeof entry.score === "number" && (
                <span>score {entry.score.toFixed(2)}</span>
              )}
            </div>
            <a
              className="mt-0.5 block underline-offset-2 hover:underline"
              href={entry.url}
              rel="noreferrer"
              target="_blank"
            >
              {entry.title || entry.url}
            </a>
            {entry.excerpt && (
              <p className="mt-1 line-clamp-3 text-muted-foreground">
                {entry.excerpt}
              </p>
            )}
          </div>
        ))}
        {news.map((entry, index) => (
          <div
            key={`news-${index}`}
            className="border-l-2 border-border/60 pl-2"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              news
            </div>
            <a
              className="mt-0.5 block underline-offset-2 hover:underline"
              href={entry.url}
              rel="noreferrer"
              target="_blank"
            >
              {entry.title || entry.url}
            </a>
          </div>
        ))}
      </div>
    </details>
  );
}

function domainFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function SearchDiagnostics({
  diagnostics,
  search,
}: {
  diagnostics?: {
    enabled: boolean;
    mode: "native" | "direct" | "both";
    query: string | null;
    maxResults: number;
    timeoutMs: number;
    providers: Array<{
      provider: "tavily" | "exa" | "firecrawl";
      ready: boolean;
      status: "ok" | "missing-key" | "failed" | "skipped";
      durationMs: number;
      resultCount: number;
      errorMessage?: string;
    }>;
  };
  search: Array<{
    provider: "tavily" | "exa" | "firecrawl";
    kind: "news" | "resolution" | "social" | "web";
    query: string;
    url: string;
    title: string;
  }>;
}) {
  if (!diagnostics && search.length === 0) return null;
  const query = diagnostics?.query ?? search[0]?.query ?? null;
  const providers = diagnostics?.providers ?? [];
  return (
    <details className="mt-3 border-y border-border/60 py-2">
      <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        Search debug · {diagnostics?.mode ?? "unknown"} · {search.length}{" "}
        evidence results
      </summary>
      <div className="mt-2 space-y-2 text-xs">
        <div className="grid gap-2 sm:grid-cols-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Mode
            </div>
            <div>{diagnostics?.mode ?? "unknown"}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Enabled
            </div>
            <div>{diagnostics?.enabled ? "yes" : "no"}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Max results
            </div>
            <div>{diagnostics?.maxResults ?? "unknown"}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Timeout
            </div>
            <div>{diagnostics ? `${diagnostics.timeoutMs}ms` : "unknown"}</div>
          </div>
        </div>
        {query && (
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Query
            </div>
            <div className="mt-0.5 break-words text-muted-foreground">
              {query}
            </div>
          </div>
        )}
        {providers.length > 0 && (
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Providers
            </div>
            <div className="mt-1 grid gap-2 sm:grid-cols-3">
              {providers.map((entry) => (
                <div
                  key={entry.provider}
                  className="border border-border/60 px-2 py-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.12em]">
                      {entry.provider}
                    </span>
                    <span className="text-muted-foreground">
                      {entry.status}
                    </span>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {entry.resultCount} results · {entry.durationMs}ms
                  </div>
                  {entry.errorMessage && (
                    <div className="mt-1 line-clamp-2 text-muted-foreground">
                      {entry.errorMessage}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
        {search.length > 0 && (
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              Evidence results
            </div>
            <div className="mt-1 space-y-1">
              {search.map((entry, index) => (
                <div
                  key={`${entry.provider}-${entry.url}-${index}`}
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground"
                >
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em]">
                    {entry.provider} · {entry.kind}
                  </span>
                  <span>{domainFromUrl(entry.url)}</span>
                  <span className="truncate">{entry.title || entry.url}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

function ResolutionBadge({
  resolution,
}: {
  resolution: { outcomeYes: 0 | 1; settlementPrice: string };
}) {
  const won = resolution.outcomeYes === 1;
  return (
    <span
      className={`font-mono text-[10px] uppercase tracking-[0.12em] px-2 py-1 border ${
        won
          ? "border-emerald-600/70 text-emerald-700 dark:text-emerald-400"
          : "border-rose-600/70 text-rose-700 dark:text-rose-400"
      }`}
    >
      Resolved {won ? "Yes" : "No"} @ {resolution.settlementPrice}
    </span>
  );
}

function VoteCorrectness({
  fairProbability,
  outcomeYes,
}: {
  fairProbability: number;
  outcomeYes: 0 | 1;
}) {
  // Direction match: model said YES (fair > 0.5) and YES won, or model said
  // NO (fair < 0.5) and NO won. fair == 0.5 is undecided.
  const predictedYes = fairProbability > 0.5;
  const predictedNo = fairProbability < 0.5;
  if (!predictedYes && !predictedNo) {
    return (
      <span
        role="img"
        aria-label="undecided"
        className="inline-block h-2 w-2 rounded-full bg-muted-foreground"
        title={`fair ${fairProbability.toFixed(2)} vs outcome ${outcomeYes}`}
      />
    );
  }
  const matched =
    (predictedYes && outcomeYes === 1) || (predictedNo && outcomeYes === 0);
  return (
    <span
      role="img"
      aria-label={matched ? "direction correct" : "direction wrong"}
      className={`inline-block h-2 w-2 rounded-full ${
        matched ? "bg-emerald-600" : "bg-rose-600"
      }`}
      title={`fair ${fairProbability.toFixed(2)} vs outcome ${outcomeYes}${
        matched ? " · matched" : " · missed"
      }`}
    />
  );
}

function EdgeChip({ pct }: { pct: number }) {
  const rounded = Math.round(pct * 10) / 10;
  const tone =
    Math.abs(pct) < 1
      ? "text-muted-foreground border-border/60"
      : pct > 0
        ? "text-emerald-700 border-emerald-700/40"
        : "text-red-700 border-red-700/40";
  const sign = pct > 0 ? "+" : "";
  return (
    <span
      className={`shrink-0 border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${tone}`}
    >
      Edge {sign}
      {rounded}pp
    </span>
  );
}

function EvidenceList({
  label,
  items,
  tone,
}: {
  label: string;
  items?: string[];
  tone: "positive" | "negative" | "missing";
}) {
  if (!items || items.length === 0) return null;
  const toneClass =
    tone === "positive"
      ? "border-emerald-700/40"
      : tone === "negative"
        ? "border-red-700/40"
        : "border-amber-600/50 bg-amber-50/40 dark:bg-amber-950/20";
  return (
    <details className={`mt-2 border-l-2 pl-2 ${toneClass}`}>
      <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label} · {items.length}
      </summary>
      <ul className="mt-1 list-disc pl-4 text-[11px] text-muted-foreground space-y-0.5">
        {items.map((entry, index) => (
          <li key={`${label}-${index}`}>{entry}</li>
        ))}
      </ul>
    </details>
  );
}

function DebugRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-2">
      <dt className="font-mono uppercase tracking-[0.1em]">{label}</dt>
      <dd className="break-all">{value}</dd>
    </div>
  );
}

function DebugBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono uppercase tracking-[0.1em]">{label}</dt>
      <dd className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words border border-border/60 p-2">
        {value}
      </dd>
    </div>
  );
}

function RelatedMarkets({
  markets,
}: {
  markets: Array<{
    question: string;
    outcomeLabel: string;
    marketType: "binary" | "multi_outcome" | "unknown";
    eventType: "single_market" | "multi_market" | "unknown";
    eventEndTime?: string;
    price: string | null;
    selected: boolean;
  }>;
}) {
  if (markets.length === 0) return null;
  return (
    <div className="mt-3 border-y border-border/60 py-2">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        Related market context · {markets.length}
      </div>
      <div className="mt-2 grid gap-2 md:grid-cols-3">
        {markets.map((market, index) => (
          <div
            className="border border-border/60 p-2 text-xs"
            key={`${market.question}-${market.outcomeLabel}-${index}`}
          >
            <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              <span>{market.selected ? "Selected" : market.eventType}</span>
              <span>{market.price ?? "n/a"}</span>
            </div>
            <div className="mt-1 line-clamp-2">{market.question}</div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {market.outcomeLabel} · {market.marketType}
              {market.eventEndTime
                ? ` · ${new Date(market.eventEndTime).toLocaleDateString()}`
                : ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusPill({
  label,
  ready,
  value,
}: {
  label: string;
  ready: boolean;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border border-border/60 px-3 py-2">
      <span className="font-mono uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
      <span className={ready ? "text-emerald-700" : "text-amber-700"}>
        {value}
      </span>
    </div>
  );
}
