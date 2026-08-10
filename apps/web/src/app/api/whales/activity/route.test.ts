import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-rate-limit", () => ({
  checkRateLimit: vi.fn(() => null),
}));

import { GET } from "./route";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("GET /api/whales/activity", () => {
  it("returns an empty successful response when one upstream call times out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("Request timed out", "TimeoutError");
      })
    );

    const response = await GET(
      new NextRequest("https://knoww.app/api/whales/activity")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      activities: [],
      totalTrades: 0,
    });
  });

  it("returns 504 when the aggregate request signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("Request timed out", "TimeoutError"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        throw init?.signal?.reason;
      })
    );

    const response = await GET(
      new NextRequest("https://knoww.app/api/whales/activity", {
        signal: controller.signal,
      })
    );

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: "Whale activity request timed out",
    });
  });
});
