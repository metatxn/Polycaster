import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-rate-limit", () => ({
  checkRateLimit: vi.fn(() => null),
}));

vi.mock("@/lib/cache-headers", () => ({
  getCacheHeaders: vi.fn(() => ({ "Cache-Control": "public, max-age=60" })),
}));

vi.mock("@/lib/polymarket", () => ({
  fetchMarket: vi.fn(),
}));

import { fetchMarket } from "@/lib/polymarket";
import { GET } from "./route";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("GET /api/markets/closed-time", () => {
  it("uses Gamma closedTime for lost-position history ordering", async () => {
    const gammaFetch = vi.fn(async () =>
      Response.json([
        {
          conditionId: "0xabc123",
          closedTime: "2026-06-20 04:15:00+00",
          endDate: "2026-06-19T00:00:00Z",
        },
      ])
    );
    vi.stubGlobal("fetch", gammaFetch);
    vi.mocked(fetchMarket).mockResolvedValue({
      end_date_iso: "2026-06-19T00:00:00Z",
    });

    const req = new NextRequest(
      "https://knoww.app/api/markets/closed-time?ids=0xabc123"
    );

    const res = await GET(req);
    const body = (await res.json()) as {
      success: boolean;
      closedTimes: Record<string, string>;
    };

    expect(res.status).toBe(200);
    expect(body).toEqual({
      success: true,
      closedTimes: {
        "0xabc123": "2026-06-20T04:15:00+00:00",
      },
    });
    expect(gammaFetch).toHaveBeenCalledWith(
      expect.stringContaining("closed=true"),
      expect.objectContaining({
        headers: { Accept: "application/json" },
        cache: "no-store",
      })
    );
    expect(fetchMarket).not.toHaveBeenCalled();
  });

  it("uses the event slug when recent Gamma market scans miss the condition", async () => {
    const gammaFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/events?")) {
        return Response.json([
          {
            slug: "fifwc-usa-aus-2026-06-19-more-markets",
            closedTime: "2026-06-19T21:23:07Z",
            markets: [
              {
                conditionId: "0xabc123",
                slug: "fifwc-usa-aus-2026-06-19-btts",
                closedTime: "2026-06-19 21:23:02+00",
                endDate: "2026-06-19T19:00:00Z",
              },
            ],
          },
        ]);
      }
      return Response.json([]);
    });
    vi.stubGlobal("fetch", gammaFetch);
    vi.mocked(fetchMarket).mockResolvedValue({
      end_date_iso: "2026-06-19T00:00:00Z",
    });

    const req = new NextRequest(
      "https://knoww.app/api/markets/closed-time?ids=0xabc123&slugs=fifwc-usa-aus-2026-06-19-more-markets"
    );

    const res = await GET(req);
    const body = (await res.json()) as {
      success: boolean;
      closedTimes: Record<string, string>;
    };

    expect(res.status).toBe(200);
    expect(body).toEqual({
      success: true,
      closedTimes: {
        "0xabc123": "2026-06-19T21:23:02+00:00",
      },
    });
    expect(gammaFetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "/events?slug=fifwc-usa-aus-2026-06-19-more-markets"
      ),
      expect.objectContaining({
        headers: { Accept: "application/json" },
        cache: "no-store",
      })
    );
    expect(fetchMarket).not.toHaveBeenCalled();
  });
});
