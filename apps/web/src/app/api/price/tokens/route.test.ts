import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-rate-limit", () => ({
  checkRateLimit: vi.fn(() => null),
}));

const requestUrl = "https://knoww.app/api/price/tokens";

function pricesResponse(): Response {
  return Response.json({
    data: {
      POL: { quote: { USD: { price: 0.42, percent_change_24h: 1 } } },
      ETH: { quote: { USD: { price: 3_500, percent_change_24h: 2 } } },
      BTC: { quote: { USD: { price: 100_000, percent_change_24h: 3 } } },
      USDC: { quote: { USD: { price: 1, percent_change_24h: 0 } } },
      USDT: { quote: { USD: { price: 1, percent_change_24h: 0 } } },
      DAI: { quote: { USD: { price: 1, percent_change_24h: 0 } } },
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

describe("GET /api/price/tokens", () => {
  it("keeps fresh upstream and valid cached prices publicly cacheable", async () => {
    const upstreamFetch = vi.fn(async () => pricesResponse());
    vi.stubGlobal("fetch", upstreamFetch);
    const { GET } = await import("./route");

    const freshResponse = await GET(new NextRequest(requestUrl));
    const cachedResponse = await GET(new NextRequest(requestUrl));

    expect(freshResponse.headers.get("Cache-Control")).toContain("public");
    expect(cachedResponse.headers.get("Cache-Control")).toContain("public");
    const cachedBody = (await cachedResponse.json()) as {
      cached: boolean;
      stale?: boolean;
    };
    expect(cachedBody.cached).toBe(true);
    expect(cachedBody).not.toHaveProperty("stale");
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it("does not cache fallback prices when the API key is unavailable", async () => {
    vi.stubEnv("COINMARKET_API_KEY", "");
    const upstreamFetch = vi.fn();
    vi.stubGlobal("fetch", upstreamFetch);
    const { GET } = await import("./route");

    const response = await GET(new NextRequest(requestUrl));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      cached: false,
      stale: true,
    });
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("does not cache last-resort fallback prices after an upstream failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("upstream unavailable");
      })
    );
    const { GET } = await import("./route");

    const response = await GET(new NextRequest(requestUrl));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      cached: false,
      stale: true,
    });
  });

  it("does not cache expired prices returned after an upstream failure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T00:00:00.000Z"));
    const upstreamFetch = vi
      .fn()
      .mockResolvedValueOnce(pricesResponse())
      .mockRejectedValueOnce(new TypeError("upstream unavailable"));
    vi.stubGlobal("fetch", upstreamFetch);
    const { GET } = await import("./route");

    await GET(new NextRequest(requestUrl));
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
    const staleResponse = await GET(new NextRequest(requestUrl));

    expect(staleResponse.status).toBe(200);
    expect(staleResponse.headers.get("Cache-Control")).toBe("no-store");
    await expect(staleResponse.json()).resolves.toMatchObject({
      cached: true,
      stale: true,
    });
  });
});
