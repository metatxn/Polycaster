import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serializeJsonLd } from "@/lib/json-ld";
import {
  buildPageMetadata,
  buildPredictionMarketDescription,
  buildPredictionMarketTitle,
  canonicalUrl,
  cleanMetaText,
  shouldIndexEventPage,
  truncateMetaDescription,
} from "@/lib/seo";
import { getEvent } from "@/lib/server-cache";
import EventDetailClient from "./event-detail-client";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEvent(slug);

  if (!event) {
    return {
      title: "Event Not Found",
      description: "The requested event could not be found.",
      robots: {
        index: false,
        follow: true,
      },
    };
  }

  const cleanTitle = cleanMetaText(event.title);
  return buildPageMetadata({
    title: buildPredictionMarketTitle(cleanTitle),
    description: buildPredictionMarketDescription({
      title: cleanTitle,
      fallback: event.description,
    }),
    path: `/events/detail/${slug}`,
    image: event.image,
    index: shouldIndexEventPage(event),
  });
}

/**
 * Server Component - Pre-fetches event data at the edge
 *
 * React 19 optimization: Data is fetched on the server and passed
 * as initial data to the client component, eliminating the loading state
 * and reducing time-to-first-meaningful-paint.
 */
export default async function EventDetailPage({ params }: Props) {
  const { slug } = await params;

  // Pre-fetch event data on the server (runs at the edge on Cloudflare)
  const initialEvent = await getEvent(slug);

  // Return 404 at server level for better SEO and UX
  if (!initialEvent) {
    notFound();
  }

  const description = truncateMetaDescription(
    buildPredictionMarketDescription({
      title: initialEvent.title,
      fallback: initialEvent.description,
    })
  );
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: initialEvent.title,
    description,
    url: canonicalUrl(`/events/detail/${slug}`),
    image: initialEvent.image,
    dateModified: initialEvent.updatedAt,
    mainEntity: {
      "@type": "Question",
      name: initialEvent.title,
      text: cleanMetaText(initialEvent.description) || initialEvent.title,
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <EventDetailClient slug={slug} initialEvent={initialEvent} />
    </>
  );
}
