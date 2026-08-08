import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-rate-limit", () => ({
  checkRateLimit: vi.fn(() => null),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn() },
}));

vi.mock("@/lib/sitemap-routes", () => ({
  buildGuideSitemapRoutes: vi.fn(() => []),
  buildStaticSitemapRoutes: vi.fn(() => []),
  getCachedCategorySitemapRoutes: vi.fn(async () => []),
  getCachedEvergreenSitemapEventRoutes: vi.fn(async () => []),
  getCachedSitemapEventRoutes: vi.fn(async () => []),
  renderUrlSetXml: vi.fn(() => "<urlset />"),
}));

import { checkRateLimit } from "@/lib/api-rate-limit";
import { getCachedSitemapEventRoutes } from "@/lib/sitemap-routes";
import { GET } from "./route";

afterEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkRateLimit).mockReturnValue(null);
  vi.mocked(getCachedSitemapEventRoutes).mockResolvedValue([]);
});

describe("GET /sitemaps/[segment]", () => {
  it("applies the crawler-safe rate limit before building a segment", async () => {
    const request = new NextRequest("https://knoww.app/sitemaps/markets.xml");
    const blocked = new Response("Too many requests", { status: 429 });
    vi.mocked(checkRateLimit).mockReturnValue(blocked as never);

    const response = await GET(request, {
      params: Promise.resolve({ segment: "markets.xml" }),
    });

    expect(response).toBe(blocked);
    expect(checkRateLimit).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ uniqueTokenPerInterval: 120 })
    );
    expect(getCachedSitemapEventRoutes).not.toHaveBeenCalled();
  });

  it("returns a retryable 503 without leaking an internal error", async () => {
    const request = new NextRequest("https://knoww.app/sitemaps/markets.xml");
    vi.mocked(getCachedSitemapEventRoutes).mockRejectedValue(
      new Error("private upstream stack detail")
    );

    const response = await GET(request, {
      params: Promise.resolve({ segment: "markets.xml" }),
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("300");
    expect(await response.text()).toBe("Sitemap temporarily unavailable");
  });
});
