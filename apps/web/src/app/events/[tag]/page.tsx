import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { preload } from "react-dom";
import { serializeJsonLd } from "@/lib/json-ld";
import {
  buildOptimizedImageUrl,
  PRIORITY_EVENT_CARD_COUNT,
  PRIORITY_EVENT_CARD_IMAGE_WIDTH,
} from "@/lib/lcp-images";
import { buildPageMetadata, canonicalUrl } from "@/lib/seo";
import { getInitialEventsByTag, getTagDetails } from "@/lib/server-cache";
import { isSportSubSlug } from "@/lib/sport-categories";
import { normalizeTagSlug } from "@/lib/tag-slugs";
import { TagEventsContent } from "./tag-events-content";

interface TagEventsPageProps {
  params: Promise<{ tag: string }>;
}

export async function generateMetadata({
  params,
}: TagEventsPageProps): Promise<Metadata> {
  const { tag } = await params;
  const canonicalTagSlug = normalizeTagSlug(tag);
  const tagDetails = await getTagDetails(canonicalTagSlug);
  const label = tagDetails?.label || formatTagTitle(canonicalTagSlug);

  return buildPageMetadata({
    title: `${label} Polymarket Prediction Markets`,
    description:
      tagDetails?.description ||
      `Browse live ${label.toLowerCase()} Polymarket prediction markets, compare odds, and track active outcomes on Knoww.`,
    path: `/events/${canonicalTagSlug}`,
  });
}

export default async function TagEventsPage({ params }: TagEventsPageProps) {
  const { tag } = await params;
  const canonicalTagSlug = normalizeTagSlug(tag);

  if (canonicalTagSlug !== tag) {
    permanentRedirect(`/events/${canonicalTagSlug}`);
  }

  // Sport sub-categories live under /events/sports/{slug}. Redirect any
  // legacy /events/{sport} hits so inbound links, bookmarks, and the
  // rest of the app converge on the canonical URL.
  if (isSportSubSlug(canonicalTagSlug)) {
    permanentRedirect(`/events/sports/${canonicalTagSlug}`);
  }

  const [initialData, initialTag] = await Promise.all([
    getInitialEventsByTag(canonicalTagSlug),
    getTagDetails(canonicalTagSlug),
  ]);

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

  const tagLabel = initialTag?.label || formatTagTitle(canonicalTagSlug);
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
        name: tagLabel,
        item: canonicalUrl(`/events/${canonicalTagSlug}`),
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <TagEventsContent
        tagSlug={canonicalTagSlug}
        initialData={initialData}
        initialTag={initialTag}
      />
    </>
  );
}

function formatTagTitle(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
