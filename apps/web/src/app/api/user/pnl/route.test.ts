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
    positionCount: number;
    positionsComplete: boolean;
    positionsPagesFetched: number;
    positionsTruncated: boolean;
  };
  trading: {
    totalBuyValue: number;
    totalSellValue: number;
    netFlow: number;
    tradeCount: number;
    activityComplete: boolean;
    activityPagesFetched: number;
    activityTruncated: boolean;
  };
  history: Record<string, { volume: number }>;
}

afterEach(() => {
  vi.useRealTimers();
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

  it("requests positions without excluding active non-redeemable holdings", async () => {
    const upstreamFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));

      if (url.pathname.includes("/user-pnl")) {
        return new Response("upstream unavailable", { status: 502 });
      }

      if (url.pathname === "/positions") {
        if (url.searchParams.has("redeemable")) return Response.json([]);
        return Response.json([
          {
            size: "10",
            avgPrice: "0.25",
            currentPrice: "0.5",
            curPrice: 0.5,
            realizedPnl: "0",
            unrealizedPnl: "2.5",
            curValue: "5",
            initialValue: "2.5",
            currentValue: 5,
            cashPnl: 2.5,
            percentPnl: 100,
            redeemable: false,
            outcome: "Yes",
            title: "Active market",
            slug: "active-market",
          },
        ]);
      }

      if (url.pathname === "/activity") return Response.json([]);
      return new Response("unexpected upstream request", { status: 500 });
    });
    vi.stubGlobal("fetch", upstreamFetch);

    const req = new NextRequest(
      "https://knoww.app/api/user/pnl?user=0x0000000000000000000000000000000000000001"
    );

    const res = await GET(req);
    const body = (await res.json()) as UserPnlResponse;

    expect(res.status).toBe(200);
    expect(body.portfolio.positionCount).toBe(1);
    expect(body.portfolio.currentValue).toBe(5);
    expect(body.pnl.unrealized).toBe(2.5);
  });

  it("normalizes Unix seconds, numeric strings, and ISO activity timestamps", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));

    const timestamps = [
      Math.floor(Date.parse("2026-07-10T09:00:00.000Z") / 1000),
      String(Math.floor(Date.parse("2026-07-10T10:00:00.000Z") / 1000)),
      "2026-07-10T11:00:00.000Z",
    ];
    const upstreamFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));

      if (url.pathname.includes("/user-pnl")) {
        return new Response("upstream unavailable", { status: 502 });
      }
      if (url.pathname === "/positions") return Response.json([]);
      if (url.pathname === "/activity") {
        return Response.json(
          timestamps.map((timestamp, index) => ({
            timestamp,
            side: "BUY",
            size: "1",
            price: "0.1",
            usdcSize: "0.1",
            conditionId: `condition-${index}`,
            outcome: "Yes",
          }))
        );
      }
      return new Response("unexpected upstream request", { status: 500 });
    });
    vi.stubGlobal("fetch", upstreamFetch);

    const req = new NextRequest(
      "https://knoww.app/api/user/pnl?user=0x0000000000000000000000000000000000000001&period=1d&includeHistory=true"
    );

    const res = await GET(req);
    const body = (await res.json()) as UserPnlResponse;

    expect(res.status).toBe(200);
    expect(body.trading.tradeCount).toBe(3);
    expect(body.trading.totalBuyValue).toBe(0.3);
    expect(body.history["2026-07-10"].volume).toBe(0.3);
  });

  it("ignores non-trade and malformed activity rows", async () => {
    const upstreamFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/user-pnl") return Response.json([]);
      if (url.pathname === "/positions") return Response.json([]);
      if (url.pathname === "/activity") {
        return Response.json([
          {
            type: "TRADE",
            timestamp: 1_752_144_000,
            side: "BUY",
            size: "4",
            price: "0.5",
            usdcSize: "2",
            conditionId: "condition-trade",
            outcome: "Yes",
          },
          {
            type: "REDEEM",
            timestamp: 1_752_144_001,
            side: "BUY",
            size: "100",
            price: "1",
            usdcSize: "100",
            conditionId: "condition-redeem",
            outcome: "Yes",
          },
          { type: "TRADE", timestamp: "not-a-date", side: "BUY" },
        ]);
      }
      throw new Error(`Unexpected upstream URL: ${url}`);
    });
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await GET(
      new NextRequest(
        "https://knoww.app/api/user/pnl?user=0x0000000000000000000000000000000000000001&period=all&includeHistory=true"
      )
    );
    const body = (await response.json()) as UserPnlResponse;

    expect(response.status).toBe(200);
    expect(body.trading.tradeCount).toBe(1);
    expect(body.trading.totalBuyValue).toBe(2);
    expect(Object.values(body.history)).toEqual([
      { realized: 0, trades: 1, volume: 2 },
    ]);
  });

  it("includes active positions beyond the first upstream page", async () => {
    const position = (index: number) => ({
      size: "1",
      avgPrice: "0.5",
      currentPrice: "0.6",
      curPrice: 0.6,
      realizedPnl: "0",
      unrealizedPnl: "0.1",
      curValue: "0.6",
      initialValue: "0.5",
      currentValue: 0.6,
      cashPnl: 0.1,
      percentPnl: 20,
      redeemable: false,
      outcome: "Yes",
      title: `Market ${index}`,
      slug: `market-${index}`,
    });
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      position(index)
    );
    const positionOffsets: string[] = [];
    const upstreamFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname === "/user-pnl") return Response.json([]);
      if (url.pathname === "/activity") return Response.json([]);
      if (url.pathname === "/positions") {
        const offset = url.searchParams.get("offset") ?? "0";
        positionOffsets.push(offset);
        return Response.json(offset === "0" ? firstPage : [position(100)]);
      }
      throw new Error(`Unexpected upstream URL: ${url}`);
    });
    vi.stubGlobal("fetch", upstreamFetch);

    const response = await GET(
      new NextRequest(
        "https://knoww.app/api/user/pnl?user=0x0000000000000000000000000000000000000001"
      )
    );
    const body = (await response.json()) as UserPnlResponse;

    expect(response.status).toBe(200);
    expect(positionOffsets).toEqual(["0", "100"]);
    expect(body.portfolio.positionCount).toBe(101);
    expect(body.portfolio.positionsPagesFetched).toBe(2);
    expect(body.portfolio.positionsComplete).toBe(true);
    expect(body.portfolio.positionsTruncated).toBe(false);
  });

  it("includes and deduplicates qualifying activity from a second page", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));

    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      timestamp: "2026-07-10T10:00:00.000Z",
      side: "BUY",
      size: "1",
      price: "0.01",
      usdcSize: "0.01",
      conditionId: `condition-${index}`,
      outcome: "Yes",
      transactionHash: `0x${index.toString(16)}`,
    }));
    const secondPage = [
      firstPage[99],
      {
        timestamp: "2026-07-10T09:00:00.000Z",
        side: "SELL",
        size: "1",
        price: "1",
        usdcSize: "1",
        conditionId: "condition-second-page",
        outcome: "No",
        transactionHash: "0xsecond-page",
      },
    ];
    const activityOffsets: string[] = [];
    const upstreamFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));

      if (url.pathname.includes("/user-pnl")) {
        return new Response("upstream unavailable", { status: 502 });
      }
      if (url.pathname === "/positions") return Response.json([]);
      if (url.pathname === "/activity") {
        const offset = url.searchParams.get("offset") ?? "0";
        activityOffsets.push(offset);
        return Response.json(offset === "0" ? firstPage : secondPage);
      }
      return new Response("unexpected upstream request", { status: 500 });
    });
    vi.stubGlobal("fetch", upstreamFetch);

    const req = new NextRequest(
      "https://knoww.app/api/user/pnl?user=0x0000000000000000000000000000000000000001&period=7d"
    );

    const res = await GET(req);
    const body = (await res.json()) as UserPnlResponse;

    expect(res.status).toBe(200);
    expect(activityOffsets).toEqual(["0", "100"]);
    expect(body.trading.tradeCount).toBe(101);
    expect(body.trading.totalBuyValue).toBe(1);
    expect(body.trading.totalSellValue).toBe(1);
    expect(body.trading.activityPagesFetched).toBe(2);
    expect(body.trading.activityTruncated).toBe(false);
  });

  it("reports when the activity safety limit truncates the result", async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => ({
      timestamp: "2026-07-10T10:00:00.000Z",
      side: "BUY",
      size: "1",
      price: "0.01",
      usdcSize: "0.01",
      conditionId: `condition-${index}`,
      outcome: "Yes",
      transactionHash: `0x${index.toString(16)}`,
    }));
    const upstreamFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));

      if (url.pathname.includes("/user-pnl")) {
        return new Response("upstream unavailable", { status: 502 });
      }
      if (url.pathname === "/positions") return Response.json([]);
      if (url.pathname === "/activity") return Response.json(fullPage);
      return new Response("unexpected upstream request", { status: 500 });
    });
    vi.stubGlobal("fetch", upstreamFetch);

    const req = new NextRequest(
      "https://knoww.app/api/user/pnl?user=0x0000000000000000000000000000000000000001"
    );

    const res = await GET(req);
    const body = (await res.json()) as UserPnlResponse;

    expect(res.status).toBe(200);
    expect(body.trading.activityComplete).toBe(false);
    expect(body.trading.activityTruncated).toBe(true);
    expect(body.trading.activityPagesFetched).toBeGreaterThan(1);
  });

  it("stops finite-period pagination after a newest-first page crosses the cutoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));

    const recentPage = Array.from({ length: 100 }, (_, index) => ({
      timestamp: "2026-07-10T10:00:00.000Z",
      side: "BUY",
      size: "1",
      price: "0.01",
      usdcSize: "0.01",
      conditionId: `recent-${index}`,
      outcome: "Yes",
    }));
    const cutoffPage = [
      {
        timestamp: "2026-07-10T09:00:00.000Z",
        side: "SELL",
        size: "1",
        price: "1",
        usdcSize: "1",
        conditionId: "still-recent",
        outcome: "No",
      },
      ...Array.from({ length: 99 }, (_, index) => ({
        timestamp: "2026-07-01T09:00:00.000Z",
        side: "BUY",
        size: "1",
        price: "5",
        usdcSize: "5",
        conditionId: `too-old-${index}`,
        outcome: "Yes",
      })),
    ];
    const activityOffsets: string[] = [];
    const upstreamFetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));

      if (url.pathname.includes("/user-pnl")) {
        return new Response("upstream unavailable", { status: 502 });
      }
      if (url.pathname === "/positions") return Response.json([]);
      if (url.pathname === "/activity") {
        const offset = url.searchParams.get("offset") ?? "0";
        activityOffsets.push(offset);
        return Response.json(offset === "0" ? recentPage : cutoffPage);
      }
      return new Response("unexpected upstream request", { status: 500 });
    });
    vi.stubGlobal("fetch", upstreamFetch);

    const req = new NextRequest(
      "https://knoww.app/api/user/pnl?user=0x0000000000000000000000000000000000000001&period=7d"
    );

    const res = await GET(req);
    const body = (await res.json()) as UserPnlResponse;

    expect(res.status).toBe(200);
    expect(activityOffsets).toEqual(["0", "100"]);
    expect(body.trading.tradeCount).toBe(101);
    expect(body.trading.totalSellValue).toBe(1);
    expect(body.trading.activityComplete).toBe(true);
    expect(body.trading.activityTruncated).toBe(false);
  });
});
