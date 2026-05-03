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
import { getSportEntry, isSportSubSlug } from "@/lib/sport-categories";

interface SportSubPageProps {
  params: Promise<{ sport: string }>;
}

export async function generateMetadata({
  params,
}: SportSubPageProps): Promise<Metadata> {
  const { sport } = await params;
  const normalized = sport.trim().toLowerCase();
  const label = getSportEntry(normalized)?.label || normalized.toUpperCase();

  return buildPageMetadata({
    title: `${label} Prediction Markets`,
    description: `Browse live ${label} prediction markets, schedules, odds, and outcomes on Knoww.`,
    path: `/events/sports/${normalized}`,
  });
}

export default async function SportSubPage({ params }: SportSubPageProps) {
  const { sport } = await params;
  const normalized = sport.trim().toLowerCase();

  // Empty slug slips us back to the live sports landing.
  if (!normalized) {
    permanentRedirect("/events/sports/live");
  }

  // URL came in as a different case / stray slash — canonicalize.
  if (normalized !== sport) {
    permanentRedirect(`/events/sports/${normalized}`);
  }

  if (!isSportSubSlug(normalized)) {
    notFound();
  }

  // URL slug is what the user types; tagSlug is what Polymarket Gamma
  // indexes by. Most match, but a handful differ (e.g. /brasileirao-a → bra).
  // When the entry has a Polymarket series ID, prefer that — it filters to
  // exactly the events Polymarket's own UI shows for that league/season.
  const entry = getSportEntry(normalized);
  const initialData = await getInitialEventsByTag(
    entry?.tagSlug || normalized,
    entry?.seriesId
  );

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
