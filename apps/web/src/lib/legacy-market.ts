import { POLYMARKET_API } from "@/constants/polymarket";
import { logger } from "@/lib/logger";

const LEGACY_MARKET_REVALIDATE_SECONDS = 3600;

interface LegacyMarketEvent {
  slug?: unknown;
}

interface LegacyMarketResponse {
  events?: LegacyMarketEvent[] | null;
}

/**
 * Resolve a removed `/markets/{slug}` URL to the event that now owns that
 * market. The direct slug endpoint includes closed markets, which is required
 * for historical inbound links and Search Console cleanup.
 *
 * A genuine 404 or an unmappable response returns null. Transient failures
 * throw so the route emits a retryable server error instead of incorrectly
 * telling crawlers that a known URL has disappeared.
 */
export async function getLegacyMarketEventSlug(
  marketSlug: string
): Promise<string | null> {
  const normalizedSlug = marketSlug.trim();
  if (!normalizedSlug) {
    return null;
  }

  const response = await fetch(
    `${POLYMARKET_API.GAMMA.MARKETS}/slug/${encodeURIComponent(normalizedSlug)}`,
    {
      headers: {
        Accept: "application/json",
      },
      next: { revalidate: LEGACY_MARKET_REVALIDATE_SECONDS },
    }
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    logger.warn("legacy_market.lookup_failed", {
      marketSlug: normalizedSlug,
      status: response.status,
    });
    throw new Error(`Gamma market lookup failed (${response.status})`);
  }

  const market = (await response.json()) as LegacyMarketResponse;
  const eventSlug = market.events?.find(
    (event) => typeof event.slug === "string" && event.slug.trim().length > 0
  )?.slug;

  if (typeof eventSlug !== "string") {
    logger.warn("legacy_market.parent_event_missing", {
      marketSlug: normalizedSlug,
    });
    return null;
  }

  return eventSlug.trim();
}
