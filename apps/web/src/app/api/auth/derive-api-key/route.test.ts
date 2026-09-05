import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const analytics = vi.hoisted(() => ({
  capture: vi.fn(),
  flush: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/posthog-server", () => ({
  getPostHogClient: () => analytics,
  isPostHogServerConfigured: () => true,
}));
vi.mock("@/lib/api-rate-limit", () => ({ checkRateLimit: () => null }));
vi.mock("@/constants/polymarket", () => ({
  CLOB_BASE_URL: "https://exchange.example.invalid",
}));
vi.mock("@knoww/shared-types/polymarket", () => ({
  buildClobL1Headers: vi.fn(() => ({})),
  createOrDeriveClobApiKey: vi.fn(async () => ({
    success: true,
    data: {},
    method: "derive",
  })),
}));

import { POST } from "./route";

describe("API-key analytics environment", () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([
    ["https://knoww.app", "production"],
    ["http://localhost:8000", "development"],
    ["https://preview.example.invalid", "development"],
  ])("labels events from %s as %s", async (origin, environment) => {
    const response = await POST(
      new NextRequest(`${origin}/api/auth/derive-api-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: "0x0000000000000000000000000000000000000001",
          signature: "test-signature",
          timestamp: "1",
        }),
      })
    );
    expect(response.status).toBe(200);
    expect(analytics.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "trading_api_key_derived",
        properties: expect.objectContaining({
          product: "web",
          analytics_version: 2,
          environment,
        }),
      })
    );
    expect(analytics.capture.mock.calls[0][0].properties).not.toHaveProperty(
      "signature"
    );
  });
});
