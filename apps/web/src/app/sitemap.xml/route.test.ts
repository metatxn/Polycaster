import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api-rate-limit", () => ({
  checkRateLimit: vi.fn(() => null),
}));

import { checkRateLimit } from "@/lib/api-rate-limit";
import { GET } from "./route";

afterEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkRateLimit).mockReturnValue(null);
});

describe("GET /sitemap.xml", () => {
  it("applies a generous per-IP crawler rate limit", () => {
    const request = new NextRequest("https://knoww.app/sitemap.xml");

    const response = GET(request);

    expect(response.status).toBe(200);
    expect(checkRateLimit).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ uniqueTokenPerInterval: 120 })
    );
  });
});
