const DEFAULT_IMAGE_OPTIMIZER_URL = "https://images.knoww.app/";
const DEFAULT_IMAGE_TYPE = "webp";
const DEFAULT_IMAGE_QUALITY = 80;

const imageOptimizerBaseUrl =
  process.env.NEXT_PUBLIC_IMAGE_OPTIMIZER_URL || DEFAULT_IMAGE_OPTIMIZER_URL;

function shouldBypassOptimizer(src: string) {
  return (
    src.startsWith("/") || src.startsWith("data:") || src.startsWith("blob:")
  );
}

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
  optimizerUrl.searchParams.set("type", DEFAULT_IMAGE_TYPE);
  optimizerUrl.searchParams.set("q", String(quality));
  optimizerUrl.searchParams.set("w", String(width));

  return optimizerUrl.toString();
}
