import Decimal from "decimal.js";
import type { Metadata } from "next";
import { cleanMetaText } from "@/lib/meta-text";

export { cleanMetaText } from "@/lib/meta-text";

export const SITE_URL = "https://knoww.app";
export const SITE_NAME = "Knoww";

export const DEFAULT_SEO_DESCRIPTION =
  "Track live Polymarket prediction markets, compare odds, and follow market-moving events across politics, crypto, sports, finance, and culture.";

const DESCRIPTION_MAX_LENGTH = 155;
const PREDICTION_MARKET_TITLE_PATTERN =
  /\b(prediction market|prediction markets|live odds)\b/i;
const RESOLVED_MARKET_STATUS_PATTERN = /\b(proposed|resolved)\b/;
const RESOLVED_MARKET_ONLY_PATTERN = /\bresolved\b/;
const HISTORICAL_EVENT_MIN_DESCRIPTION_LENGTH = 80;
const HISTORICAL_EVENT_MIN_VOLUME = new Decimal(10_000);

type SeoMarketInput = {
  id?: string | number;
  active?: boolean;
  closed?: boolean;
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

export function buildPredictionMarketTitle(title: string | undefined | null) {
  const cleaned = cleanMetaText(title);
  if (!cleaned) {
    return "Prediction Markets";
  }

  if (PREDICTION_MARKET_TITLE_PATTERN.test(cleaned)) {
    return cleaned;
  }

  return `${cleaned} Polymarket Odds`;
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

export function buildPredictionMarketDescription({
  title,
  fallback,
}: {
  title: string;
  fallback?: string | null;
}) {
  const cleanedFallback = cleanMetaText(fallback);

  if (
    cleanedFallback &&
    cleanedFallback.length <= DESCRIPTION_MAX_LENGTH &&
    !/this market will resolve|will resolve to|resolution source/i.test(
      cleanedFallback
    )
  ) {
    return cleanedFallback;
  }

  return `Track live odds, outcomes, and market context for ${title} on Knoww.`;
}

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

  return isCurrentEvent || hasIndexableResolvedEvent(event);
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

function hasIndexableResolvedEvent(event: SeoEventInput) {
  if (
    !event.slug ||
    cleanMetaText(event.description).length <
      HISTORICAL_EVENT_MIN_DESCRIPTION_LENGTH ||
    !hasMinimumHistoricalVolume(event.volume) ||
    !Array.isArray(event.markets)
  ) {
    return false;
  }

  return event.markets.some(
    (market) =>
      market?.id !== undefined &&
      market.closed === true &&
      hasResolvedOnlyStatus(market)
  );
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
  return (
    hasStatusMatching(
      market.umaResolutionStatus,
      RESOLVED_MARKET_ONLY_PATTERN
    ) ||
    hasStatusMatching(
      market.umaResolutionStatuses,
      RESOLVED_MARKET_ONLY_PATTERN
    )
  );
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
  const images = image ? [image] : ["/logo-512x512.png"];

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
