import type { Metadata } from "next";

export const SITE_URL = "https://knoww.app";
export const SITE_NAME = "Knoww";

export const DEFAULT_SEO_DESCRIPTION =
  "Discover live prediction markets, compare odds, and track market-moving opinions across politics, crypto, sports, business, and culture.";

const DESCRIPTION_MAX_LENGTH = 155;

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
