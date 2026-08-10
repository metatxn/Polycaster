import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("getTraderHistoriesWithTradesBatch", () => {
  it("derives history and edge-ready records from one pagination pass", async () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      type: "TRADE",
      conditionId: `condition-${index}`,
      slug: `market-${index}`,
      eventSlug: `event-${index}`,
      side: "BUY" as const,
      outcomeIndex: 0,
      price: 0.4,
      size: 25,
      timestamp: 1_700_000_000 - index,
    }));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(rows))
      .mockResolvedValueOnce(Response.json([]));
    vi.stubGlobal("fetch", fetchMock);

    const historyModule = await import("./trader-history-cache");
    const getCombined = (
      historyModule as unknown as {
        getTraderHistoriesWithTradesBatch?: (
          addresses: string[],
          concurrency: number
        ) => Promise<{
          histories: Map<
            string,
            { firstTradeDate: string | null; totalTrades: number }
          >;
          tradesByAddress: Map<string, unknown[]>;
        }>;
      }
    ).getTraderHistoriesWithTradesBatch;

    expect(getCombined).toBeTypeOf("function");
    const result = await getCombined?.(["0xABC"], 1);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result?.histories.get("0xABC")?.totalTrades).toBe(100);
    expect(result?.histories.get("0xABC")?.firstTradeDate).toBe(
      new Date((1_700_000_000 - 99) * 1000).toISOString()
    );
    expect(result?.tradesByAddress.get("0xabc")).toHaveLength(100);
  });

  it("does not cache a history derived from a partial snapshot", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(
        new DOMException("Request timed out", "TimeoutError")
      )
      .mockResolvedValueOnce(
        Response.json([
          {
            type: "TRADE",
            conditionId: "condition-1",
            side: "BUY",
            outcomeIndex: 0,
            price: 0.4,
            size: 25,
            timestamp: 1_700_000_000,
          },
        ])
      );
    vi.stubGlobal("fetch", fetchMock);

    const { getTraderHistory } = await import("./trader-history-cache");
    const first = await getTraderHistory("0xDEF");
    const second = await getTraderHistory("0xDEF");

    expect(first.totalTrades).toBe(0);
    expect(second.totalTrades).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
