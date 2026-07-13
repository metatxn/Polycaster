import { describe, expect, it, vi } from "vitest";
import { createClobPriceBatchLoader } from "./clob-price-batch-loader";
import {
  type PriceIndependentTradeContext,
  planSuspiciousPriceCandidates,
} from "./suspicious-price-plan";

function context(
  overrides: Partial<PriceIndependentTradeContext["accountLoader"]> = {}
): PriceIndependentTradeContext {
  return {
    accountLoader: {
      accountAgeHours: 1_000,
      totalTrades: 100,
      tradeSide: "BUY",
      tradeUsdValue: 5_000,
      isRepeatOffender: false,
      marketsInvolved: 1,
      ...overrides,
    },
    sizeHider: null,
    timingCluster: null,
    categorySpecialist: null,
    fundingCluster: null,
    ownerCluster: null,
  };
}

describe("planSuspiciousPriceCandidates", () => {
  it("causes zero price fetches for a trade that cannot meet the threshold", async () => {
    const fetchOrderBooks = vi.fn(async () => []);
    const load = createClobPriceBatchLoader({ fetchOrderBooks });
    const candidates = planSuspiciousPriceCandidates(
      [{ assetId: "impossible", context: context() }],
      30
    );

    await load(candidates);

    expect(candidates).toEqual([]);
    expect(fetchOrderBooks).not.toHaveBeenCalled();
  });

  it("retains BUY and SELL candidates exactly on the maximum-score boundary", () => {
    const candidates = planSuspiciousPriceCandidates(
      [
        {
          assetId: "boundary-buy",
          context: context({ totalTrades: 15 }),
        },
        {
          assetId: "boundary-sell",
          context: context({ totalTrades: 15, tradeSide: "SELL" }),
        },
      ],
      30
    );

    expect(candidates).toEqual(["boundary-buy", "boundary-sell"]);
  });

  it("deduplicates retained asset ids", () => {
    const boundary = context({ totalTrades: 15 });

    expect(
      planSuspiciousPriceCandidates(
        [
          { assetId: "same-token", context: boundary },
          { assetId: "same-token", context: boundary },
        ],
        30
      )
    ).toEqual(["same-token"]);
  });
});
