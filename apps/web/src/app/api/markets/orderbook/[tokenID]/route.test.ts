import { ClobRequestError } from "@knoww/shared-types/clob";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/polymarket", () => ({
  fetchOrderBook: vi.fn(),
}));

import { fetchOrderBook } from "@/lib/polymarket";
import { GET } from "./route";

function clobError(message: string, status: number): ClobRequestError {
  return new ClobRequestError(message, {
    ok: false,
    status,
    statusText: "Error",
    json: async () => null,
  });
}

describe("GET /api/markets/orderbook/[tokenID] error handling", () => {
  it("does not reflect the upstream CLOB error message to the client", async () => {
    const sensitive = "host db-prod-1 at 10.0.0.5 refused";
    vi.mocked(fetchOrderBook).mockRejectedValueOnce(clobError(sensitive, 404));

    const req = new NextRequest(
      "https://knoww.app/api/markets/orderbook/abc123"
    );
    const res = await GET(req, {
      params: Promise.resolve({ tokenID: "abc123" }),
    });
    const body = (await res.json()) as { success: boolean; error: string };

    expect(body.success).toBe(false);
    // The upstream message must never reach the client.
    expect(JSON.stringify(body)).not.toContain("db-prod-1");
    expect(JSON.stringify(body)).not.toContain("10.0.0.5");
    // Upstream status class is surfaced instead of a blanket 500.
    expect(res.status).toBe(404);
  });
});
