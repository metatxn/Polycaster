import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CACHE_DURATION, POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { getCacheHeaders } from "@/lib/cache-headers";
import { fetchGammaKeysetPage, resolveGammaTagId } from "@/lib/gamma-keyset";
import { logger } from "@/lib/logger";

const marketsSchema = z.object({
  sport: z.string().nullable().optional(),
  league: z.string().nullable().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  after_cursor: z.string().optional(),
});

/**
 * GET /api/sports/markets
 * Get sports markets filtered by sport/league tag slug.
 */
/**
 * @openapi
 * /api/sports/markets:
 *   get:
 *     summary: Fetch /api/sports/markets.
 *     tags: [Sports]
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
    uniqueTokenPerInterval: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const searchParams = request.nextUrl.searchParams;
    const sport = searchParams.get("sport");
    const league = searchParams.get("league");
    const limit = searchParams.get("limit") || "20";
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

    const parsed = marketsSchema.safeParse({
      sport,
      league,
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
      sport: parsedSport,
      league: parsedLeague,
      limit: parsedLimit,
    } = parsed.data;
    const tagSlug = parsedLeague || parsedSport;

    const queryParams = new URLSearchParams();
    queryParams.set("limit", String(parsedLimit));
    queryParams.set("closed", "false");
    queryParams.set("order", "createdAt");
    queryParams.set("ascending", "false");

    if (afterCursor) {
      queryParams.set("after_cursor", afterCursor);
    }

    if (tagSlug) {
      const tagId = await resolveGammaTagId(
        tagSlug,
        CACHE_DURATION.SPORTS_LIST
      );
      if (!tagId) {
        return NextResponse.json(
          {
            success: true,
            count: 0,
            markets: [],
            filters: {
              sport: parsedSport || "all",
              league: parsedLeague || "all",
              tag: tagSlug,
            },
            pagination: {
              hasMore: false,
            },
          },
          { headers: getCacheHeaders("events") }
        );
      }

      queryParams.set("tag_id", tagId);
    }

    const page = await fetchGammaKeysetPage<Record<string, unknown>>(
      {
        endpoint: POLYMARKET_API.GAMMA.MARKETS_KEYSET,
        params: queryParams,
        revalidate: 60,
      },
      ["markets", "data"]
    );

    return NextResponse.json(
      {
        success: true,
        count: page.items.length,
        markets: page.items,
        filters: {
          sport: parsedSport || "all",
          league: parsedLeague || "all",
          tag: tagSlug || "all",
        },
        pagination: {
          hasMore: Boolean(page.nextCursor),
          nextCursor: page.nextCursor,
        },
      },
      { headers: getCacheHeaders("events") }
    );
  } catch (error) {
    logger.error("sports.markets.fetch_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch sports markets",
      },
      { status: 500 }
    );
  }
}
