import type { LostPosition } from "@/hooks/use-user-positions";
import type { Trade } from "./types";

const FALLBACK_LOST_POSITION_TIMESTAMP = "1970-01-01T00:00:00Z";

function historyPositionKey(conditionId: string | undefined, outcome: string) {
  return `${conditionId ?? ""}-${outcome}`;
}

function normalizeLostPositionTimestamp(timestamp: unknown): string {
  if (typeof timestamp !== "string") return FALLBACK_LOST_POSITION_TIMESTAMP;
  const trimmed = timestamp.trim();
  if (!trimmed) return FALLBACK_LOST_POSITION_TIMESTAMP;
  return trimmed.includes("T") ? trimmed : `${trimmed}T23:59:59Z`;
}

function lostPositionToTrade(
  position: LostPosition,
  closedTimes: Record<string, string>
): Trade {
  const resolvedTimestamp =
    closedTimes[position.conditionId] || position.endDate;
  const timestamp = normalizeLostPositionTimestamp(resolvedTimestamp);

  return {
    id: `lost-${position.conditionId}-${position.outcomeIndex}`,
    timestamp,
    type: "REDEEM",
    side: null,
    size: position.size,
    price: position.avgPrice,
    usdcAmount: 0,
    outcome: position.outcome,
    transactionHash: "",
    isLostPosition: true,
    market: {
      conditionId: position.conditionId,
      title: position.market.title,
      slug: position.market.slug,
      eventSlug: position.market.eventSlug,
      icon: position.market.icon,
      negRisk: position.negRisk ?? false,
    },
  };
}

export function mergePortfolioHistory({
  trades,
  lostPositions,
  closedTimes,
}: {
  trades: Trade[];
  lostPositions: LostPosition[];
  closedTimes: Record<string, string>;
}): Trade[] {
  if (!lostPositions.length) return trades;

  const syntheticLost = lostPositions.map((position) =>
    lostPositionToTrade(position, closedTimes)
  );
  const syntheticLostKeys = new Set(
    syntheticLost.map((trade) =>
      historyPositionKey(trade.market.conditionId, trade.outcome)
    )
  );

  const activityWithoutDuplicateLost = trades.filter((trade) => {
    if (trade.type !== "REDEEM" || trade.usdcAmount !== 0) return true;
    return !syntheticLostKeys.has(
      historyPositionKey(trade.market.conditionId, trade.outcome)
    );
  });

  const merged = [...activityWithoutDuplicateLost, ...syntheticLost];
  merged.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  return merged;
}
