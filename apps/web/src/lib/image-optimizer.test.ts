import { afterEach, expect, it, vi } from "vitest";

const originalSigningKey = process.env.IMAGE_OPTIMIZER_SIGNING_KEY;

afterEach(() => {
  vi.resetModules();

  if (originalSigningKey === undefined) {
    delete process.env.IMAGE_OPTIMIZER_SIGNING_KEY;
  } else {
    process.env.IMAGE_OPTIMIZER_SIGNING_KEY = originalSigningKey;
  }
});

it("uses the same-origin image signing route for rendered optimizer URLs", async () => {
  process.env.IMAGE_OPTIMIZER_SIGNING_KEY = "test-signing-key";
  vi.resetModules();

  const { buildOptimizedImageUrl } = await import("./image-optimizer");

  const optimizedUrl = buildOptimizedImageUrl(
    "https://polymarket-upload.s3.us-east-2.amazonaws.com/example.jpg",
    96,
    75
  );

  const parsedUrl = new URL(optimizedUrl, "https://knoww.app");
  expect(parsedUrl.origin).toBe("https://knoww.app");
  expect(parsedUrl.pathname).toBe("/api/image");

  const params = parsedUrl.searchParams;
  expect(params.get("url")).toBe(
    "https://polymarket-upload.s3.us-east-2.amazonaws.com/example.jpg"
  );
  expect(params.get("q")).toBe("75");
  expect(params.get("w")).toBe("96");
  expect(params.get("v")).toBe("2");
  expect(params.has("s")).toBe(false);
});
