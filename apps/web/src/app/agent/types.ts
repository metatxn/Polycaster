export interface WatchlistItem {
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

export interface RunSummary {
  id: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  itemCount: number;
  tradeCount: number;
  blockedCount: number;
}

export interface RunDetail extends RunSummary {
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

export interface Metrics {
  runCount: number;
  tradeCount: number;
  holdCount: number;
  blockedCount: number;
  notionalUsd: string;
}

export interface CalibrationModelStat {
  provider: string;
  brierMean: number;
  count: number;
}

export interface CalibrationSummary {
  models: CalibrationModelStat[];
  resolvedVoteCount: number;
}

export interface PortfolioPnl {
  openPositionCount: number;
  closedPositionCount: number;
  realizedPnlUsd: string;
  openEntryNotionalUsd: string;
}

export interface LiveOrderRecordSummary {
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

export interface LiveExecutionConfigSummary {
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

export interface PositionSummary {
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

export interface AgentStatus {
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
