import { unstable_cache } from "next/cache";
import { POLYMARKET_API } from "@/constants/polymarket";
import { fetchGammaKeysetPage } from "@/lib/gamma-keyset";
import { GUIDES } from "@/lib/guides";
import { getLeagueCountSnapshot } from "@/lib/league-count-snapshot";
import { logger } from "@/lib/logger";
import {
  buildEventDetailPath,
  canonicalUrl,
  getEventSeoStatus,
  shouldListEventInSitemap,
} from "@/lib/seo";
import { ALL_SPORTS_TAG_SLUG, SPORT_GROUPS } from "@/lib/sport-categories";
import { buildFallbackTags } from "@/lib/tag-slugs";

/**
 * Shared logic for the segmented sitemap (§11.3): /sitemap.xml is a sitemap
 * index pointing at per-segment files under /sitemaps/<segment>.xml, so a
 * slow markets fetch never delays the static entries and search consoles
 * report indexing per segment.
 */
export const SITEMAP_SEGMENTS = [
  "static",
  "categories",
  "markets",
  "evergreen-markets",
  "guides",
] as const;

export type SitemapSegment = (typeof SITEMAP_SEGMENTS)[number];

export type SitemapRoute = {
  url: string;
  lastModified?: string | Date;
};

export const SITEMAP_REVALIDATE_SECONDS = 3600;
const SITEMAP_PAGE_LIMIT = "100";
// Keep the sitemap focused on canonical, high-value URLs. The app can browse
// the full catalog, but SEO should not ask crawlers to revisit thousands of
// low-volume or duplicate market detail URLs every hour.
const SITEMAP_MAX_EVENTS = 1000;
const EVERGREEN_SITEMAP_MAX_EVENTS = 500;

export type SitemapMarketKind = "active" | "evergreen";

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

export const getCachedSitemapEventRoutes = unstable_cache(
  () => fetchSitemapEventRoutes("active"),
  ["knoww-sitemap-event-routes-v5"],
  { revalidate: SITEMAP_REVALIDATE_SECONDS }
);

export const getCachedEvergreenSitemapEventRoutes = unstable_cache(
  () => fetchSitemapEventRoutes("evergreen"),
  ["knoww-sitemap-evergreen-event-routes-v2"],
  { revalidate: SITEMAP_REVALIDATE_SECONDS }
);

export async function fetchSitemapEventRoutes(kind: SitemapMarketKind) {
  try {
    const queryResults = await Promise.all(
      buildSitemapEventQueries(kind).map((query) =>
        fetchAllKeysetItems<SitemapEvent, SitemapRoute>(
          POLYMARKET_API.GAMMA.EVENTS_KEYSET,
          query.params,
          ["events", "data"],
          query.maxItems,
          (events) => buildEventSitemapRoutes(events, kind)
        )
      )
    );

    return dedupeSitemapRoutes(queryResults.flat());
  } catch (error) {
    logger.error("sitemap.events.fetch_failed", {
      kind,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export function buildEventSitemapRoutes(
  events: SitemapEvent[],
  kind: SitemapMarketKind = "active"
): SitemapRoute[] {
  return events
    .filter((event) => {
      if (!shouldListEventInSitemap(event)) {
        return false;
      }
      const status = getEventSeoStatus(event);
      return kind === "active" ? status === "live" : status === "resolved";
    })
    .flatMap((event) =>
      event.slug ? [buildEventSitemapRoute({ ...event, slug: event.slug })] : []
    );
}

export function buildSitemapEventQueries(kind: SitemapMarketKind = "active") {
  if (kind === "evergreen") {
    return [
      {
        params: new URLSearchParams({
          closed: "true",
          archived: "false",
          order: "volume",
          ascending: "false",
          limit: SITEMAP_PAGE_LIMIT,
        }),
        maxItems: EVERGREEN_SITEMAP_MAX_EVENTS,
      },
    ];
  }

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
  ];
}

export function buildStaticSitemapRoutes(): SitemapRoute[] {
  return dedupeSitemapRoutes([
    { url: canonicalUrl() },
    { url: canonicalUrl("/markets") },
    { url: canonicalUrl("/extension") },
    { url: canonicalUrl("/leaderboard") },
    { url: canonicalUrl("/whales") },
    { url: canonicalUrl("/about") },
    { url: canonicalUrl("/how-knoww-works") },
    { url: canonicalUrl("/privacy") },
    { url: canonicalUrl("/terms") },
  ]);
}

export function buildCategorySitemapRoutes(
  sportCounts: Readonly<Record<string, number>>
): SitemapRoute[] {
  const categoryRoutes = buildFallbackTags()
    .filter((tag) => tag.slug !== "sports")
    .map((tag) => ({ url: canonicalUrl(`/events/${tag.slug}`) }));

  const sportRoutes = SPORT_GROUPS.flatMap((group) => [
    ...(sportCounts[group.tagSlug] > 0
      ? [{ url: canonicalUrl(`/events/sports/${group.slug}`) }]
      : []),
    ...group.leagues.flatMap((league) =>
      sportCounts[league.tagSlug] > 0
        ? [{ url: canonicalUrl(`/events/sports/${league.slug}`) }]
        : []
    ),
  ]);

  return dedupeSitemapRoutes([
    ...(sportCounts[ALL_SPORTS_TAG_SLUG] > 0
      ? [{ url: canonicalUrl("/events/sports/live") }]
      : []),
    ...categoryRoutes,
    ...sportRoutes,
  ]);
}

export const getCachedCategorySitemapRoutes = unstable_cache(
  fetchCategorySitemapRoutes,
  ["knoww-sitemap-category-routes-v1"],
  { revalidate: SITEMAP_REVALIDATE_SECONDS }
);

export async function fetchCategorySitemapRoutes(): Promise<SitemapRoute[]> {
  const { snapshot } = await getLeagueCountSnapshot();
  if (!snapshot) {
    throw new Error("Sports inventory snapshot is unavailable");
  }

  const requiredTagSlugs = new Set([
    ALL_SPORTS_TAG_SLUG,
    ...SPORT_GROUPS.flatMap((group) => [
      group.tagSlug,
      ...group.leagues.map((league) => league.tagSlug),
    ]),
  ]);
  const missingTagSlugs = Array.from(requiredTagSlugs).filter(
    (tagSlug) => snapshot.byTagSlug[tagSlug] === undefined
  );
  if (missingTagSlugs.length > 0) {
    logger.error("sitemap.categories.inventory_incomplete", {
      missingCount: missingTagSlugs.length,
    });
    throw new Error("Sports inventory snapshot is incomplete");
  }

  return buildCategorySitemapRoutes(snapshot.byTagSlug);
}

export function buildGuideSitemapRoutes(): SitemapRoute[] {
  return dedupeSitemapRoutes([
    { url: canonicalUrl("/guides") },
    ...GUIDES.map((guide) => ({
      url: canonicalUrl(`/guides/${guide.slug}`),
      lastModified: guide.dateModified,
    })),
  ]);
}

type EventSitemapInput = {
  slug: string;
  updatedAt?: string;
  endDate?: string;
  startDate?: string;
};

export function buildEventSitemapRoute(event: EventSitemapInput): SitemapRoute {
  // Gamma's updatedAt tracks volatile market activity rather than meaningful
  // page-content edits. Omit lastmod until an editorial timestamp is available.
  return {
    url: canonicalUrl(buildEventDetailPath(event.slug, event.slug)),
  };
}

export function dedupeSitemapRoutes(routes: SitemapRoute[]): SitemapRoute[] {
  const seenUrls = new Set<string>();

  return routes.filter((route) => {
    if (seenUrls.has(route.url)) {
      return false;
    }

    seenUrls.add(route.url);
    return true;
  });
}

export function buildSitemapIndexUrls(): string[] {
  return SITEMAP_SEGMENTS.map((segment) =>
    canonicalUrl(`/sitemaps/${segment}.xml`)
  );
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatLastModified(value: string | Date): string | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function renderUrlSetXml(routes: SitemapRoute[]): string {
  const entries = routes
    .map((route) => {
      const lastModified = route.lastModified
        ? formatLastModified(route.lastModified)
        : null;
      const lastModifiedTag = lastModified
        ? `<lastmod>${escapeXml(lastModified)}</lastmod>`
        : "";

      return `<url><loc>${escapeXml(route.url)}</loc>${lastModifiedTag}</url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

// Index entries deliberately carry no <lastmod> (§11.5): a fresh index date on
// every request would tell crawlers the segments changed when they did not.
export function renderSitemapIndexXml(sitemapUrls: string[]): string {
  const entries = sitemapUrls
    .map((url) => `<sitemap><loc>${escapeXml(url)}</loc></sitemap>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>\n`;
}
