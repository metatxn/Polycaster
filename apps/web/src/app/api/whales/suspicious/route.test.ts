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
}));

vi.mock("@/lib/insider/market-resolutions", () => ({
  getCachedKB: vi.fn(() => null),
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

import { getTraderHistoriesBatch } from "@/lib/trader-history-cache";
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
});
