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

describe("GET /api/trader/x-profile", () => {
  it("returns 504 when leaderboard indexing times out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("Request timed out", "TimeoutError");
      })
    );

    const response = await GET(
      new NextRequest("https://knoww.app/api/trader/x-profile?handle=knoww")
    );

    expect(response.status).toBe(504);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      error: "Trader profile request timed out",
    });
  });
});
