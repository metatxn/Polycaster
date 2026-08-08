import type { NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/api-rate-limit";
import {
  buildSitemapIndexUrls,
  renderSitemapIndexXml,
} from "@/lib/sitemap-routes";

// Next requires a statically analyzable literal here; keep in sync with
// SITEMAP_REVALIDATE_SECONDS in @/lib/sitemap-routes.
export const revalidate = 3600;

/** Sitemap index (§11.3) — the segment files live at /sitemaps/<segment>.xml. */
export function GET(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 120,
  });
  if (rateLimitResponse) return rateLimitResponse;

  return new Response(renderSitemapIndexXml(buildSitemapIndexUrls()), {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
