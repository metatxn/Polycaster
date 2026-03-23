import type { MetadataRoute } from "next";
import { POLYMARKET_API } from "@/constants/polymarket";

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
    const res = await fetch(
      `${POLYMARKET_API.GAMMA.MARKETS}?closed=false&limit=100`,
      {
        next: { revalidate: 3600 }, // Cache for 1 hour
      }
    );
    if (res.ok) {
      const markets = (await res.json()) as { slug?: string }[];
      marketRoutes = markets
        .filter((m) => m.slug)
        .map((m) => ({
          url: `${baseUrl}/markets/${m.slug}`,
          lastModified: new Date(),
          changeFrequency: "hourly" as const,
          priority: 0.7,
        }));
    }
  } catch (e) {
    console.error("Failed to fetch markets for sitemap:", e);
  }

  // Fetch active events for dynamic routes
  let eventRoutes: MetadataRoute.Sitemap = [];
  try {
    const res = await fetch(
      `${POLYMARKET_API.GAMMA.EVENTS}?closed=false&limit=100`,
      {
        next: { revalidate: 3600 },
      }
    );
    if (res.ok) {
      const events = (await res.json()) as { slug?: string }[];
      eventRoutes = events
        .filter((e) => e.slug)
        .map((e) => ({
          url: `${baseUrl}/events/detail/${e.slug}`,
          lastModified: new Date(),
          changeFrequency: "hourly" as const,
          priority: 0.6,
        }));
    }
  } catch (e) {
    console.error("Failed to fetch events for sitemap:", e);
  }

  return [...staticRoutes, ...marketRoutes, ...eventRoutes];
}
