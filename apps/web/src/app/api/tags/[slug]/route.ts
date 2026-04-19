import { type NextRequest, NextResponse } from "next/server";
import { CACHE_DURATION, POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { getCacheHeaders } from "@/lib/cache-headers";
import { logger } from "@/lib/logger";
import { normalizeTagRecord, normalizeTagSlug } from "@/lib/tag-slugs";

/**
 * GET /api/tags/:slug
 * Get tag details by slug (e.g., "sports", "politics", "dating")
 * This returns the tag ID needed to fetch markets
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  // Apply rate limiting: 100 requests per minute
  const rateLimitResponse = checkRateLimit(request, {
    interval: 60 * 1000,
    uniqueTokenPerInterval: 100,
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }
  try {
    const { slug } = await params;
    const canonicalSlug = normalizeTagSlug(slug);

    if (!slug) {
      return NextResponse.json(
        {
          success: false,
          error: "Tag slug is required",
        },
        { status: 400 }
      );
    }

    // Fetch tag details from Gamma API
    const response = await fetch(
      `${POLYMARKET_API.GAMMA.BASE}/tags/slug/${encodeURIComponent(canonicalSlug)}`,
      {
        headers: {
          "Content-Type": "application/json",
        },
        next: { revalidate: CACHE_DURATION.SPORTS_LIST }, // Cache for 1 hour
      }
    );

    if (!response.ok) {
      logger.warn("tags.detail.not_found", {
        requestedSlug: slug,
        canonicalSlug,
        status: response.status,
        statusText: response.statusText,
      });
      return NextResponse.json(
        {
          success: false,
          error: `Tag not found: ${canonicalSlug}`,
        },
        { status: response.status }
      );
    }

    const normalizedTag = normalizeTagRecord(
      (await response.json()) as Record<string, unknown>
    );

    if (!normalizedTag?.slug) {
      return NextResponse.json(
        {
          success: false,
          error: `Tag not found: ${canonicalSlug}`,
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        tag: normalizedTag,
      },
      { headers: getCacheHeaders("static") }
    );
  } catch (error) {
    logger.error("tags.detail.fetch_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        success: false,
        error: "Unable to load tag details",
      },
      { status: 500 }
    );
  }
}
