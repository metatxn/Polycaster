export const PRIORITY_EVENT_CARD_COUNT = 6;
export const PRIORITY_EVENT_CARD_IMAGE_WIDTH = 640;

export function buildOptimizedImageUrl(
  src: string,
  width = PRIORITY_EVENT_CARD_IMAGE_WIDTH,
  quality = 75
) {
  return `/_next/image?url=${encodeURIComponent(src)}&w=${width}&q=${quality}`;
}
