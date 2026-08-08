import type { NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { logger } from "@/lib/logger";
import {
  buildGuideSitemapRoutes,
  buildStaticSitemapRoutes,
  getCachedCategorySitemapRoutes,
  getCachedEvergreenSitemapEventRoutes,
  getCachedSitemapEventRoutes,
  renderUrlSetXml,
  type SitemapRoute,
} from "@/lib/sitemap-routes";

// Next requires a statically analyzable literal here; keep in sync with
// SITEMAP_REVALIDATE_SECONDS in @/lib/sitemap-routes.
export const revalidate = 3600;

/**
 * Segment sitemaps referenced by the /sitemap.xml index (§11.3). URLs look
 * like /sitemaps/static.xml — the .xml suffix is required so crawlers treat
 * the response as a sitemap file, and unknown segments 404.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ segment: string }> }
) {
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 120,
  });
  if (rateLimitResponse) return rateLimitResponse;

  const { segment } = await params;
  if (!segment.endsWith(".xml")) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const routes = await buildSegmentRoutes(segment.slice(0, -".xml".length));
    if (!routes) {
      return new Response("Not found", { status: 404 });
    }

    return new Response(renderUrlSetXml(routes), {
      headers: { "Content-Type": "application/xml; charset=utf-8" },
    });
  } catch (error) {
    logger.error("sitemap.segment.render_failed", {
      segment,
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response("Sitemap temporarily unavailable", {
      status: 503,
      headers: { "Retry-After": "300" },
    });
  }
}

async function buildSegmentRoutes(
  segment: string
): Promise<SitemapRoute[] | null> {
  switch (segment) {
    case "static":
      return buildStaticSitemapRoutes();
    case "categories":
      return await getCachedCategorySitemapRoutes();
    case "markets":
      return await getCachedSitemapEventRoutes();
    case "evergreen-markets":
      return await getCachedEvergreenSitemapEventRoutes();
    case "guides":
      return buildGuideSitemapRoutes();
    default:
      return null;
  }
}
