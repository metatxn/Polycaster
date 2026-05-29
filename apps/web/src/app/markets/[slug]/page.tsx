import { permanentRedirect } from "next/navigation";

/**
 * Legacy market-detail route. The canonical public market surface is now
 * `/events/detail/{slug}`, and this editorial detail page has been removed.
 *
 * A market slug does not map 1:1 to an event slug, so we cannot redirect to a
 * specific event. Instead we 308 any inbound `/markets/{slug}` link to the
 * markets list so old/shared URLs land somewhere instead of 404ing.
 */
export default function MarketDetailPage() {
  permanentRedirect("/markets");
}
