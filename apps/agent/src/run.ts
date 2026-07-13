import { createLogger } from "@knoww/logger";
import Decimal from "decimal.js";
import { buildEvidencePack } from "./evidence.ts";
import { LiveExecutionAdapter } from "./live-execution.ts";
import { collectModelVotes } from "./llm-panel.ts";
import { PaperExecutionAdapter } from "./paper-execution.ts";
import { reduceModelVotes } from "./quorum.ts";
import type { AgentRepository, AgentRunDetail } from "./repository.ts";
import type {
  AgentPortfolio,
  AgentPosition,
  AgentWatchlistItem,
  ExecutionAdapter,
  PaperFill,
  PositionCloseReason,
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
// 15 minutes before event end: window to lock in P&L on open positions
// before Polymarket stops accepting orders. Distinct from the close gate
// above (which prevents NEW trades 30s before close).
const DEFAULT_POSITION_TIME_EXIT_MS = 15 * 60_000;

function configuredMarketCloseBufferMs(): number {
  const configured = Number.parseInt(
    process.env.AGENT_MARKET_CLOSE_BUFFER_MS ?? "",
    10
  );
  return Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_MARKET_CLOSE_BUFFER_MS;
}

function configuredPositionTimeExitMs(): number {
  const configured = Number.parseInt(
    process.env.AGENT_POSITION_TIME_EXIT_MS ?? "",
    10
  );
  return Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_POSITION_TIME_EXIT_MS;
}

export function shouldTimeExit(
  item: AgentWatchlistItem,
  nowMs = Date.now(),
  bufferMs = configuredPositionTimeExitMs()
): boolean {
  if (!item.eventEndTime) return false;
  const endMs = Date.parse(item.eventEndTime);
  if (!Number.isFinite(endMs)) return false;
  return endMs - nowMs <= bufferMs;
}

/**
 * Synthesize the PaperFill that represents closing an open position. Distinct
 * from `PaperExecutionAdapter.execute` which models opening fills via the
 * portfolio risk gates — closes always succeed at the captured exit price.
 */
function buildClosingFill(input: {
  position: AgentPosition;
  runId: string;
  exitPrice: string;
  portfolio: AgentPortfolio;
  reason: PositionCloseReason;
}): PaperFill {
  const exitNotional = new Decimal(input.position.shares).mul(input.exitPrice);
  const cashAfter = new Decimal(input.portfolio.cashUsd).add(exitNotional);
  return {
    id: crypto.randomUUID(),
    runId: input.runId,
    watchlistItemId: input.position.watchlistItemId,
    tokenId: input.position.tokenId,
    status: "FILLED",
    side: "SELL",
    price: input.exitPrice,
    notionalUsd: exitNotional.toDecimalPlaces(6).toString(),
    shares: input.position.shares,
    cashAfterUsd: cashAfter.toDecimalPlaces(6).toString(),
    reason: `position-close:${input.reason}`,
    createdAt: new Date().toISOString(),
  };
}

/**
 * A fill counts as "executed" (moved real shares) when it fully OR partially
 * filled. The runner opens/keeps a position for both — partial fills carry the
 * actually-filled `shares`/`notionalUsd`.
 */
export function isExecutedFill(fill: Pick<PaperFill, "status">): boolean {
  return fill.status === "FILLED" || fill.status === "PARTIALLY_FILLED";
}

/**
 * Apply a SELL fill to an open position:
 *   - FILLED → close the whole position.
 *   - PARTIALLY_FILLED → reduce the position by the filled shares, booking
 *     realized P&L on only that tranche and keeping the residual open.
 *   - anything else (BLOCKED) → leave the position untouched.
 * Returns the resulting position (CLOSED, reduced-OPEN, or the original).
 */
export async function settleSellFill(input: {
  repository: AgentRepository;
  position: AgentPosition;
  fill: Pick<PaperFill, "status" | "shares">;
  exitPrice: string;
  closeReason: PositionCloseReason;
  runId: string;
}): Promise<AgentPosition | null> {
  const { repository, position, fill, exitPrice, closeReason, runId } = input;
  if (fill.status === "FILLED") {
    return repository.closePosition(position.id, {
      exitPrice,
      closeReason,
      closedRunId: runId,
    });
  }
  if (fill.status === "PARTIALLY_FILLED") {
    return repository.reducePosition(position.id, {
      soldShares: fill.shares,
      exitPrice,
      closeReason,
      closedRunId: runId,
    });
  }
  return position;
}

function timeExitDecision(): QuorumDecision {
  return {
    action: "SELL",
    approved: false,
    majorityAction: "SELL",
    confidence: 0,
    fairProbability: 0,
    sizeUsd: "0",
    reason:
      "Open position auto-closed because the market is inside the time-exit buffer.",
    riskFlags: ["position-time-exit"],
    validVotes: [],
    invalidVotes: [],
  };
}

function availableLiquidity(
  item: AgentWatchlistItem,
  fallback: string
): string {
  if (!item.active) return "0";
  return fallback;
}

function isLikelyNegRiskMarket(item: AgentWatchlistItem): boolean {
  return item.marketType === "multi_outcome";
}

function positionExitNotionalUsd(
  position: AgentPosition,
  exitPrice: string
): string {
  return new Decimal(position.shares)
    .mul(exitPrice)
    .toDecimalPlaces(6)
    .toString();
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

export type AgentExecutionMode = "paper" | "live";

export function resolveAgentExecutionMode(
  requestedMode?: AgentExecutionMode
): AgentExecutionMode {
  return (
    requestedMode ??
    (process.env.AGENT_EXECUTION_MODE === "live" ? "live" : "paper")
  );
}

function selectExecutionAdapter(
  repository: AgentRepository,
  mode: AgentExecutionMode,
  assertExecutionLock?: () => Promise<void>
): ExecutionAdapter {
  if (mode === "live") {
    return new LiveExecutionAdapter({
      upsertLiveOrder: (record) => repository.upsertLiveOrder(record),
      getLiveOrderByIdempotencyKey: (key) =>
        repository.getLiveOrderByIdempotencyKey(key),
      listLiveOrders: () => repository.listLiveOrders(),
      hasUnresolvedLiveOrder: () => repository.hasUnresolvedLiveOrder(),
      assertExecutionLock,
      getClobCredential: (key) => repository.getClobCredential(key),
      upsertClobCredential: (record) => repository.upsertClobCredential(record),
    });
  }
  return new PaperExecutionAdapter();
}

export async function runPaperAgent(
  repository: AgentRepository,
  options?: {
    watchlistItemIds?: string[];
    portfolio?: AgentPortfolio;
    executionMode?: AgentExecutionMode;
    runId?: string;
    requestFingerprint?: string;
    assertExecutionLock?: () => Promise<void>;
  }
): Promise<AgentRunDetail> {
  const run = await repository.createRun(
    options?.runId,
    options?.requestFingerprint
  );
  const executionMode = resolveAgentExecutionMode(options?.executionMode);
  const adapter = selectExecutionAdapter(
    repository,
    executionMode,
    options?.assertExecutionLock
  );
  const portfolio = options?.portfolio ?? DEFAULT_PORTFOLIO;
  if (executionMode === "live") {
    log.warn("run.live_mode", { runId: run.id });
  }
  try {
    const selectedIds = new Set(options?.watchlistItemIds ?? []);
    const watchlist = (await repository.listWatchlist()).filter(
      (item) =>
        item.active && (selectedIds.size === 0 || selectedIds.has(item.id))
    );
    for (const item of watchlist) {
      await options?.assertExecutionLock?.();
      const evidence = await buildEvidencePack(item);
      const exitPrice = evidence.market.midPrice ?? evidence.market.price;

      // Step 1 — time-exit any existing open position before considering a new
      // vote. The agent should never miss the close window because it was busy
      // re-evaluating the market.
      let openPosition = await repository.getOpenPositionByWatchlistItem(
        item.id
      );
      if (openPosition && shouldTimeExit(item)) {
        let exitFill: PaperFill;
        if (executionMode === "live") {
          await options?.assertExecutionLock?.();
          exitFill = await adapter.execute({
            runId: run.id,
            watchlistItemId: item.id,
            tokenId: item.tokenId,
            conditionId: item.conditionId,
            negRisk: isLikelyNegRiskMarket(item),
            action: "SELL",
            price: exitPrice,
            requestedSizeUsd: positionExitNotionalUsd(openPosition, exitPrice),
            requestedShares: openPosition.shares,
            reduceOnly: true,
            availableLiquidityUsd: evidence.market.stale
              ? "0"
              : availableLiquidity(item, evidence.market.liquidityUsd),
            portfolio,
          });
        } else {
          exitFill = buildClosingFill({
            position: openPosition,
            runId: run.id,
            exitPrice,
            portfolio,
            reason: "time-exit",
          });
        }
        const settled = await settleSellFill({
          repository,
          position: openPosition,
          fill: exitFill,
          exitPrice,
          closeReason: "time-exit",
          runId: run.id,
        });
        await repository.saveRunItem({
          runId: run.id,
          watchlistItem: item,
          evidence,
          votes: [],
          decision: timeExitDecision(),
          fill: exitFill,
        });
        openPosition = settled?.status === "OPEN" ? settled : null;
        continue;
      }

      // Step 2 — normal vote path.
      const timingDecision = marketTimingGate(item);
      const votes = timingDecision ? [] : await collectModelVotes(evidence);
      const decision = timingDecision ?? reduceModelVotes(votes);

      // Step 3 — position-aware fill routing.
      let fill: PaperFill | null = null;
      if (decision.approved) {
        if (openPosition) {
          if (decision.action === "SELL") {
            // Contradicts the open BUY position — close at current price.
            if (executionMode === "live") {
              await options?.assertExecutionLock?.();
              fill = await adapter.execute({
                runId: run.id,
                watchlistItemId: item.id,
                tokenId: item.tokenId,
                conditionId: item.conditionId,
                negRisk: isLikelyNegRiskMarket(item),
                action: "SELL",
                price: exitPrice,
                requestedSizeUsd: positionExitNotionalUsd(
                  openPosition,
                  exitPrice
                ),
                requestedShares: openPosition.shares,
                reduceOnly: true,
                availableLiquidityUsd: evidence.market.stale
                  ? "0"
                  : availableLiquidity(item, evidence.market.liquidityUsd),
                portfolio,
              });
            } else {
              fill = buildClosingFill({
                position: openPosition,
                runId: run.id,
                exitPrice,
                portfolio,
                reason: "contradict-vote",
              });
            }
            await settleSellFill({
              repository,
              position: openPosition,
              fill,
              exitPrice,
              closeReason: "contradict-vote",
              runId: run.id,
            });
          }
          // decision.action === "BUY" with an existing long position:
          // do nothing (we don't average up in v1).
        } else if (decision.action === "BUY") {
          await options?.assertExecutionLock?.();
          const opened = await adapter.execute({
            runId: run.id,
            watchlistItemId: item.id,
            tokenId: item.tokenId,
            conditionId: item.conditionId,
            negRisk: isLikelyNegRiskMarket(item),
            action: decision.action,
            price: evidence.market.price,
            requestedSizeUsd: decision.sizeUsd,
            availableLiquidityUsd: evidence.market.stale
              ? "0"
              : availableLiquidity(item, evidence.market.liquidityUsd),
            portfolio,
          });
          fill = opened;
          // Open on full OR partial fills — `opened.shares`/`notionalUsd`
          // already carry the actually-filled amount for partials.
          if (isExecutedFill(opened)) {
            await repository.openPosition({
              watchlistItemId: item.id,
              tokenId: item.tokenId,
              entryPrice: opened.price,
              shares: opened.shares,
              entryNotionalUsd: opened.notionalUsd,
              openedRunId: run.id,
            });
          }
        }
        // decision.action === "SELL" without an open position: noop —
        // we don't open short exposure on CLOB markets in v1.
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
