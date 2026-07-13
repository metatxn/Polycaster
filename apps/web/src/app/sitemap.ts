import type { MetadataRoute } from "next";
import { unstable_cache } from "next/cache";
import { POLYMARKET_API } from "@/constants/polymarket";
import { fetchGammaKeysetPage } from "@/lib/gamma-keyset";
import { logger } from "@/lib/logger";
import {
  buildEventDetailPath,
  canonicalUrl,
  shouldListEventInSitemap,
} from "@/lib/seo";
import { SPORT_GROUPS } from "@/lib/sport-categories";
import { buildFallbackTags } from "@/lib/tag-slugs";

const SITEMAP_REVALIDATE_SECONDS = 3600;
const SITEMAP_PAGE_LIMIT = "100";
// Keep the sitemap focused on canonical, high-value URLs. The app can browse
// the full catalog, but SEO should not ask crawlers to revisit thousands of
// low-volume or duplicate market detail URLs every hour.
const SITEMAP_MAX_EVENTS = 1000;
const SITEMAP_MAX_RESOLVED_EVENTS = 250;

type SitemapEvent = {
  slug?: string;
  title?: string;
  description?: string;
  volume?: string | number;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  ended?: boolean;
  parentEventId?: string | number | null;
  marketCount?: number;
  markets?: Array<{
    id?: string | number;
    active?: boolean;
    closed?: boolean;
    umaResolutionStatus?: string | null;
    umaResolutionStatuses?: string | null;
  }>;
  updatedAt?: string;
};

async function fetchAllKeysetItems<T, R>(
  endpoint: string,
  params: URLSearchParams,
  preferredKeys: Array<"data" | "events" | "markets">,
  maxItems: number,
  mapPage: (items: T[]) => R[]
): Promise<R[]> {
  const items: R[] = [];
  let sourceItemCount = 0;
  let nextCursor: string | undefined;
  const seenCursors = new Set<string>();

  while (sourceItemCount < maxItems) {
    const pageParams = new URLSearchParams(params);
    if (nextCursor) {
      pageParams.set("after_cursor", nextCursor);
    }

    const page = await fetchGammaKeysetPage<T>(
      {
        endpoint,
        params: pageParams,
        cache: "no-store",
      },
      preferredKeys
    );

    if (page.items.length === 0) {
      break;
    }

    const remainingItems = maxItems - sourceItemCount;
    const sourceItems = page.items.slice(0, remainingItems);
    items.push(...mapPage(sourceItems));
    sourceItemCount += sourceItems.length;

    if (!page.nextCursor || seenCursors.has(page.nextCursor)) {
      break;
    }

    seenCursors.add(page.nextCursor);
    nextCursor = page.nextCursor;
  }

  return items;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes = buildStaticSitemapRoutes();
  const eventRoutes = await getCachedSitemapEventRoutes();

  return dedupeSitemapRoutes([...staticRoutes, ...eventRoutes]);
}

const getCachedSitemapEventRoutes = unstable_cache(
  fetchSitemapEventRoutes,
  ["knoww-sitemap-event-routes-v3"],
  { revalidate: SITEMAP_REVALIDATE_SECONDS }
);

async function fetchSitemapEventRoutes() {
  const queryResults = await Promise.allSettled(
    buildSitemapEventQueries().map((query) =>
      fetchAllKeysetItems<SitemapEvent, MetadataRoute.Sitemap[number]>(
        POLYMARKET_API.GAMMA.EVENTS_KEYSET,
        query.params,
        ["events", "data"],
        query.maxItems,
        buildEventSitemapRoutes
      )
    )
  );
  const eventRoutes: MetadataRoute.Sitemap = [];

  for (const result of queryResults) {
    if (result.status === "fulfilled") {
      eventRoutes.push(...result.value);
      continue;
    }

    logger.error("sitemap.events.fetch_failed", {
      error:
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason),
    });
  }

  return eventRoutes;
}

export function buildEventSitemapRoutes(
  events: SitemapEvent[]
): MetadataRoute.Sitemap {
  return events
    .filter((event) => shouldListEventInSitemap(event))
    .flatMap((event) =>
      event.slug ? [buildEventSitemapRoute({ ...event, slug: event.slug })] : []
    );
}

export function buildSitemapEventQueries() {
  return [
    {
      params: new URLSearchParams({
        active: "true",
        closed: "false",
        archived: "false",
        order: "volume24hr",
        ascending: "false",
        limit: SITEMAP_PAGE_LIMIT,
      }),
      maxItems: SITEMAP_MAX_EVENTS,
    },
    {
      params: new URLSearchParams({
        closed: "true",
        archived: "false",
        order: "volume",
        ascending: "false",
        limit: SITEMAP_PAGE_LIMIT,
      }),
      maxItems: SITEMAP_MAX_RESOLVED_EVENTS,
    },
  ];
}

export function buildStaticSitemapRoutes(): MetadataRoute.Sitemap {
  const categoryRoutes = buildFallbackTags()
    .filter((tag) => tag.slug !== "sports")
    .map((tag) => ({ url: canonicalUrl(`/events/${tag.slug}`) }));

  const sportRoutes = SPORT_GROUPS.flatMap((group) => [
    { url: canonicalUrl(`/events/sports/${group.slug}`) },
    ...group.leagues.map((league) => ({
      url: canonicalUrl(`/events/sports/${league.slug}`),
    })),
  ]);

  return dedupeSitemapRoutes([
    { url: canonicalUrl() },
    { url: canonicalUrl("/markets") },
    { url: canonicalUrl("/leaderboard") },
    { url: canonicalUrl("/whales") },
    { url: canonicalUrl("/events/sports/live") },
    ...categoryRoutes,
    ...sportRoutes,
  ]);
}

type EventSitemapInput = {
  slug: string;
  updatedAt?: string;
  endDate?: string;
  startDate?: string;
};

export function buildEventSitemapRoute(
  event: EventSitemapInput
): MetadataRoute.Sitemap[number] {
  const lastModified = parseSitemapDate(event.updatedAt);

  return {
    url: canonicalUrl(buildEventDetailPath(event.slug, event.slug)),
    ...(lastModified ? { lastModified } : {}),
  };
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
