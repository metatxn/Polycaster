import { createLogger } from "@knoww/logger";
import { buildEvidencePack } from "./evidence.ts";
import { collectModelVotes } from "./llm-panel.ts";
import { PaperExecutionAdapter } from "./paper-execution.ts";
import { reduceModelVotes } from "./quorum.ts";
import type { AgentRepository, AgentRunDetail } from "./repository.ts";
import type {
  AgentPortfolio,
  AgentWatchlistItem,
  PaperFill,
  QuorumDecision,
} from "./types.ts";

const log = createLogger("agent.run");

const DEFAULT_PORTFOLIO: AgentPortfolio = {
  bankrollUsd: "1000",
  cashUsd: "1000",
  maxPositionUsd: "100",
  maxTradeUsd: "25",
  maxDrawdownPct: "0.2",
  realizedPnlUsd: "0",
};

const DEFAULT_MARKET_CLOSE_BUFFER_MS = 30_000;

function configuredMarketCloseBufferMs(): number {
  const configured = Number.parseInt(
    process.env.AGENT_MARKET_CLOSE_BUFFER_MS ?? "",
    10
  );
  return Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_MARKET_CLOSE_BUFFER_MS;
}

function availableLiquidity(
  item: AgentWatchlistItem,
  fallback: string
): string {
  if (!item.active) return "0";
  return fallback;
}

function holdDecision(reason: string, riskFlag: string): QuorumDecision {
  return {
    action: "HOLD",
    approved: false,
    majorityAction: "HOLD",
    confidence: 0,
    fairProbability: 0,
    sizeUsd: "0",
    reason,
    riskFlags: [riskFlag],
    validVotes: [],
    invalidVotes: [],
  };
}

export function marketTimingGate(
  item: AgentWatchlistItem,
  nowMs = Date.now(),
  closeBufferMs = configuredMarketCloseBufferMs()
): QuorumDecision | null {
  if (!item.eventEndTime) return null;
  const endMs = Date.parse(item.eventEndTime);
  if (!Number.isFinite(endMs)) {
    return holdDecision(
      "Market end time is invalid; defaulting to HOLD.",
      "invalid-market-end-time"
    );
  }
  const msUntilClose = endMs - nowMs;
  if (msUntilClose <= 0) {
    return holdDecision(
      "Market has already closed; defaulting to HOLD.",
      "market-expired"
    );
  }
  if (msUntilClose <= closeBufferMs) {
    return holdDecision(
      "Market is too close to close for a new paper decision; defaulting to HOLD.",
      "market-close-buffer"
    );
  }
  return null;
}

export async function runPaperAgent(
  repository: AgentRepository,
  options?: {
    watchlistItemIds?: string[];
    portfolio?: AgentPortfolio;
  }
): Promise<AgentRunDetail> {
  const run = await repository.createRun();
  const adapter = new PaperExecutionAdapter();
  const portfolio = options?.portfolio ?? DEFAULT_PORTFOLIO;
  const selectedIds = new Set(options?.watchlistItemIds ?? []);
  const watchlist = (await repository.listWatchlist()).filter(
    (item) =>
      item.active && (selectedIds.size === 0 || selectedIds.has(item.id))
  );

  try {
    for (const item of watchlist) {
      const evidence = await buildEvidencePack(item);
      const timingDecision = marketTimingGate(item);
      const votes = timingDecision ? [] : await collectModelVotes(evidence);
      const decision = timingDecision ?? reduceModelVotes(votes);
      let fill: PaperFill | null = null;
      if (decision.approved) {
        fill = await adapter.execute({
          runId: run.id,
          watchlistItemId: item.id,
          tokenId: item.tokenId,
          action: decision.action,
          price: evidence.market.price,
          requestedSizeUsd: decision.sizeUsd,
          availableLiquidityUsd: evidence.market.stale
            ? "0"
            : availableLiquidity(item, evidence.market.liquidityUsd),
          portfolio,
        });
      }
      await repository.saveRunItem({
        runId: run.id,
        watchlistItem: item,
        evidence,
        votes,
        decision,
        fill,
      });
    }
    await repository.completeRun(run.id, "COMPLETED");
  } catch (error) {
    log.error("run.failed", { runId: run.id, error });
    await repository.completeRun(run.id, "FAILED");
  }

  const detail = await repository.getRun(run.id);
  if (!detail) {
    throw new Error("Agent run was not persisted.");
  }
  return detail;
}
