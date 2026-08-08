import { notFound, permanentRedirect } from "next/navigation";
import { getLegacyMarketEventSlug } from "@/lib/legacy-market";
import { buildEventDetailPath } from "@/lib/seo";

type Props = {
  params: Promise<{ slug: string }>;
};

/**
 * Preserve old market links by resolving each market to its exact canonical
 * event page. Unresolvable slugs are genuine 404s; redirecting them all to a
 * listing page would be misleading to users and can be classified as a soft
 * 404 by search engines.
 */
export default async function MarketDetailPage({ params }: Props) {
  const { slug } = await params;
  const eventSlug = await getLegacyMarketEventSlug(slug);

  if (!eventSlug) {
    notFound();
  }

  permanentRedirect(buildEventDetailPath(eventSlug));
}
