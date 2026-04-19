import { preload } from "react-dom";
import {
  buildOptimizedImageUrl,
  PRIORITY_EVENT_CARD_COUNT,
} from "@/lib/lcp-images";
import { getInitialEventsByTag } from "@/lib/server-cache";
import { SportsContent } from "./sports-content";

export default async function SportsPage() {
  const initialData = await getInitialEventsByTag("sports");

  initialData?.events?.slice(0, PRIORITY_EVENT_CARD_COUNT).forEach((event) => {
    if (event.image) {
      preload(buildOptimizedImageUrl(event.image), {
        as: "image",
        fetchPriority: "high",
      });
    }
  });

  return <SportsContent initialData={initialData} />;
}
