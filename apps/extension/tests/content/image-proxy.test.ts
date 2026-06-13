import assert from "node:assert/strict";
import { test } from "vitest";
import {
  setCspSafeImageSrc,
  shouldProxyImageUrl,
} from "../../src/content/image-proxy";

test("shouldProxyImageUrl proxies remote market images that host CSP can block", () => {
  assert.equal(
    shouldProxyImageUrl(
      "https://polymarket-upload.s3.us-east-2.amazonaws.com/trump-renames-ice-to-nice-by-june-30-3BCRrN9XPSIr.jpg"
    ),
    true
  );
  assert.equal(shouldProxyImageUrl("https://example.com/image.png"), true);
});

test("shouldProxyImageUrl leaves CSP-safe local image schemes alone", () => {
  assert.equal(shouldProxyImageUrl("data:image/png;base64,abc"), false);
  assert.equal(shouldProxyImageUrl("blob:https://x.com/abc"), false);
  assert.equal(
    shouldProxyImageUrl("chrome-extension://extension-id/icons/icon-48.png"),
    false
  );
  assert.equal(shouldProxyImageUrl("/icons/icon-48.png"), false);
});

test("setCspSafeImageSrc falls back to the original URL when proxying fails", async () => {
  const img = { src: "" } as HTMLImageElement;
  let fallbackCalled = false;
  const originalUrl = "https://example.com/image.png";

  setCspSafeImageSrc(img, originalUrl, () => {
    fallbackCalled = true;
  });

  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(img.src, originalUrl);
  assert.equal(fallbackCalled, false);
});
