import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-rate-limit", () => ({
  checkRateLimit: vi.fn(() => null),
}));

vi.mock("@/lib/insider/backtest", () => ({
  runBacktest: vi.fn(async () => ({ markets: [], summary: {} })),
}));

import { runBacktest } from "@/lib/insider/backtest";
import { GET } from "./route";

function makeRequest(query = ""): NextRequest {
  return new NextRequest(`https://knoww.app/api/whales/backtest${query}`);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/whales/backtest", () => {
  it("clamps oversized window and market params to the workload caps", async () => {
    const res = await GET(makeRequest("?maxDaysAgo=60&maxMarkets=60"));

    expect(res.status).toBe(200);
    expect(runBacktest).toHaveBeenCalledWith(
      expect.objectContaining({ maxDaysAgo: 30, maxMarkets: 30 })
    );
  });

  it("uses the documented defaults when no params are given", async () => {
    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(runBacktest).toHaveBeenCalledWith(
      expect.objectContaining({ maxDaysAgo: 21, maxMarkets: 20 })
    );
  });

  it("rejects an inverted window without running the backtest", async () => {
    const res = await GET(makeRequest("?minDaysAgo=25&maxDaysAgo=10"));

    expect(res.status).toBe(400);
    expect(runBacktest).not.toHaveBeenCalled();
  });
});
