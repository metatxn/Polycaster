import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { serializeJsonLd } from "@/lib/json-ld";
import {
  buildEventDetailPath,
  buildEventPageDescription,
  buildEventPageTitle,
  buildPageMetadata,
  canonicalUrl,
  cleanMetaText,
  getEventSeoStatus,
  shouldIndexEventPage,
  truncateMetaDescription,
} from "@/lib/seo";
import { getEvent, getRelatedEventsByTag } from "@/lib/server-cache";
import { findPrimaryCategoryTag } from "@/lib/tag-slugs";
import EventDetailClient from "./event-detail-client";
import { EventSeoContent } from "./event-seo-content";

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
  const status = getEventSeoStatus(event);
  const canonicalPath = buildEventDetailPath(slug, event.slug);
  return buildPageMetadata({
    title: buildEventPageTitle(cleanTitle, { status }),
    description: buildEventPageDescription({ title: cleanTitle, status }),
    path: canonicalPath,
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

  const requestedPath = buildEventDetailPath(slug);
  const canonicalPath = buildEventDetailPath(slug, initialEvent.slug);
  if (canonicalPath !== requestedPath) {
    permanentRedirect(canonicalPath);
  }

  const description = truncateMetaDescription(
    buildEventPageDescription({
      title: cleanMetaText(initialEvent.title),
      status: getEventSeoStatus(initialEvent),
    })
  );
  // Category crumb (Markets → Politics → event) only when a tag maps to a
  // known listing page; the same value drives the visible trail in the
  // client so structured data always matches rendered content (SEO §12.5).
  const category = findPrimaryCategoryTag(initialEvent.tags);
  // Same-category events for the crawlable "Related markets" module (§4).
  // React cache() + fetch revalidate keep this from adding a fresh Gamma
  // round-trip on every render.
  const relatedData = category
    ? await getRelatedEventsByTag(category.slug)
    : null;
  const relatedEvents = (relatedData?.events ?? [])
    .filter((related) => related.slug && related.slug !== initialEvent.slug)
    .slice(0, 5);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: initialEvent.title,
    description,
    url: canonicalUrl(canonicalPath),
    image: initialEvent.image,
    dateModified: initialEvent.updatedAt,
    mainEntity: {
      "@type": "Question",
      name: initialEvent.title,
      text: cleanMetaText(initialEvent.description) || initialEvent.title,
    },
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Markets",
          item: canonicalUrl("/markets"),
        },
        ...(category
          ? [
              {
                "@type": "ListItem",
                position: 2,
                name: category.label,
                item: canonicalUrl(`/events/${category.slug}`),
              },
            ]
          : []),
        {
          "@type": "ListItem",
          position: category ? 3 : 2,
          name: initialEvent.title,
          item: canonicalUrl(canonicalPath),
        },
      ],
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <EventDetailClient
        slug={initialEvent.slug || slug}
        initialEvent={initialEvent}
        category={category}
        seoContent={
          <EventSeoContent
            event={initialEvent}
            category={category}
            relatedEvents={relatedEvents}
          />
        }
      />
    </>
  );
}
