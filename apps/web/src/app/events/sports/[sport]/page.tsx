import { notFound, permanentRedirect } from "next/navigation";
import { preload } from "react-dom";
import { SportsContent } from "@/app/events/sports/sports-content";
import {
  buildOptimizedImageUrl,
  PRIORITY_EVENT_CARD_COUNT,
} from "@/lib/lcp-images";
import { getInitialEventsByTag } from "@/lib/server-cache";
import { isSportSubSlug } from "@/lib/sport-categories";

interface SportSubPageProps {
  params: Promise<{ sport: string }>;
}

export default async function SportSubPage({ params }: SportSubPageProps) {
  const { sport } = await params;
  const normalized = sport.trim().toLowerCase();

  // Empty slug slips us back to the overview route.
  if (!normalized) {
    permanentRedirect("/events/sports");
  }

  // URL came in as a different case / stray slash — canonicalize.
  if (normalized !== sport) {
    permanentRedirect(`/events/sports/${normalized}`);
  }

  if (!isSportSubSlug(normalized)) {
    notFound();
  }

  const initialData = await getInitialEventsByTag(normalized);

  initialData?.events?.slice(0, PRIORITY_EVENT_CARD_COUNT).forEach((event) => {
    if (event.image) {
      preload(buildOptimizedImageUrl(event.image), {
        as: "image",
        fetchPriority: "high",
      });
    }
  });

  return <SportsContent initialData={initialData} selectedSport={normalized} />;
}
