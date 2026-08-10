import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-rate-limit", () => ({
  checkRateLimit: vi.fn(() => null),
}));

const requestUrl = "https://knoww.app/api/price/pol";

function priceResponse(price: number): Response {
  return Response.json({
    data: {
      POL: {
        quote: { USD: { price } },
      },
    },
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("COINMARKET_API_KEY", "test-key");
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /api/price/pol", () => {
  it("keeps fresh upstream and valid cached prices publicly cacheable", async () => {
    const upstreamFetch = vi.fn(async () => priceResponse(0.42));
    vi.stubGlobal("fetch", upstreamFetch);
    const { GET } = await import("./route");

    const freshResponse = await GET(new NextRequest(requestUrl));
    const cachedResponse = await GET(new NextRequest(requestUrl));

    expect(freshResponse.headers.get("Cache-Control")).toContain("public");
    expect(cachedResponse.headers.get("Cache-Control")).toContain("public");
    await expect(cachedResponse.json()).resolves.toMatchObject({
      price: 0.42,
      cached: true,
    });
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it("does not publicly cache an expired price returned after an upstream failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T00:00:00.000Z"));
    const upstreamFetch = vi
      .fn()
      .mockResolvedValueOnce(priceResponse(0.42))
      .mockRejectedValueOnce(new TypeError("upstream unavailable"));
    vi.stubGlobal("fetch", upstreamFetch);
    const { GET } = await import("./route");

    await GET(new NextRequest(requestUrl));
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
    const staleResponse = await GET(new NextRequest(requestUrl));

    expect(staleResponse.status).toBe(200);
    expect(staleResponse.headers.get("Cache-Control")).toBe("no-store");
    await expect(staleResponse.json()).resolves.toMatchObject({
      price: 0.42,
      cached: true,
      stale: true,
    });
  });
});
