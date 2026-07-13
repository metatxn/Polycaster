import { NextRequest, NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-rate-limit", () => ({
  checkRateLimit: vi.fn(() => null),
}));

import { checkRateLimit } from "@/lib/api-rate-limit";
import { GET, OPTIONS } from "./route";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("GET /api/search", () => {
  const extensionOrigin = "chrome-extension://cefhmagobkjigobnmhnhldofoangmhei";

  it("adds extension CORS headers to successful search responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          events: [],
          tags: [],
          profiles: [],
          pagination: { hasMore: false, totalResults: 0 },
        }),
      }))
    );

    const req = new NextRequest(
      "https://knoww.app/api/search?q=cors-success-contract-test&limit=8&source=extension",
      { headers: { origin: extensionOrigin } }
    );

    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      extensionOrigin
    );
    expect(res.headers.get("vary")).toContain("Origin");
  });

  it("returns a gateway error status when upstream search fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );

    const reqUrl =
      "https://knoww.app/api/search?q=network-down-contract-test&limit=8&source=extension";
    const req = new NextRequest(reqUrl);

    const res = await GET(req);
    const body = (await res.json()) as {
      degraded?: boolean;
      events?: unknown[];
      pagination?: { totalResults?: number };
    };

    expect(res.status).toBe(502);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("x-knoww-search-degraded")).toBe("true");
    expect(body.degraded).toBe(true);
    expect(body.events).toEqual([]);
    expect(body.pagination?.totalResults).toBe(0);

    const cachedRes = await GET(new NextRequest(reqUrl));
    expect(cachedRes.status).toBe(502);
    expect(cachedRes.headers.get("x-knoww-search-cache")).toBe("HIT");
  });

  it("adds extension CORS headers to degraded upstream failure responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );

    const res = await GET(
      new NextRequest(
        "https://knoww.app/api/search?q=cors-failure-contract-test&limit=8&source=extension",
        { headers: { origin: extensionOrigin } }
      )
    );

    expect(res.status).toBe(502);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      extensionOrigin
    );
    expect(res.headers.get("x-knoww-search-degraded")).toBe("true");
  });

  it("adds extension CORS headers to empty search responses", async () => {
    const res = await GET(
      new NextRequest("https://knoww.app/api/search?source=extension", {
        headers: { origin: extensionOrigin },
      })
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      extensionOrigin
    );
  });

  it("adds extension CORS headers to rate limited responses", async () => {
    vi.mocked(checkRateLimit).mockReturnValueOnce(
      NextResponse.json({ error: "Too many requests" }, { status: 429 })
    );

    const res = await GET(
      new NextRequest(
        "https://knoww.app/api/search?q=cors-rate-limit-contract-test&source=extension",
        { headers: { origin: extensionOrigin } }
      )
    );

    expect(res.status).toBe(429);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      extensionOrigin
    );
  });

  it("handles extension preflight requests", async () => {
    const res = await OPTIONS(
      new NextRequest("https://knoww.app/api/search", {
        headers: {
          origin: extensionOrigin,
          "access-control-request-method": "GET",
        },
      })
    );

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      extensionOrigin
    );
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
  });
});
