import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-rate-limit", () => ({
  checkRateLimit: vi.fn(() => null),
}));

vi.mock("@/lib/cache-headers", () => ({
  getCacheHeaders: vi.fn(() => ({ "Cache-Control": "public, max-age=60" })),
}));

vi.mock("@/lib/trader-history-cache", () => ({
  getTraderHistoriesBatch: vi.fn(async () => new Map()),
  getTraderHistoriesWithTradesBatch: vi.fn(async () => ({
    histories: new Map(),
    tradesByAddress: new Map(),
  })),
}));

vi.mock("@/lib/insider/market-resolutions", () => ({
  getCachedKB: vi.fn(() => null),
  peekCachedKB: vi.fn(() => null),
}));

vi.mock("@/lib/insider/wallet-edge-cache", () => ({
  getCachedWalletEdgesBatch: vi.fn(async () => new Map()),
}));

vi.mock("@/lib/insider/safe-owner", () => ({
  getSafeOwnersBatch: vi.fn(async () => new Map()),
}));

vi.mock("@/lib/insider/funding-source", () => ({
  getWalletFundingBatch: vi.fn(async () => new Map()),
}));

vi.mock("@/lib/insider/clob-price-batch-loader", () => ({
  loadCurrentClobPrices: vi.fn(async () => new Map()),
  resolveReferencePrice: vi.fn(() => null),
}));

import { loadCurrentClobPrices } from "@/lib/insider/clob-price-batch-loader";
import { getCachedWalletEdgesBatch } from "@/lib/insider/wallet-edge-cache";
import {
  getTraderHistoriesBatch,
  getTraderHistoriesWithTradesBatch,
} from "@/lib/trader-history-cache";
import { GET } from "./route";

interface SuspiciousStats {
  uniqueTradersFound: number;
  tradersAnalyzed: number;
  truncated: boolean;
}

function makeTrade(index: number) {
  return {
    proxyWallet: `0x${String(index).padStart(40, "0")}`,
    side: "BUY",
    asset: `asset-${index}`,
    conditionId: `0xcond${index}`,
    size: 300,
    price: 0.5,
    timestamp: 1_700_000_000 + index,
    title: `Market ${index}`,
    slug: `market-${index}`,
    eventSlug: `event-${index}`,
    outcome: "Yes",
    outcomeIndex: 0,
    name: null,
    pseudonym: null,
    profileImage: null,
    transactionHash: `0xtx${index}`,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("GET /api/whales/suspicious", () => {
  it("caps analyzed traders and reports the truncation in stats", async () => {
    const trades = Array.from({ length: 250 }, (_, i) => makeTrade(i));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(trades))
    );

    const res = await GET(
      new NextRequest("https://knoww.app/api/whales/suspicious?minUsdValue=100")
    );
    const body = (await res.json()) as {
      success: boolean;
      stats: SuspiciousStats;
    };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    // 250 unique wallets found, only the first 200 sent to the batch loaders.
    expect(body.stats.uniqueTradersFound).toBe(250);
    expect(body.stats.tradersAnalyzed).toBe(200);
    expect(body.stats.truncated).toBe(true);

    const [analyzedWallets] = vi.mocked(getTraderHistoriesBatch).mock.calls[0];
    expect(analyzedWallets).toHaveLength(200);
  });

  it("reports no truncation when the trader count is under the cap", async () => {
    const trades = Array.from({ length: 50 }, (_, i) => makeTrade(i));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(trades))
    );

    const res = await GET(
      new NextRequest("https://knoww.app/api/whales/suspicious?minUsdValue=100")
    );
    const body = (await res.json()) as {
      success: boolean;
      stats: SuspiciousStats;
    };

    expect(res.status).toBe(200);
    expect(body.stats.uniqueTradersFound).toBe(50);
    expect(body.stats.tradersAnalyzed).toBe(50);
    expect(body.stats.truncated).toBe(false);
  });

  it("passes history-loader trades to the edge cache when the KB is warm", async () => {
    const marketResolutionModule = await import(
      "@/lib/insider/market-resolutions"
    );
    const peekCachedKB = (
      marketResolutionModule as unknown as {
        peekCachedKB: ReturnType<typeof vi.fn>;
      }
    ).peekCachedKB;
    const kb = {
      byConditionId: new Map(),
      fetched: 0,
      indexed: 0,
    };
    peekCachedKB.mockReturnValue(kb);
    const tradesByAddress = new Map([["0xabc", []]]);
    vi.mocked(getTraderHistoriesWithTradesBatch).mockResolvedValueOnce({
      histories: new Map(),
      tradesByAddress,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json([makeTrade(1)]))
    );

    await GET(
      new NextRequest("https://knoww.app/api/whales/suspicious?minUsdValue=100")
    );

    expect(getTraderHistoriesWithTradesBatch).toHaveBeenCalledOnce();
    expect(getTraderHistoriesBatch).not.toHaveBeenCalled();
    expect(getCachedWalletEdgesBatch).toHaveBeenCalledWith(
      expect.any(Array),
      kb,
      6,
      tradesByAddress,
      expect.any(AbortSignal)
    );
    expect(loadCurrentClobPrices).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(AbortSignal)
    );
  });

  it("returns an empty successful response when the recent-trades call times out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("Request timed out", "TimeoutError");
      })
    );

    const response = await GET(
      new NextRequest("https://knoww.app/api/whales/suspicious")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      activities: [],
      stats: { totalTradesScanned: 0 },
    });
  });

  it("returns 504 when the aggregate request signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("Request timed out", "TimeoutError"));
    const fetchMock = vi.fn(async () => {
      throw new DOMException("Request timed out", "TimeoutError");
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new NextRequest("https://knoww.app/api/whales/suspicious", {
        signal: controller.signal,
      })
    );

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: "Suspicious activity upstream request timed out",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shares identical concurrent computations without retaining the result", async () => {
    const fetchMock = vi.fn(async () => Response.json([makeTrade(1)]));
    vi.stubGlobal("fetch", fetchMock);
    const url =
      "https://knoww.app/api/whales/suspicious?minUsdValue=100&limit=50";

    const [first, second] = await Promise.all([
      GET(new NextRequest(url)),
      GET(new NextRequest(url)),
    ]);
    const third = await GET(new NextRequest(url));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({ success: true });
    await expect(second.json()).resolves.toMatchObject({ success: true });
    await expect(third.json()).resolves.toMatchObject({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
