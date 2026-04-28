import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { preload } from "react-dom";
import { SportsContent } from "@/app/events/sports/sports-content";
import {
  buildOptimizedImageUrl,
  PRIORITY_EVENT_CARD_COUNT,
  PRIORITY_EVENT_CARD_IMAGE_WIDTH,
} from "@/lib/lcp-images";
import { buildPageMetadata } from "@/lib/seo";
import { getInitialEventsByTag } from "@/lib/server-cache";
import { isSportSubSlug, SPORT_CATEGORIES } from "@/lib/sport-categories";

interface SportSubPageProps {
  params: Promise<{ sport: string }>;
}

export async function generateMetadata({
  params,
}: SportSubPageProps): Promise<Metadata> {
  const { sport } = await params;
  const normalized = sport.trim().toLowerCase();
  const label =
    SPORT_CATEGORIES.find((category) => category.value === normalized)?.label ||
    normalized.toUpperCase();

  return buildPageMetadata({
    title: `${label} Prediction Markets`,
    description: `Browse live ${label} prediction markets, schedules, odds, and outcomes on Knoww.`,
    path: `/events/sports/${normalized}`,
  });
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
      preload(
        buildOptimizedImageUrl(event.image, PRIORITY_EVENT_CARD_IMAGE_WIDTH),
        {
          as: "image",
          fetchPriority: "high",
        }
      );
    }
  });

  return <SportsContent initialData={initialData} selectedSport={normalized} />;
}
