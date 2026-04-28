import type { Metadata } from "next";
import { preload } from "react-dom";
import {
  buildOptimizedImageUrl,
  PRIORITY_EVENT_CARD_COUNT,
  PRIORITY_EVENT_CARD_IMAGE_WIDTH,
} from "@/lib/lcp-images";
import { buildPageMetadata } from "@/lib/seo";
import { getInitialEventsByTag } from "@/lib/server-cache";
import { SportsContent } from "./sports-content";

export const metadata: Metadata = buildPageMetadata({
  title: "Sports Prediction Markets",
  description:
    "Browse live sports prediction markets, schedules, odds, and game outcomes across football, basketball, baseball, hockey, soccer, and more.",
  path: "/events/sports",
});

export default async function SportsPage() {
  const initialData = await getInitialEventsByTag("sports");

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

  return <SportsContent initialData={initialData} />;
}
