import type { Metadata } from "next";
import { Suspense } from "react";
import { preload } from "react-dom";
import {
  buildOptimizedImageUrl,
  PRIORITY_EVENT_CARD_COUNT,
  PRIORITY_EVENT_CARD_IMAGE_WIDTH,
} from "@/lib/lcp-images";
import { buildPageMetadata } from "@/lib/seo";
import { getInitialEvents } from "@/lib/server-cache";
import { HomeContent } from "../home-content";

export const metadata: Metadata = buildPageMetadata({
  title: "Live Polymarket Odds & Prediction Markets",
  description:
    "Track live prediction-market odds, probability changes, volume, and liquidity across politics, crypto, sports, finance, technology, and world events.",
  path: "/markets",
});

export default async function MarketsPage() {
  const initialData = await getInitialEvents();

  initialData?.events?.slice(0, PRIORITY_EVENT_CARD_COUNT).forEach((event) => {
    if (event.image) {
      preload(
        buildOptimizedImageUrl(event.image, PRIORITY_EVENT_CARD_IMAGE_WIDTH),
        {
          as: "image",
          fetchPriority: "high",
        }
      );
    }
  });

  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="flex gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-foreground animate-bounce [animation-delay:-0.3s]" />
            <div className="w-1.5 h-1.5 rounded-full bg-foreground animate-bounce [animation-delay:-0.15s]" />
            <div className="w-1.5 h-1.5 rounded-full bg-foreground animate-bounce" />
          </div>
        </div>
      }
    >
      <HomeContent initialData={initialData} />
    </Suspense>
  );
}
