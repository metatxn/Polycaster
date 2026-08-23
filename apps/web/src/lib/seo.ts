import Decimal from "decimal.js";
import type { Metadata } from "next";
import { cleanMetaText } from "@/lib/meta-text";

export { cleanMetaText } from "@/lib/meta-text";

export const SITE_URL = "https://knoww.app";
export const SITE_NAME = "Knoww";

/**
 * Brand suffix applied to every page title. A layout that sets a plain-string
 * title breaks this chain for its children (Next resets the template), so any
 * layout with metadata-bearing child routes must re-declare it.
 */
export const TITLE_TEMPLATE = `%s | ${SITE_NAME}`;

export const DEFAULT_SEO_DESCRIPTION =
  "Track live Polymarket prediction markets, compare odds, and follow market-moving events across politics, crypto, sports, finance, and culture.";

const DESCRIPTION_MAX_LENGTH = 155;
const RESOLVED_MARKET_STATUS_PATTERN = /\b(proposed|resolved)\b/;
const HISTORICAL_EVENT_MIN_DESCRIPTION_LENGTH = 80;
const HISTORICAL_EVENT_MIN_VOLUME = new Decimal(10_000);

export type EventSeoStatus = "live" | "closed" | "resolved";

type SeoMarketInput = {
  id?: string | number;
  active?: boolean;
  closed?: boolean;
  outcomePrices?: string | null;
  umaResolutionStatus?: string | null;
  umaResolutionStatuses?: string | null;
};

type SeoEventInput = {
  parentEventId?: string | number | null;
  slug?: string | null;
  title?: string | null;
  description?: string | null;
  volume?: string | number | null;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  ended?: boolean;
  marketCount?: number | null;
  markets?: SeoMarketInput[] | null;
};

export function canonicalUrl(path = "/") {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export function buildEventDetailPath(
  requestedIdentifier: string,
  eventSlug?: string | null
) {
  const canonicalIdentifier = cleanMetaText(eventSlug) || requestedIdentifier;
  return `/events/detail/${encodeURIComponent(canonicalIdentifier)}`;
}

export function truncateMetaDescription(value: string | undefined | null) {
  const cleaned = cleanMetaText(value);
  if (cleaned.length <= DESCRIPTION_MAX_LENGTH) {
    return cleaned;
  }

  const truncated = cleaned.slice(0, DESCRIPTION_MAX_LENGTH - 1);
  const lastSpace = truncated.lastIndexOf(" ");
  const text =
    lastSpace > 90 ? truncated.slice(0, lastSpace) : truncated.trimEnd();

  return `${text}…`;
}

/**
 * Trading state and settlement state are deliberately separate. Gamma can
 * close trading before UMA settlement is final, so `closed` must never be
 * presented as a verified result.
 */
export function isEventClosedForSeo(
  event: Pick<SeoEventInput, "closed" | "ended"> | null | undefined
) {
  return event?.closed === true || event?.ended === true;
}

export function isEventResolvedForSeo(
  event:
    | Pick<SeoEventInput, "active" | "closed" | "ended" | "markets">
    | null
    | undefined
) {
  if (!isEventClosedForSeo(event) || !Array.isArray(event?.markets)) {
    return false;
  }

  return (
    event.markets.length > 0 &&
    event.markets.every(
      (market) =>
        market?.id !== undefined &&
        market.closed === true &&
        hasResolvedOnlyStatus(market)
    )
  );
}

export function getEventSeoStatus(
  event:
    | Pick<SeoEventInput, "active" | "closed" | "ended" | "markets">
    | null
    | undefined
): EventSeoStatus {
  if (isEventResolvedForSeo(event)) {
    return "resolved";
  }
  return isEventClosedForSeo(event) ? "closed" : "live";
}

export function buildEventPageTitle(
  title: string | undefined | null,
  { status = "live" }: { status?: EventSeoStatus } = {}
) {
  const cleaned = cleanMetaText(title);
  if (!cleaned) {
    return "Prediction Markets";
  }

  switch (status) {
    case "resolved":
      return `${cleaned} — Result & Final Odds`;
    case "closed":
      return `${cleaned} — Trading Closed & Final Odds`;
    default:
      return `${cleaned} — Live Odds & Probability`;
  }
}

export function buildNoIndexMetadata({
  title,
  description,
}: {
  title: string;
  description: string;
}): Metadata {
  return {
    title,
    description,
    robots: {
      index: false,
      follow: true,
    },
  };
}

export function buildEventPageDescription({
  title,
  status = "live",
}: {
  title: string;
  status?: EventSeoStatus;
}) {
  switch (status) {
    case "resolved":
      return `See the final result, closing probability, and market history for ${title} on Knoww.`;
    case "closed":
      return `Trading has ended for ${title}. Review the final trading odds, volume, resolution criteria, and settlement status on Knoww.`;
    default:
      return `Follow live odds for ${title}. View the leading outcome, probability movement, volume, liquidity, and resolution date.`;
  }
}

/**
 * Current events are indexable when they contain an open market. Closed or
 * ended events remain indexable when they have durable context, meaningful
 * trading history, and a market record readers can follow through settlement.
 * Fully resolved pages may use rendered outcome data when their source
 * description is brief. Thin historical pages stay crawlable with noindex.
 */
export function shouldIndexEventPage(event: SeoEventInput | null | undefined) {
  if (!event) {
    return false;
  }

  if (!cleanMetaText(event.title)) {
    return false;
  }

  if (event.archived === true) {
    return false;
  }

  const isCurrentEvent =
    event.closed !== true &&
    event.ended !== true &&
    event.active !== false &&
    hasIndexableOpenMarket(event);

  return isCurrentEvent || hasIndexableHistoricalEvent(event);
}

export function shouldListEventInSitemap(
  event: SeoEventInput | null | undefined
) {
  if (
    !event?.slug ||
    (event.parentEventId !== undefined && event.parentEventId !== null)
  ) {
    return false;
  }

  return shouldIndexEventPage(event);
}

function hasIndexableOpenMarket(event: SeoEventInput) {
  if (Array.isArray(event.markets)) {
    return event.markets.some(
      (market) =>
        market &&
        market.id !== undefined &&
        market.active !== false &&
        market.closed !== true &&
        !hasResolvedMarketStatus(market)
    );
  }

  if (typeof event.marketCount === "number") {
    return event.marketCount > 0;
  }

  // List endpoints do not always include market details. If the event-level
  // active/closed/archive signals are clean, avoid excluding it from sitemap
  // consideration solely because the keyset payload is slim.
  return true;
}

function hasIndexableHistoricalEvent(event: SeoEventInput) {
  if (
    !event.slug ||
    !isEventClosedForSeo(event) ||
    !hasDurableHistoricalContext(event) ||
    !hasMinimumHistoricalVolume(event.volume) ||
    !Array.isArray(event.markets)
  ) {
    return false;
  }

  return event.markets.some((market) => market?.id !== undefined);
}

function hasDurableHistoricalContext(event: SeoEventInput) {
  if (
    cleanMetaText(event.description).length >=
    HISTORICAL_EVENT_MIN_DESCRIPTION_LENGTH
  ) {
    return true;
  }

  if (!isEventResolvedForSeo(event)) {
    return false;
  }

  // Resolved pages render a final-outcome summary from Gamma's outcomePrices.
  // Treat that verified market payload as durable context even when Gamma's
  // source description only repeats the event title.
  return Boolean(
    event.markets?.some((market) => hasRenderableOutcomePrice(market))
  );
}

function hasRenderableOutcomePrice(market: SeoMarketInput | null | undefined) {
  if (!market?.outcomePrices) {
    return false;
  }

  try {
    const parsed: unknown = JSON.parse(market.outcomePrices);
    if (!Array.isArray(parsed)) {
      return false;
    }

    const leadingPrice = Number(parsed[0]);
    return (
      Number.isFinite(leadingPrice) && leadingPrice >= 0 && leadingPrice <= 1
    );
  } catch {
    return false;
  }
}

function hasMinimumHistoricalVolume(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return false;
  }

  try {
    const volume = new Decimal(value);
    return (
      volume.isFinite() &&
      volume.greaterThanOrEqualTo(HISTORICAL_EVENT_MIN_VOLUME)
    );
  } catch {
    return false;
  }
}

function hasResolvedOnlyStatus(market: SeoMarketInput) {
  // Prefer Gamma's singular current state when present. Falling back to the
  // plural payload is safe only when every reported state is final; accepting
  // "proposed" alongside a stale "resolved" value would overstate settlement.
  const currentStates = parseResolutionStates(market.umaResolutionStatus);
  const states =
    currentStates ?? parseResolutionStates(market.umaResolutionStatuses);

  return Boolean(
    states?.length && states.every((state) => state === "resolved")
  );
}

function parseResolutionStates(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "[]" || normalized === "null") {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(normalized);
    const states = (Array.isArray(parsed) ? parsed : [parsed])
      .map((state) => String(state).trim().toLowerCase())
      .filter(Boolean);
    return states.length > 0 ? states : null;
  } catch {
    return [normalized];
  }
}

function hasResolvedMarketStatus(market: SeoMarketInput) {
  return (
    hasResolutionStatus(market.umaResolutionStatus) ||
    hasResolutionStatus(market.umaResolutionStatuses)
  );
}

function hasResolutionStatus(value?: string | null) {
  return hasStatusMatching(value, RESOLVED_MARKET_STATUS_PATTERN);
}

function hasStatusMatching(value: string | null | undefined, pattern: RegExp) {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "[]" || normalized === "null") {
    return false;
  }

  return pattern.test(normalized);
}

export function buildPageMetadata({
  title,
  description,
  path,
  image,
  index = true,
}: {
  title: string;
  description: string;
  path: string;
  image?: string;
  index?: boolean;
}): Metadata {
  const cleanDescription = truncateMetaDescription(description);
  const canonical = canonicalUrl(path);
  const images = image ? [image] : ["/og-image.png"];

  return {
    title,
    description: cleanDescription,
    alternates: {
      canonical,
    },
    openGraph: {
      title,
      description: cleanDescription,
      url: canonical,
      siteName: SITE_NAME,
      images,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: cleanDescription,
      images,
    },
    robots: {
      index,
      follow: true,
    },
  };
}
