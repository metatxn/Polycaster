import type { MetadataRoute } from "next";
import { POLYMARKET_API } from "@/constants/polymarket";
import { fetchGammaKeysetPage } from "@/lib/gamma-keyset";
import { logger } from "@/lib/logger";
import { SITE_URL } from "@/lib/seo";

const SITEMAP_REVALIDATE_SECONDS = 3600;
const SITEMAP_PAGE_LIMIT = "10";
// Keep the sitemap focused on canonical, high-value URLs. The app can browse
// the full catalog, but SEO should not ask crawlers to revisit thousands of
// low-volume or duplicate market detail URLs every hour.
const SITEMAP_MAX_EVENTS = 300;

async function fetchAllKeysetItems<T>(
  endpoint: string,
  params: URLSearchParams,
  preferredKeys: Array<"data" | "events" | "markets">,
  maxItems: number
): Promise<T[]> {
  const items: T[] = [];
  let nextCursor: string | undefined;
  const seenCursors = new Set<string>();

  while (items.length < maxItems) {
    const pageParams = new URLSearchParams(params);
    if (nextCursor) {
      pageParams.set("after_cursor", nextCursor);
    }

    const page = await fetchGammaKeysetPage<T>(
      {
        endpoint,
        params: pageParams,
        revalidate: SITEMAP_REVALIDATE_SECONDS,
      },
      preferredKeys
    );

    if (page.items.length === 0) {
      break;
    }

    items.push(...page.items);

    if (!page.nextCursor || seenCursors.has(page.nextCursor)) {
      break;
    }

    seenCursors.add(page.nextCursor);
    nextCursor = page.nextCursor;
  }

  return items.length > maxItems ? items.slice(0, maxItems) : items;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const generatedAt = new Date();

  // Static routes
  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: generatedAt,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/markets`,
      lastModified: generatedAt,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/leaderboard`,
      lastModified: generatedAt,
      changeFrequency: "daily",
      priority: 0.7,
    },
  ];

  // Fetch active events for dynamic routes
  let eventRoutes: MetadataRoute.Sitemap = [];
  try {
    const events = await fetchAllKeysetItems<{
      slug?: string;
      updatedAt?: string;
      startDate?: string;
      endDate?: string;
    }>(
      POLYMARKET_API.GAMMA.EVENTS_KEYSET,
      new URLSearchParams({
        active: "true",
        closed: "false",
        archived: "false",
        order: "volume24hr",
        ascending: "false",
        limit: SITEMAP_PAGE_LIMIT,
      }),
      ["events", "data"],
      SITEMAP_MAX_EVENTS
    );

    eventRoutes = events
      .filter((e) => e.slug)
      .map((e) => ({
        url: `${SITE_URL}/events/detail/${e.slug}`,
        lastModified:
          parseSitemapDate(e.updatedAt) ??
          parseSitemapDate(e.endDate) ??
          parseSitemapDate(e.startDate) ??
          generatedAt,
        changeFrequency: "daily" as const,
        priority: 0.8,
      }));
  } catch (e) {
    logger.error("sitemap.events.fetch_failed", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return dedupeSitemapRoutes([...staticRoutes, ...eventRoutes]);
}

function parseSitemapDate(value: string | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dedupeSitemapRoutes(
  routes: MetadataRoute.Sitemap
): MetadataRoute.Sitemap {
  const seenUrls = new Set<string>();

  return routes.filter((route) => {
    if (seenUrls.has(route.url)) {
      return false;
    }

    seenUrls.add(route.url);
    return true;
  });
}
