import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { signImageUrl } from "@/lib/image-signing";

vi.mock("@/lib/api-rate-limit", () => ({
  checkRateLimit: vi.fn(() => null),
}));

import { checkRateLimit } from "@/lib/api-rate-limit";
import { GET } from "./route";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
});

describe("GET /api/image", () => {
  it("rate limits and proxies a signed image optimizer response", async () => {
    process.env.IMAGE_OPTIMIZER_SIGNING_KEY = "test-signing-key";
    const upstreamFetch = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) => {
        return new Response("optimized-image-bytes", {
          status: 200,
          headers: {
            "Cache-Control": "public, max-age=31536000, immutable",
            "Content-Length": "21",
            "Content-Type": "image/avif",
            ETag: '"image-etag"',
          },
        });
      }
    );
    vi.stubGlobal("fetch", upstreamFetch);

    const src =
      "https://polymarket-upload.s3.us-east-2.amazonaws.com/example.jpg";
    const req = new NextRequest(
      `https://knoww.app/api/image?url=${encodeURIComponent(src)}&w=96&q=75&v=2`
    );

    const res = await GET(req);

    expect(checkRateLimit).toHaveBeenCalledWith(
      req,
      expect.objectContaining({ uniqueTokenPerInterval: 600 })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("content-type")).toBe("image/avif");
    expect(res.headers.get("content-length")).toBe("21");
    expect(res.headers.get("etag")).toBe('"image-etag"');
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable"
    );
    expect(await res.text()).toBe("optimized-image-bytes");

    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    const signedUrl = new URL(String(upstreamFetch.mock.calls[0]?.[0]));
    expect(upstreamFetch.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        Accept: expect.stringContaining("image/"),
      }),
    });

    expect(signedUrl.origin).toBe("https://images.knoww.app");
    expect(signedUrl.searchParams.get("url")).toBe(src);
    expect(signedUrl.searchParams.get("w")).toBe("96");
    expect(signedUrl.searchParams.get("q")).toBe("75");
    expect(signedUrl.searchParams.has("v")).toBe(false);
    expect(signedUrl.searchParams.get("s")).toBe(
      signImageUrl(src, 96, 75, "test-signing-key")
    );
  });

  it("rejects non-allowlisted source URLs", async () => {
    process.env.IMAGE_OPTIMIZER_SIGNING_KEY = "test-signing-key";

    const req = new NextRequest(
      "https://knoww.app/api/image?url=https%3A%2F%2Fexample.com%2Fx.png&w=96&q=75"
    );

    const res = await GET(req);
    const body = (await res.json()) as { success: boolean; error: string };

    expect(res.status).toBe(400);
    expect(body).toEqual({
      success: false,
      error: "Invalid image query parameters",
    });
  });
});
