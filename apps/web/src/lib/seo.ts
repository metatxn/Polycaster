import type { Metadata } from "next";

export const SITE_URL = "https://knoww.app";
export const SITE_NAME = "Knoww";

export const DEFAULT_SEO_DESCRIPTION =
  "Discover live prediction markets, compare odds, and track market-moving opinions across politics, crypto, sports, business, and culture.";

const DESCRIPTION_MAX_LENGTH = 155;
const PREDICTION_MARKET_TITLE_PATTERN =
  /\b(prediction market|prediction markets|live odds)\b/i;
const RESOLVED_MARKET_STATUS_PATTERN = /\b(proposed|resolved)\b/;

type SeoMarketInput = {
  id?: string | number;
  active?: boolean;
  closed?: boolean;
  umaResolutionStatus?: string | null;
  umaResolutionStatuses?: string | null;
};

type SeoEventInput = {
  slug?: string | null;
  title?: string | null;
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

export function cleanMetaText(value: string | undefined | null) {
  return (value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

  return `${cleaned} Prediction Market & Live Odds`;
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

  if (
    event.archived === true ||
    event.closed === true ||
    event.ended === true ||
    event.active === false
  ) {
    return false;
  }

  return hasIndexableOpenMarket(event);
}

export function shouldListEventInSitemap(
  event: SeoEventInput | null | undefined
) {
  if (!event?.slug) {
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

function hasResolvedMarketStatus(market: SeoMarketInput) {
  return (
    hasResolutionStatus(market.umaResolutionStatus) ||
    hasResolutionStatus(market.umaResolutionStatuses)
  );
}

function hasResolutionStatus(value?: string | null) {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "[]" || normalized === "null") {
    return false;
  }

  return RESOLVED_MARKET_STATUS_PATTERN.test(normalized);
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
