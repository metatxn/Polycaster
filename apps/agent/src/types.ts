import { z } from "zod";

export const AgentActionSchema = z.enum(["BUY", "SELL", "HOLD"]);
export type AgentAction = z.infer<typeof AgentActionSchema>;

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
  action: AgentActionSchema,
  confidence: z.number().min(0).max(1),
  fairProbability: z.number().min(0).max(1),
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
  status: "FILLED" | "BLOCKED";
  side: AgentAction;
  price: string;
  notionalUsd: string;
  shares: string;
  cashAfterUsd: string;
  reason?: string;
  createdAt: string;
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
    eventStartTime?: string;
    eventEndTime?: string;
    resolutionSource?: string;
    price: string;
    bestBid: string | null;
    bestAsk: string | null;
    midPrice: string | null;
    liquidityUsd: string;
    stale: boolean;
    raw?: unknown;
  };
  news: Array<{
    url: string;
    title: string;
    excerpt: string;
    fetchedAt: string;
  }>;
  social: Array<{
    source: "watchlist-note";
    text: string;
  }>;
}
