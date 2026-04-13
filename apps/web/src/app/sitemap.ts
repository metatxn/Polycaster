import type { MetadataRoute } from "next";
import { POLYMARKET_API } from "@/constants/polymarket";
import { fetchGammaKeysetPage } from "@/lib/gamma-keyset";
import { logger } from "@/lib/logger";

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
    const page = await fetchGammaKeysetPage<{ slug?: string }>(
      {
        endpoint: POLYMARKET_API.GAMMA.MARKETS_KEYSET,
        params: new URLSearchParams({
          closed: "false",
          limit: "100",
        }),
        revalidate: 3600,
      },
      ["markets", "data"]
    );

    marketRoutes = page.items
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
    const page = await fetchGammaKeysetPage<{ slug?: string }>(
      {
        endpoint: POLYMARKET_API.GAMMA.EVENTS_KEYSET,
        params: new URLSearchParams({
          closed: "false",
          limit: "100",
        }),
        revalidate: 3600,
      },
      ["events", "data"]
    );

    eventRoutes = page.items
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
