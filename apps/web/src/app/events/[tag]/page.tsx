import { permanentRedirect } from "next/navigation";
import { preload } from "react-dom";
import {
  buildOptimizedImageUrl,
  PRIORITY_EVENT_CARD_COUNT,
} from "@/lib/lcp-images";
import { getInitialEventsByTag, getTagDetails } from "@/lib/server-cache";
import { normalizeTagSlug } from "@/lib/tag-slugs";
import { TagEventsContent } from "./tag-events-content";

interface TagEventsPageProps {
  params: Promise<{ tag: string }>;
}

export default async function TagEventsPage({ params }: TagEventsPageProps) {
  const { tag } = await params;
  const canonicalTagSlug = normalizeTagSlug(tag);

  if (canonicalTagSlug !== tag) {
    permanentRedirect(`/events/${canonicalTagSlug}`);
  }

  const [initialData, initialTag] = await Promise.all([
    getInitialEventsByTag(canonicalTagSlug),
    getTagDetails(canonicalTagSlug),
  ]);

  initialData?.events?.slice(0, PRIORITY_EVENT_CARD_COUNT).forEach((event) => {
    if (event.image) {
      preload(buildOptimizedImageUrl(event.image), {
        as: "image",
        fetchPriority: "high",
      });
    }
  });

  return (
    <TagEventsContent
      tagSlug={canonicalTagSlug}
      initialData={initialData}
      initialTag={initialTag}
    />
  );
}
