"use client";

import { buildOptimizedImageUrl } from "./image-optimizer";

type ImageLoaderProps = {
  src: string;
  width: number;
  quality?: number;
};

export default function imageLoader({ src, width, quality }: ImageLoaderProps) {
  return buildOptimizedImageUrl(src, width, quality);
}
