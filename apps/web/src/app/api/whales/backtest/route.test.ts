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
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("GET /api/whales/backtest", () => {
  // Internal harness: fail closed everywhere except a dev server. Vitest runs
  // with NODE_ENV=test, which must land on the closed side of the gate.
  it("returns 404 outside development", async () => {
    const res = await GET(makeRequest());

    expect(res.status).toBe(404);
    expect(runBacktest).not.toHaveBeenCalled();
  });

  it("clamps oversized window and market params to the workload caps", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const res = await GET(makeRequest("?maxDaysAgo=60&maxMarkets=60"));

    expect(res.status).toBe(200);
    expect(runBacktest).toHaveBeenCalledWith(
      expect.objectContaining({ maxDaysAgo: 30, maxMarkets: 30 })
    );
  });

  it("uses the documented defaults when no params are given", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(runBacktest).toHaveBeenCalledWith(
      expect.objectContaining({ maxDaysAgo: 21, maxMarkets: 20 })
    );
  });

  it("rejects an inverted window without running the backtest", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const res = await GET(makeRequest("?minDaysAgo=25&maxDaysAgo=10"));

    expect(res.status).toBe(400);
    expect(runBacktest).not.toHaveBeenCalled();
  });
});
