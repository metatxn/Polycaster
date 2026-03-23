import type { Metadata } from "next";
import { notFound } from "next/navigation";
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
    };
  }

  const title = event.title;
  const description =
    event.description ||
    `Trade on this prediction event: ${event.title}. Explore odds and make your prediction on Knoww.`;

  return {
    title,
    description,
    alternates: {
      canonical: `https://knoww.app/events/detail/${slug}`,
    },
    openGraph: {
      title,
      description,
      images: event.image ? [event.image] : [],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: event.image ? [event.image] : [],
    },
  };
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

  return <EventDetailClient slug={slug} initialEvent={initialEvent} />;
}
