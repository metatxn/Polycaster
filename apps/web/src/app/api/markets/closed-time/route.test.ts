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
  vi.useRealTimers();
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

  it("marks the body partial and disables caching when an unresolved id may be hidden by an upstream failure", async () => {
    const gammaFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/events?")) return Response.json([]);
      return new Response(null, { status: 500 });
    });
    vi.stubGlobal("fetch", gammaFetch);
    vi.mocked(fetchMarket).mockResolvedValue(null);

    const req = new NextRequest(
      "https://knoww.app/api/markets/closed-time?ids=0xabc123"
    );

    const res = await GET(req);
    const body = (await res.json()) as {
      success: boolean;
      closedTimes: Record<string, string>;
    };

    expect(res.status).toBe(200);
    // `partial: true` lets clients distinguish "upstream failed" from
    // "market genuinely has no closedTime" and retry the failed ids.
    expect(body).toEqual({ success: true, closedTimes: {}, partial: true });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("flags truncation and disables caching when more than 50 ids are sent", async () => {
    const gammaFetch = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", gammaFetch);
    vi.mocked(fetchMarket).mockResolvedValue({});

    const ids = Array.from(
      { length: 51 },
      (_, i) => `0x${String(i).padStart(6, "0")}`
    );
    const req = new NextRequest(
      `https://knoww.app/api/markets/closed-time?ids=${ids.join(",")}`
    );

    const res = await GET(req);
    const body = (await res.json()) as {
      success: boolean;
      truncated?: boolean;
    };

    expect(res.status).toBe(200);
    expect(body.truncated).toBe(true);
    // Only the first 50 ids reach the CLOB fallback.
    expect(vi.mocked(fetchMarket)).toHaveBeenCalledTimes(50);
    // An incomplete answer must never be pinned in a shared cache.
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("caches a genuinely missing closedTime when every upstream answered", async () => {
    const gammaFetch = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", gammaFetch);
    vi.mocked(fetchMarket).mockResolvedValue({});

    const req = new NextRequest(
      "https://knoww.app/api/markets/closed-time?ids=0xabc123"
    );

    const res = await GET(req);
    const body = (await res.json()) as {
      success: boolean;
      closedTimes: Record<string, string>;
    };

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, closedTimes: {} });
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
  });

  it("limits concurrent Gamma event lookups to five", async () => {
    let active = 0;
    let maxActive = 0;
    const gammaFetch = vi.fn(async (input: RequestInfo | URL) => {
      if (!input.toString().includes("/events?")) return Response.json([]);

      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return Response.json([]);
    });
    vi.stubGlobal("fetch", gammaFetch);
    vi.mocked(fetchMarket).mockResolvedValue({});

    const ids = Array.from({ length: 12 }, (_, i) => `0x${i + 100}`);
    const slugs = ids.map((_, i) => `closed-event-${i}`);
    const req = new NextRequest(
      `https://knoww.app/api/markets/closed-time?ids=${ids.join(",")}&slugs=${slugs.join(",")}`
    );

    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(maxActive).toBeLessThanOrEqual(5);
  });

  it("limits concurrent CLOB fallbacks to five", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json([]))
    );
    let active = 0;
    let maxActive = 0;
    vi.mocked(fetchMarket).mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return {};
    });

    const ids = Array.from({ length: 12 }, (_, i) => `0x${i + 100}`);
    const req = new NextRequest(
      `https://knoww.app/api/markets/closed-time?ids=${ids.join(",")}`
    );

    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(maxActive).toBeLessThanOrEqual(5);
  });

  it("returns a partial response when the overall upstream deadline expires", async () => {
    vi.useFakeTimers();
    const gammaFetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        })
    );
    vi.stubGlobal("fetch", gammaFetch);
    vi.mocked(fetchMarket).mockResolvedValue({});

    const req = new NextRequest(
      "https://knoww.app/api/markets/closed-time?ids=0xabc123"
    );
    const responsePromise = GET(req);
    let settled = false;
    responsePromise.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(12_001);

    expect(settled).toBe(true);
    const res = await responsePromise;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      closedTimes: {},
      partial: true,
    });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(fetchMarket).not.toHaveBeenCalled();
  });

  it("aborts a stalled CLOB fallback at the overall deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json([]))
    );
    vi.mocked(fetchMarket).mockImplementation(
      (_conditionId, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        })
    );

    const req = new NextRequest(
      "https://knoww.app/api/markets/closed-time?ids=0xabc123"
    );
    const responsePromise = GET(req);

    await vi.advanceTimersByTimeAsync(12_001);

    const res = await responsePromise;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      closedTimes: {},
      partial: true,
    });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(fetchMarket).toHaveBeenCalledWith(
      "0xabc123",
      expect.any(AbortSignal)
    );
  });
});
