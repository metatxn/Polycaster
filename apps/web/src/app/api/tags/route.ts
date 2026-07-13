import { type NextRequest, NextResponse } from "next/server";
import { CACHE_DURATION, POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { getCacheHeaders } from "@/lib/cache-headers";
import { logger } from "@/lib/logger";
import { buildFallbackTags, normalizeTagRecord } from "@/lib/tag-slugs";

const FALLBACK_TAGS = buildFallbackTags();

/**
 * GET /api/tags
 * Get all available tags/categories
 *
 * Query params:
 * - limit: Number of results (optional)
 */
/**
 * @openapi
 * /api/tags:
 *   get:
 *     summary: Fetch /api/tags.
 *     tags: [Tags]
 *     responses:
 *       200:
 *         description: Successful response.
 *       400:
 *         description: Invalid request.
 *       401:
 *         description: Authentication required.
 *       403:
 *         description: Request forbidden.
 *       404:
 *         description: Resource not found.
 *       429:
 *         description: Rate limit exceeded.
 *       500:
 *         description: Request failed.
 */
export async function GET(request: NextRequest) {
  // Rate limit: 60 requests per minute
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = searchParams.get("limit");

    const queryParams = new URLSearchParams();
    if (limit) {
      queryParams.set("limit", limit);
    }

    const url = queryParams.toString()
      ? `${POLYMARKET_API.GAMMA.BASE}/tags?${queryParams.toString()}`
      : `${POLYMARKET_API.GAMMA.BASE}/tags?order=updatedAt`;

    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
      },
      next: { revalidate: CACHE_DURATION.SPORTS_LIST }, // Cache for 1 hour
    });

    if (!response.ok) {
      logger.warn("tags.list.upstream_unavailable", {
        status: response.status,
        statusText: response.statusText,
      });
      // Use fallback tags if endpoint doesn't exist
      return NextResponse.json(
        {
          success: true,
          count: FALLBACK_TAGS.length,
          tags: FALLBACK_TAGS,
          fallback: true,
        },
        { headers: getCacheHeaders("static") }
      );
    }

    const data = (await response.json()) as unknown[];
    const normalizedTags = Array.isArray(data)
      ? Array.from(
          new Map(
            data
              .map((tag) => normalizeTagRecord(tag as Record<string, unknown>))
              .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag))
              .map((tag) => [tag.slug, tag])
          ).values()
        )
      : [];

    // If data is empty or invalid, use fallback
    if (normalizedTags.length === 0) {
      logger.warn("tags.list.empty_payload");
      return NextResponse.json(
        {
          success: true,
          count: FALLBACK_TAGS.length,
          tags: FALLBACK_TAGS,
          fallback: true,
        },
        { headers: getCacheHeaders("static") }
      );
    }

    // Tags are static data - cache for longer at edge
    return NextResponse.json(
      {
        success: true,
        count: normalizedTags.length,
        tags: normalizedTags,
        fallback: false,
      },
      { headers: getCacheHeaders("static") }
    );
  } catch (error) {
    logger.error("tags.list.fetch_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    // Return fallback tags instead of error
    return NextResponse.json(
      {
        success: true,
        count: FALLBACK_TAGS.length,
        tags: FALLBACK_TAGS,
        fallback: true,
      },
      { headers: getCacheHeaders("static") }
    );
  }
}
