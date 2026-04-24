import { buildOptimizedImageUrl as buildImageOptimizerUrl } from "./image-optimizer";

export const PRIORITY_EVENT_CARD_COUNT = 6;
export const PRIORITY_EVENT_CARD_IMAGE_WIDTH = 640;

// Must match the quality Next's `<Image>` sends through the custom loader
// by default (75) — otherwise preload URLs and rendered `<img>` URLs
// diverge, defeating the preload.
export function buildOptimizedImageUrl(
  src: string,
  width = PRIORITY_EVENT_CARD_IMAGE_WIDTH,
  quality = 75
) {
  return buildImageOptimizerUrl(src, width, quality);
}
