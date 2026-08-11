import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-rate-limit", () => ({
  checkRateLimit: vi.fn(() => null),
}));

import { GET } from "./route";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("GET /api/events/[id]", () => {
  it("returns 404 when Gamma rejects an invalid event slug", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            type: "validation error",
            error: "slug is invalid",
          }),
          {
            status: 422,
            statusText: "Unprocessable Entity",
            headers: { "Content-Type": "application/json" },
          }
        )
      )
    );

    const response = await GET(
      new NextRequest(
        "https://knoww.app/api/events/esportsworldcup.com?fresh=1"
      ),
      { params: Promise.resolve({ id: "esportsworldcup.com" }) }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Event not found",
    });
  });
});
