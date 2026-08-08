import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { preload } from "react-dom";
import { SportsContent } from "@/app/events/sports/sports-content";
import { serializeJsonLd } from "@/lib/json-ld";
import {
  buildOptimizedImageUrl,
  PRIORITY_EVENT_CARD_COUNT,
  PRIORITY_EVENT_CARD_IMAGE_WIDTH,
} from "@/lib/lcp-images";
import { buildPageMetadata, canonicalUrl } from "@/lib/seo";
import { getInitialEventsByTagStrict } from "@/lib/server-cache";
import { getSportEntry, isSportSubSlug } from "@/lib/sport-categories";

interface SportSubPageProps {
  params: Promise<{ sport: string }>;
}

export async function generateMetadata({
  params,
}: SportSubPageProps): Promise<Metadata> {
  const { sport } = await params;
  const normalized = sport.trim().toLowerCase();
  if (!isSportSubSlug(normalized)) {
    notFound();
  }
  const entry = getSportEntry(normalized);
  const label = entry?.label || normalized.toUpperCase();
  const initialData = await getInitialEventsByTagStrict(
    entry?.tagSlug || normalized,
    entry?.seriesId
  );

  return buildPageMetadata({
    title: `Live ${label} Prediction Markets & Odds`,
    description: `Browse live ${label} prediction markets, schedules, odds, and outcomes on Knoww.`,
    path: `/events/sports/${normalized}`,
    index: initialData.events.length > 0,
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
  const initialData = await getInitialEventsByTagStrict(
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

  // Mirrors the visible ProductHero trail in SportsContent
  // (Markets → Sports → league) so structured data matches rendered
  // content (SEO §12.3/§12.5).
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Markets",
        item: canonicalUrl("/markets"),
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Sports",
        item: canonicalUrl("/events/sports/live"),
      },
      {
        "@type": "ListItem",
        position: 3,
        name: entry?.label ?? "Sports",
        item: canonicalUrl(`/events/sports/${normalized}`),
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <SportsContent initialData={initialData} selectedSport={normalized} />
    </>
  );
}
