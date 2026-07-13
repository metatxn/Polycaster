import { z } from "zod";

export const AgentActionSchema = z.enum(["BUY", "SELL", "HOLD"]);
export type AgentAction = z.infer<typeof AgentActionSchema>;
export type AgentMarketType = "binary" | "multi_outcome" | "unknown";
export type AgentEventType = "single_market" | "multi_market" | "unknown";

export const DecimalStringSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "must be a non-negative decimal string");

export const ModelVoteDebugSchema = z.object({
  status: z.enum([
    "ok",
    "invalid-json",
    "schema-invalid",
    "api-error",
    "timeout",
    "no-output",
  ]),
  durationMs: z.number().int().nonnegative(),
  rawTextLength: z.number().int().nonnegative().optional(),
  rawTextPreview: z.string().max(800).optional(),
  finishReason: z.string().max(80).optional(),
  errorName: z.string().max(120).optional(),
  errorMessage: z.string().max(300).optional(),
  validationIssues: z.array(z.string().max(240)).max(8).optional(),
});

export const ModelVoteSchema = z.object({
  provider: z.string().min(1).max(80),
  // Structured analysis (the load-bearing fields).
  resolutionView: z.string().min(1).max(600),
  marketImpliedProbability: z.number().min(0).max(1),
  fairProbability: z.number().min(0).max(1),
  edgePct: z.number().min(-100).max(100),
  evidenceFor: z.array(z.string().min(1).max(400)).max(6),
  evidenceAgainst: z.array(z.string().min(1).max(400)).max(6),
  missingEvidence: z.array(z.string().min(1).max(400)).max(6),
  // Decision.
  action: AgentActionSchema,
  confidence: z.number().min(0).max(1),
  sizeUsd: DecimalStringSchema,
  reasoning: z.string().min(20).max(1200),
  citations: z.array(z.string().min(1).max(240)).min(1).max(8),
  riskFlags: z.array(z.string().min(1).max(120)).max(12),
  debug: ModelVoteDebugSchema.optional(),
});

export type ModelVote = z.infer<typeof ModelVoteSchema>;

export interface ValidatedModelVote {
  provider: string;
  valid: boolean;
  vote: ModelVote;
  errors: string[];
}

export interface QuorumDecision {
  action: AgentAction;
  approved: boolean;
  majorityAction: AgentAction | null;
  confidence: number;
  fairProbability: number;
  sizeUsd: string;
  reason: string;
  riskFlags: string[];
  validVotes: ModelVote[];
  invalidVotes: ValidatedModelVote[];
}

export interface AgentPortfolio {
  bankrollUsd: string;
  cashUsd: string;
  maxPositionUsd: string;
  maxTradeUsd: string;
  maxDrawdownPct: string;
  realizedPnlUsd: string;
}

export interface RiskInput {
  action: AgentAction;
  requestedSizeUsd: string;
  price: string;
  availableLiquidityUsd: string;
  portfolio: AgentPortfolio;
}

export interface RiskResult {
  approved: boolean;
  reason: string;
  cappedSizeUsd: string;
}

export interface PaperOrderRequest extends RiskInput {
  runId: string;
  watchlistItemId: string;
  tokenId: string;
  conditionId?: string;
  negRisk?: boolean;
  requestedShares?: string;
  reduceOnly?: boolean;
}

export interface LiveOrderRequest extends PaperOrderRequest {
  idempotencyKey: string;
  killSwitchEnabled: boolean;
  maxPositionUsd: string;
  maxOrderUsd: string;
  orderIndicator: "manual" | "automatic";
  walletSigningIsolation: "server-isolated" | "hardware-isolated";
}

export interface PaperFill {
  id: string;
  runId: string;
  watchlistItemId: string;
  tokenId: string;
  /**
   * FILLED — the order fully filled the requested size.
   * PARTIALLY_FILLED — only part of the order filled (FAK orders only); the
   *   `shares`/`notionalUsd` fields carry the actually-filled amount, and a SELL
   *   in this state reduces (not closes) the underlying position.
   * BLOCKED — nothing executed (risk gate, dry-run, error, or zero fill).
   */
  status: "FILLED" | "PARTIALLY_FILLED" | "BLOCKED";
  side: AgentAction;
  price: string;
  notionalUsd: string;
  shares: string;
  cashAfterUsd: string;
  reason?: string;
  createdAt: string;
}

export type PositionStatus = "OPEN" | "CLOSED";

/**
 * Why an open position was closed. Drives both audit trail and the dashboard
 * label. The set is intentionally small; if we add e.g. partial-close later
 * we'll widen this union explicitly.
 */
export type PositionCloseReason =
  | "contradict-vote"
  | "time-exit"
  | "resolution"
  | "manual";

export type LiveOrderStatus =
  | "DRY_RUN"
  | "POSTED"
  | "UNKNOWN"
  | "OPEN"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELED"
  | "FAILED";

export interface LiveOrderRecord {
  idempotencyKey: string;
  runId: string;
  watchlistItemId: string;
  tokenId: string;
  side: AgentAction;
  requestedSizeUsd: string;
  price: string;
  /**
   * SHA-256 hex digest of the EIP-712 signed-order JSON. The full payload is
   * intentionally never persisted (it's a bearer credential — anyone with the
   * JSON could submit it and bypass the dry-run gate). The hash lets us verify
   * after the fact that a given order was signed.
   */
  signedOrderHash: string | null;
  /** CLOB-assigned order id after a successful POST. Null in dry-run. */
  orderId: string | null;
  status: LiveOrderStatus;
  submittedAt: string | null;
  filledAt: string | null;
  createdAt: string;
  filledNotionalUsd: string;
  filledShares: string;
  averageFillPrice: string | null;
  lastSyncedAt: string | null;
  balanceSnapshotJson: string | null;
  /** True when the order was signed but not submitted to the CLOB. */
  dryRun: boolean;
  error: string | null;
}

export type LiveOrderUpsert = Omit<
  LiveOrderRecord,
  | "createdAt"
  | "filledNotionalUsd"
  | "filledShares"
  | "averageFillPrice"
  | "lastSyncedAt"
  | "balanceSnapshotJson"
> &
  Partial<
    Pick<
      LiveOrderRecord,
      | "createdAt"
      | "filledNotionalUsd"
      | "filledShares"
      | "averageFillPrice"
      | "lastSyncedAt"
      | "balanceSnapshotJson"
    >
  >;

export interface AgentClobCredentialRecord {
  credentialKey: string;
  clobHost: string;
  signerAddress: string;
  funderAddress: string;
  encryptedCredentials: string;
  encryptionKeyVersion: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

export type AgentClobCredentialUpsert = Omit<
  AgentClobCredentialRecord,
  "createdAt" | "updatedAt" | "lastUsedAt"
> &
  Partial<
    Pick<AgentClobCredentialRecord, "createdAt" | "updatedAt" | "lastUsedAt">
  >;

export interface AgentPosition {
  id: string;
  watchlistItemId: string;
  tokenId: string;
  /** Always 'BUY' in v1 — we go long the watchlist item's tokenId. */
  side: "BUY";
  status: PositionStatus;
  entryPrice: string;
  shares: string;
  entryNotionalUsd: string;
  exitPrice: string | null;
  exitNotionalUsd: string | null;
  realizedPnlUsd: string | null;
  openedAt: string;
  closedAt: string | null;
  closeReason: PositionCloseReason | null;
  openedRunId: string | null;
  closedRunId: string | null;
}

export interface ExecutionAdapter {
  mode: "paper" | "live";
  execute(request: PaperOrderRequest): Promise<PaperFill>;
  submitLiveOrder(request: unknown): Promise<never>;
}

export interface AgentWatchlistItem {
  id: string;
  question: string;
  tokenId: string;
  conditionId?: string;
  marketSlug?: string;
  side?: "YES" | "NO";
  outcomeLabel?: string;
  marketType?: AgentMarketType;
  eventType?: AgentEventType;
  outcomes?: string[];
  oppositeOutcomeLabel?: string;
  oppositeTokenId?: string;
  eventMarketCount?: number;
  eventStartTime?: string;
  eventEndTime?: string;
  resolutionSource?: string;
  newsUrls: string[];
  socialNotes: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentEvidencePack {
  watchlistItem: AgentWatchlistItem;
  capturedAt: string;
  market: {
    question: string;
    tokenId: string;
    conditionId?: string;
    marketSlug?: string;
    outcomeLabel?: string;
    marketType?: AgentMarketType;
    eventType?: AgentEventType;
    outcomes?: string[];
    oppositeOutcomeLabel?: string;
    oppositeTokenId?: string;
    eventMarketCount?: number;
    eventStartTime?: string;
    eventEndTime?: string;
    resolutionSource?: string;
    price: string;
    bestBid: string | null;
    bestAsk: string | null;
    midPrice: string | null;
    spread: string | null;
    spreadPct: string | null;
    liquidityUsd: string;
    stale: boolean;
    orderBook: {
      bidDepthUsdTop5: string;
      askDepthUsdTop5: string;
      bidAskImbalanceTop5: string;
      bookPressure: "bid-heavy" | "ask-heavy" | "balanced" | "thin";
      thin: boolean;
    };
    priceMovement: {
      currentPrice: string;
      lastTradePrice: string | null;
      lastTradeAt: string | null;
      recentHigh: string | null;
      recentLow: string | null;
      priceChange5m: string | null;
      priceChange1h: string | null;
      priceChange24h: string | null;
      trend: "up" | "down" | "flat" | "volatile" | "unknown";
    };
    raw?: unknown;
  };
  news: Array<{
    url: string;
    title: string;
    excerpt: string;
    fetchedAt: string;
  }>;
  relatedMarkets: Array<{
    question: string;
    tokenId: string;
    conditionId?: string;
    marketSlug?: string;
    outcomeLabel: string;
    marketType: AgentMarketType;
    eventType: AgentEventType;
    eventEndTime?: string;
    price: string | null;
    active: boolean;
    selected: boolean;
  }>;
  search: Array<{
    provider: "exa" | "tavily" | "firecrawl";
    kind: "news" | "resolution" | "social" | "web";
    query: string;
    url: string;
    title: string;
    excerpt: string;
    publishedAt: string | null;
    fetchedAt: string;
    score: number | null;
  }>;
  searchDiagnostics?: {
    enabled: boolean;
    mode: "native" | "direct" | "both";
    query: string | null;
    maxResults: number;
    timeoutMs: number;
    providers: Array<{
      provider: "exa" | "tavily" | "firecrawl";
      ready: boolean;
      status: "ok" | "missing-key" | "failed" | "skipped";
      durationMs: number;
      resultCount: number;
      errorMessage?: string;
    }>;
  };
  social: Array<{
    source: "watchlist-note" | "polymarket-rule" | "polymarket-description";
    text: string;
  }>;
}
