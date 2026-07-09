import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-rate-limit", () => ({
  checkRateLimit: vi.fn(() => null),
}));

import { GET } from "./route";

interface UserPnlResponse {
  pnl: {
    realized: number;
    unrealized: number;
    total: number;
  };
  portfolio: {
    currentValue: number;
    initialInvestment: number;
  };
  trading: {
    totalBuyValue: number;
    totalSellValue: number;
    netFlow: number;
  };
  history: Record<string, { volume: number }>;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("GET /api/user/pnl", () => {
  it("returns a sanitized validation error for invalid query parameters", async () => {
    const req = new NextRequest(
      "https://knoww.app/api/user/pnl?user=0x0000000000000000000000000000000000000001&period=forever"
    );

    const res = await GET(req);
    const body = (await res.json()) as {
      error: string;
      details?: unknown;
    };

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid query parameters");
    expect(body).not.toHaveProperty("details");
  });

  it("aggregates monetary values with decimal arithmetic", async () => {
    const upstreamFetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);

      if (url.includes("/user-pnl")) {
        return new Response("upstream unavailable", { status: 502 });
      }

      if (url.includes("/positions")) {
        return Response.json([
          {
            size: "1",
            avgPrice: "0.1",
            currentPrice: "0.2",
            curPrice: 1,
            realizedPnl: "0.1",
            unrealizedPnl: "0.1",
            curValue: "0.1",
            initialValue: "0.1",
            currentValue: 0.1,
            cashPnl: 0.1,
            percentPnl: 0,
            redeemable: false,
            outcome: "Yes",
            title: "Market A",
            slug: "market-a",
          },
          {
            size: "1",
            avgPrice: "0.2",
            currentPrice: "0.4",
            curPrice: 1,
            realizedPnl: "0.2",
            unrealizedPnl: "0.2",
            curValue: "0.2",
            initialValue: "0.2",
            currentValue: 0.2,
            cashPnl: 0.2,
            percentPnl: 0,
            redeemable: false,
            outcome: "No",
            title: "Market B",
            slug: "market-b",
          },
        ]);
      }

      if (url.includes("/activity")) {
        return Response.json([
          {
            timestamp: "2026-05-10T12:00:00Z",
            side: "BUY",
            size: "1",
            price: "0.1",
            usdcSize: "0.1",
            conditionId: "condition-a",
            outcome: "Yes",
          },
          {
            timestamp: "2026-05-10T12:05:00Z",
            side: "BUY",
            size: "1",
            price: "0.2",
            usdcSize: "0.2",
            conditionId: "condition-b",
            outcome: "No",
          },
          {
            timestamp: "2026-05-10T12:10:00Z",
            side: "SELL",
            size: "1",
            price: "0.3",
            usdcSize: "0.3",
            conditionId: "condition-c",
            outcome: "Yes",
          },
        ]);
      }

      return new Response("unexpected upstream request", { status: 500 });
    });
    vi.stubGlobal("fetch", upstreamFetch);

    const req = new NextRequest(
      "https://knoww.app/api/user/pnl?user=0x0000000000000000000000000000000000000001&includeHistory=true"
    );

    const res = await GET(req);
    const body = (await res.json()) as UserPnlResponse;

    expect(res.status).toBe(200);
    expect(body.pnl.unrealized).toBe(0.3);
    expect(body.pnl.realized).toBe(0.3);
    expect(body.pnl.total).toBe(0.6);
    expect(body.portfolio.currentValue).toBe(0.3);
    expect(body.portfolio.initialInvestment).toBe(0.3);
    expect(body.trading.totalBuyValue).toBe(0.3);
    expect(body.trading.totalSellValue).toBe(0.3);
    expect(body.trading.netFlow).toBe(0);
    expect(body.history["2026-05-10"].volume).toBe(0.6);
  });
});
