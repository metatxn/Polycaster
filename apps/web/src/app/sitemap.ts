import type { MetadataRoute } from "next";
import { POLYMARKET_API } from "@/constants/polymarket";
import { fetchGammaKeysetPage } from "@/lib/gamma-keyset";
import { logger } from "@/lib/logger";

const SITEMAP_REVALIDATE_SECONDS = 3600;
const SITEMAP_PAGE_LIMIT = "100";

async function fetchAllKeysetItems<T>(
  endpoint: string,
  params: URLSearchParams,
  preferredKeys: Array<"data" | "events" | "markets">
): Promise<T[]> {
  const items: T[] = [];
  let nextCursor: string | undefined;
  const seenCursors = new Set<string>();

  while (true) {
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

  return items;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = "https://knoww.app";

  // Static routes
  const staticRoutes = ["", "/leaderboard"].map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: "hourly" as const,
    priority: route === "" ? 1 : 0.8,
  }));

  // Fetch active markets for dynamic routes
  let marketRoutes: MetadataRoute.Sitemap = [];
  try {
    const markets = await fetchAllKeysetItems<{ slug?: string }>(
      POLYMARKET_API.GAMMA.MARKETS_KEYSET,
      new URLSearchParams({
        closed: "false",
        limit: SITEMAP_PAGE_LIMIT,
      }),
      ["markets", "data"]
    );

    marketRoutes = markets
      .filter((m) => m.slug)
      .map((m) => ({
        url: `${baseUrl}/markets/${m.slug}`,
        lastModified: new Date(),
        changeFrequency: "hourly" as const,
        priority: 0.7,
      }));
  } catch (e) {
    logger.error("sitemap.markets.fetch_failed", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Fetch active events for dynamic routes
  let eventRoutes: MetadataRoute.Sitemap = [];
  try {
    const events = await fetchAllKeysetItems<{ slug?: string }>(
      POLYMARKET_API.GAMMA.EVENTS_KEYSET,
      new URLSearchParams({
        closed: "false",
        limit: SITEMAP_PAGE_LIMIT,
      }),
      ["events", "data"]
    );

    eventRoutes = events
      .filter((e) => e.slug)
      .map((e) => ({
        url: `${baseUrl}/events/detail/${e.slug}`,
        lastModified: new Date(),
        changeFrequency: "hourly" as const,
        priority: 0.6,
      }));
  } catch (e) {
    logger.error("sitemap.events.fetch_failed", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return [...staticRoutes, ...marketRoutes, ...eventRoutes];
}
