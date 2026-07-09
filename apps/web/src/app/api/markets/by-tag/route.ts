import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CACHE_DURATION, POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { fetchGammaKeysetPage } from "@/lib/gamma-keyset";
import { logger } from "@/lib/logger";

const marketsByTagSchema = z.object({
  tag_id: z.string().min(1),
  closed: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  after_cursor: z.string().optional(),
});

/**
 * GET /api/markets/by-tag
 * Get markets filtered by tag_id (closed defaults to false).
 */
/**
 * @openapi
 * /api/markets/by-tag:
 *   get:
 *     summary: Fetch /api/markets/by-tag.
 *     tags: [Markets]
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
  const rateLimitResponse = checkRateLimit(request, {
    interval: 60 * 1000,
    uniqueTokenPerInterval: 100,
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const tag_id = searchParams.get("tag_id");
    const closed = searchParams.get("closed") || "false";
    const limit = searchParams.get("limit") || "50";
    const afterCursor = searchParams.get("after_cursor") || undefined;

    if (searchParams.has("offset")) {
      return NextResponse.json(
        {
          success: false,
          error: "offset is no longer supported; use after_cursor",
        },
        { status: 400 }
      );
    }

    if (!tag_id) {
      return NextResponse.json(
        {
          success: false,
          error: "tag_id is required",
        },
        { status: 400 }
      );
    }

    const parsed = marketsByTagSchema.safeParse({
      tag_id,
      closed,
      limit,
      after_cursor: afterCursor,
    });

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid query parameters",
        },
        { status: 400 }
      );
    }

    const {
      tag_id: parsedTagId,
      closed: parsedClosed,
      limit: parsedLimit,
    } = parsed.data;

    const queryParams = new URLSearchParams();
    queryParams.set("tag_id", parsedTagId);
    queryParams.set("limit", String(parsedLimit));
    queryParams.set("closed", parsedClosed || "false");
    queryParams.set("order", "createdAt");
    queryParams.set("ascending", "false");
    if (afterCursor) {
      queryParams.set("after_cursor", afterCursor);
    }

    const page = await fetchGammaKeysetPage<Record<string, unknown>>(
      {
        endpoint: POLYMARKET_API.GAMMA.MARKETS_KEYSET,
        params: queryParams,
        revalidate: CACHE_DURATION.MARKETS,
      },
      ["markets", "data"]
    );

    return NextResponse.json({
      success: true,
      count: page.items.length,
      markets: page.items,
      tag_id: parsedTagId,
      pagination: {
        hasMore: Boolean(page.nextCursor),
        nextCursor: page.nextCursor,
      },
    });
  } catch (error) {
    logger.error("markets.by_tag.fetch_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch markets",
      },
      { status: 500 }
    );
  }
}
