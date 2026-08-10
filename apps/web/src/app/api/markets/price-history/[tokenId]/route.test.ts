import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-rate-limit", () => ({
  checkRateLimit: vi.fn(() => null),
}));

vi.mock("@/lib/cache-headers", () => ({
  getCacheHeaders: vi.fn(() => ({ "Cache-Control": "public, max-age=60" })),
}));

vi.mock("@/lib/price-history-cache", () => ({
  fetchCachedClobPriceHistory: vi.fn(async () => ({ history: [] })),
}));

import { fetchCachedClobPriceHistory } from "@/lib/price-history-cache";
import { GET } from "./route";

describe("GET /api/markets/price-history/[tokenId]", () => {
  it("passes the caller signal without coupling shared cache work to it", async () => {
    const request = new NextRequest(
      "https://knoww.app/api/markets/price-history/10000000001?startTs=100&fidelity=60"
    );

    const response = await GET(request, {
      params: Promise.resolve({ tokenId: "10000000001" }),
    });

    expect(response.status).toBe(200);
    expect(fetchCachedClobPriceHistory).toHaveBeenCalledWith(
      "10000000001",
      { startTs: 100, fidelity: 60 },
      { signal: request.signal }
    );
  });
});
