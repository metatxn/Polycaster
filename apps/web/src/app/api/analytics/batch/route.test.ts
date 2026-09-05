import { NextRequest } from "next/server";
import { getAddress } from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

const capture = vi.hoisted(() => vi.fn());
vi.mock("@/lib/posthog-server", () => ({
  captureServerEvents: capture,
  isPostHogServerConfigured: () => true,
}));
vi.mock("@/lib/api-rate-limit", () => ({ checkRateLimit: () => null }));
vi.mock("@/lib/extension-auth", () => ({
  extensionCorsHeaders: () => ({}),
  handleExtensionPreflight: () => new Response(),
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { POST } from "./route";

const wallet = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const anonymous = "00000000-0000-4000-8000-000000000001";
function request(
  distinctId: string,
  event = "wallet_connected",
  properties: Record<string, string | number> = {}
) {
  return new NextRequest("http://localhost:8000/api/analytics/batch", {
    method: "POST",
    body: JSON.stringify({
      events: [
        { event, distinctId, timestamp: new Date().toISOString(), properties },
      ],
    }),
  });
}

describe("extension analytics ingestion", () => {
  beforeEach(() => {
    capture.mockReset();
    capture.mockResolvedValue(undefined);
  });
  it("accepts anonymous IDs and wallet IDs, preserving anonymous-to-wallet linkage", async () => {
    expect((await POST(request(anonymous, "extension_installed"))).status).toBe(
      202
    );
    expect(
      (
        await POST(
          request(wallet, "$identify", {
            $anon_distinct_id: anonymous,
            wallet_address: wallet,
          })
        )
      ).status
    ).toBe(202);
    expect(capture.mock.calls[1][0][0]).toMatchObject({
      event: "$identify",
      distinctId: getAddress(wallet),
      properties: {
        $anon_distinct_id: anonymous,
        wallet_address: getAddress(wallet),
        source: "knoww_extension",
        product: "extension",
      },
    });
  });
  it("rejects invalid identities before capture", async () => {
    expect((await POST(request("not-an-address"))).status).toBe(400);
    expect(capture).not.toHaveBeenCalled();
  });
  it("preserves order identifiers and strips secrets without trusting the product tag", async () => {
    expect(
      (
        await POST(
          request(wallet, "order_succeeded", {
            product: "web",
            order_id: "order-1",
            wallet_address: wallet,
            signature: "test-signature",
            api_secret: "test-secret",
            analytics_version: 2,
          })
        )
      ).status
    ).toBe(202);
    const properties = capture.mock.calls[0][0][0].properties;
    expect(properties).toMatchObject({
      product: "extension",
      order_id: "order-1",
      analytics_version: 2,
    });
    expect(properties.signature).toBeUndefined();
    expect(properties.api_secret).toBeUndefined();
  });
});
