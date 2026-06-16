const DEFAULT_IMAGE_OPTIMIZER_URL = "https://images.knoww.app/";
const IMAGE_PROXY_PATH = "/api/image";
const IMAGE_PROXY_CACHE_VERSION = "2";
// Match Next.js `<Image>` default so preload URLs (which bypass the loader)
// resolve to the same cache entry as the rendered image.
const DEFAULT_IMAGE_QUALITY = 75;

export const imageOptimizerBaseUrl =
  process.env.NEXT_PUBLIC_IMAGE_OPTIMIZER_URL || DEFAULT_IMAGE_OPTIMIZER_URL;

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
 * This helper is used by both the custom Next.js image loader and manual
 * React preloads. Keep it independent of server-only state so SSR-rendered
 * image attributes match the client hydration pass exactly.
 */
export function buildOptimizedImageUrl(
  src: string,
  width: number,
  quality = DEFAULT_IMAGE_QUALITY
) {
  if (shouldBypassOptimizer(src)) {
    return src;
  }

  const optimizerUrl = new URL(IMAGE_PROXY_PATH, "https://knoww.app");
  optimizerUrl.searchParams.set("url", src);
  optimizerUrl.searchParams.set("q", String(quality));
  optimizerUrl.searchParams.set("w", String(width));
  optimizerUrl.searchParams.set("v", IMAGE_PROXY_CACHE_VERSION);

  return `${optimizerUrl.pathname}?${optimizerUrl.searchParams.toString()}`;
}
