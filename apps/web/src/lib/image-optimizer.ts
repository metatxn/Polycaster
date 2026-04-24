import { signImageUrl } from "./image-signing";

const DEFAULT_IMAGE_OPTIMIZER_URL = "https://images.knoww.app/";
// Match Next.js `<Image>` default so preload URLs (which bypass the loader)
// resolve to the same cache entry as the rendered image.
const DEFAULT_IMAGE_QUALITY = 75;

export const imageOptimizerBaseUrl =
  process.env.NEXT_PUBLIC_IMAGE_OPTIMIZER_URL || DEFAULT_IMAGE_OPTIMIZER_URL;

// Server-only — must NOT be prefixed with `NEXT_PUBLIC_`. Webpack tree-
// shakes `process.env.X` reads in client bundles; this reference resolves
// to `undefined` at client-render time, so the loader silently skips
// signing and the Worker falls back to the Referer check.
const signingKey = process.env.IMAGE_OPTIMIZER_SIGNING_KEY;

function shouldBypassOptimizer(src: string) {
  return (
    src.startsWith("/") || src.startsWith("data:") || src.startsWith("blob:")
  );
}

/**
 * Build a URL to the shared image optimizer.
 *
 * Omits the `type` parameter intentionally — the optimizer negotiates AVIF
 * vs WebP vs the original format from the browser's `Accept` header and
 * caches per-format. Hardcoding `type=webp` would disable AVIF delivery
 * for every modern browser that supports it.
 *
 * When `IMAGE_OPTIMIZER_SIGNING_KEY` is set (server-only), the URL carries
 * a truncated HMAC so the Worker can authorize the request without
 * relying on the Referer header. Client-rendered images miss the secret
 * and fall back to the Worker's Referer allowlist.
 */
export function buildOptimizedImageUrl(
  src: string,
  width: number,
  quality = DEFAULT_IMAGE_QUALITY
) {
  if (shouldBypassOptimizer(src)) {
    return src;
  }

  const optimizerUrl = new URL(imageOptimizerBaseUrl);
  optimizerUrl.searchParams.set("url", src);
  optimizerUrl.searchParams.set("q", String(quality));
  optimizerUrl.searchParams.set("w", String(width));

  if (signingKey) {
    optimizerUrl.searchParams.set(
      "s",
      signImageUrl(src, width, quality, signingKey)
    );
  }

  return optimizerUrl.toString();
}
