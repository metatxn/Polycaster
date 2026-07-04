import { describe, expect, it } from "vitest";
import type { LostPosition } from "@/hooks/use-user-positions";
import { mergePortfolioHistory } from "./merge-history";
import type { Trade } from "./types";

function activityRedeem(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "redeem-tx-token-0",
    timestamp: "2026-06-20T01:00:00Z",
    type: "REDEEM",
    side: null,
    size: 2,
    price: 0.42,
    usdcAmount: 0,
    outcome: "Yes",
    transactionHash: "0xredeem",
    market: {
      conditionId: "condition-1",
      title: "Will the market resolve?",
      slug: "market-resolve",
      eventSlug: "market-resolve-event",
      icon: "",
    },
    ...overrides,
  };
}

function lostPosition(overrides: Partial<LostPosition> = {}): LostPosition {
  return {
    id: "lost-position-1",
    asset: "token-1",
    conditionId: "condition-1",
    outcomeIndex: 0,
    outcome: "Yes",
    size: 2,
    avgPrice: 0.42,
    initialValue: 0.84,
    endDate: "2026-06-20",
    negRisk: true,
    market: {
      title: "Will the market resolve?",
      slug: "market-resolve",
      eventSlug: "market-resolve-event",
      eventId: "event-1",
      icon: "",
    },
    ...overrides,
  };
}

describe("mergePortfolioHistory", () => {
  it("prefers the synthetic lost row when activity has a matching zero-value redeem", () => {
    const merged = mergePortfolioHistory({
      trades: [activityRedeem()],
      lostPositions: [lostPosition()],
      closedTimes: {},
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: "lost-condition-1-0",
      isLostPosition: true,
      market: {
        conditionId: "condition-1",
        negRisk: true,
      },
    });
  });

  it("keeps unrelated zero-value redeem activity as ordinary history", () => {
    const merged = mergePortfolioHistory({
      trades: [
        activityRedeem({
          market: { ...activityRedeem().market, conditionId: "condition-2" },
        }),
      ],
      lostPositions: [],
      closedTimes: {},
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]?.isLostPosition).toBeUndefined();
  });

  it("keeps a lost row with a deterministic fallback when upstream omits endDate", () => {
    const merged = mergePortfolioHistory({
      trades: [],
      lostPositions: [
        lostPosition({
          endDate: null as unknown as string,
        }),
      ],
      closedTimes: {},
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: "lost-condition-1-0",
      timestamp: "1970-01-01T00:00:00Z",
      isLostPosition: true,
    });
  });
});
