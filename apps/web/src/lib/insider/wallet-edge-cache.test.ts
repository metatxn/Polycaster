import { afterEach, describe, expect, it, vi } from "vitest";

const getWalletTrades = vi.fn(async () => []);

vi.mock("./wallet-trades-cache", () => ({
  getWalletTrades,
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("getCachedWalletEdge", () => {
  it("uses request-local preloaded trades instead of fetching them again", async () => {
    const { getCachedWalletEdge } = await import("./wallet-edge-cache");
    const getEdge = getCachedWalletEdge as unknown as (
      address: string,
      kb: {
        byConditionId: Map<string, never>;
        fetched: number;
        indexed: number;
      },
      preloadedTrades: Array<{
        conditionId: string;
        side: "BUY";
        outcomeIndex: number;
        price: number;
        size: number;
        timestamp: number;
      }>
    ) => Promise<unknown>;

    await getEdge(
      "0xABC",
      { byConditionId: new Map<string, never>(), fetched: 0, indexed: 0 },
      [
        {
          conditionId: "condition-1",
          side: "BUY",
          outcomeIndex: 0,
          price: 0.4,
          size: 25,
          timestamp: 1_700_000_000,
        },
      ]
    );

    expect(getWalletTrades).not.toHaveBeenCalled();
  });
});
