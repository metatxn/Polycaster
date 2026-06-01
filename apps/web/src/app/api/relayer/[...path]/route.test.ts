import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-rate-limit", () => ({
  checkRateLimit: vi.fn(() => null),
}));

vi.mock("@/lib/auth/extension-session", () => ({
  requireExtensionSession: vi.fn(async () => ({ response: null })),
}));

vi.mock("@/lib/origin-guard", () => ({
  checkOriginAndFetchSite: vi.fn(() => null),
}));

import { POST } from "./route";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("POST /api/relayer/[...path]", () => {
  it("forwards the configured builder code to Polymarket relayer submit requests", async () => {
    process.env.POLY_RELAYER_API_KEY = "relayer-key";
    process.env.POLY_RELAYER_API_KEY_ADDRESS =
      "0x0000000000000000000000000000000000000001";
    process.env.NEXT_PUBLIC_POLY_BUILDER_CODE = "0xbuilder";

    const upstreamFetch = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) => {
        return new Response(JSON.stringify({ transactionID: "tx-1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const req = new NextRequest("https://knoww.app/api/relayer/submit", {
      method: "POST",
      body: JSON.stringify({
        type: "SAFE",
        transactions: [],
      }),
    });

    const res = await POST(req, {
      params: Promise.resolve({ path: ["submit"] }),
    });

    expect(res.status).toBe(200);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    const init = upstreamFetch.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({
      RELAYER_API_KEY: "relayer-key",
      RELAYER_API_KEY_ADDRESS: "0x0000000000000000000000000000000000000001",
      "X-Builder-Code": "0xbuilder",
    });
  });
});
