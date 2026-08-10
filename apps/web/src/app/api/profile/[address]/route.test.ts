import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-rate-limit", () => ({
  checkRateLimit: vi.fn(() => null),
}));

import { GET } from "./route";

const address = "0x0000000000000000000000000000000000000001";

type Loader = "profile" | "pnl" | "positions" | "trades" | "leaderboard";

function upstreamResponse(input: string | URL | Request, failed?: Loader) {
  const url = new URL(String(input));

  if (url.pathname.startsWith("/profile/")) {
    return failed === "profile"
      ? new Response(null, { status: 502 })
      : Response.json({});
  }
  if (url.hostname === "user-pnl-api.polymarket.com") {
    return failed === "pnl"
      ? new Response(null, { status: 502 })
      : Response.json({});
  }
  if (url.pathname === "/positions") {
    return failed === "positions"
      ? new Response(null, { status: 502 })
      : Response.json([]);
  }
  if (url.pathname === "/trades") {
    return failed === "trades"
      ? new Response(null, { status: 502 })
      : Response.json([]);
  }
  if (url.pathname === "/v1/leaderboard") {
    const shouldFail =
      failed === "leaderboard" && url.searchParams.get("timePeriod") === "DAY";
    return shouldFail ? new Response(null, { status: 502 }) : Response.json([]);
  }

  throw new Error(`Unexpected upstream URL: ${url}`);
}

async function requestProfile(): Promise<Response> {
  return GET(new NextRequest(`https://knoww.app/api/profile/${address}`), {
    params: Promise.resolve({ address }),
  });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("GET /api/profile/[address]", () => {
  it("keeps a complete profile publicly cacheable when successful loaders return empty data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => upstreamResponse(input))
    );

    const response = await requestProfile();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("public");
    await expect(response.json()).resolves.toMatchObject({
      proxyWallet: address,
      userName: null,
      positionsCount: 0,
      tradesCount: 0,
      rankings: {
        overall: null,
        day: null,
        week: null,
        month: null,
      },
    });
  });

  it.each<Loader>(["profile", "pnl", "positions", "trades", "leaderboard"])(
    "does not cache the profile when the %s loader fails",
    async (failedLoader) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string | URL | Request) =>
          upstreamResponse(input, failedLoader)
        )
      );

      const response = await requestProfile();

      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
  );
});
