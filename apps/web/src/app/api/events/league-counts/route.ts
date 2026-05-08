import { type NextRequest, NextResponse } from "next/server";
import { CACHE_DURATION, POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { fetchGammaKeysetPage } from "@/lib/gamma-keyset";
import { logger } from "@/lib/logger";
import { ALL_SPORTS_TAG_SLUG, SPORT_GROUPS } from "@/lib/sport-categories";
import {
  isCurrentSportsEvent,
  type SportsEventActivityCandidate,
} from "@/lib/sports-event-activity";

const COUNT_FETCH_CONCURRENCY = 6;
const COUNT_PAGE_LIMIT = 500;
const COUNT_MAX_PAGES = 100;

type CountFilter = {
  tagSlug: string;
  filterCurrentSchedule?: boolean;
  seriesId?: number;
};

const COUNT_FILTERS_BY_TAG_SLUG = (() => {
  const filters = new Map<string, CountFilter>([
    [ALL_SPORTS_TAG_SLUG, { tagSlug: ALL_SPORTS_TAG_SLUG }],
  ]);
  for (const group of SPORT_GROUPS) {
    filters.set(group.tagSlug, {
      tagSlug: group.tagSlug,
      filterCurrentSchedule: group.leagues.length === 0,
    });
    for (const league of group.leagues) {
      filters.set(league.tagSlug, {
        tagSlug: league.tagSlug,
        filterCurrentSchedule: true,
        seriesId: league.seriesId,
      });
    }
  }
  return filters;
})();

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * @openapi
 * /api/events/league-counts:
 *   get:
 *     summary: Get current open sports event counts by Gamma tag slug.
 *     description: Returns a count per allowlisted sports `tag_slug`, plus the live sports count. League entries with a configured `seriesId` are counted with Gamma `series_id` while preserving the response key as the requested tag slug, and stale completed sports schedules are excluded for league and single-sport entries. Rate limited by the shared API limiter with 60 unique tokens per interval.
 *     tags:
 *       - Events
 *     parameters:
 *       - in: query
 *         name: slug
 *         schema:
 *           type: array
 *           minItems: 1
 *           items:
 *             type: string
 *         style: form
 *         explode: true
 *         required: true
 *         description: Repeated allowlisted sports Gamma tag slugs from the configured sports category list.
 *     responses:
 *       200:
 *         description: League counts.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - sports
 *                 - live
 *                 - byTagSlug
 *               properties:
 *                 sports:
 *                   type: integer
 *                   minimum: 0
 *                 live:
 *                   type: integer
 *                   minimum: 0
 *                 byTagSlug:
 *                   type: object
 *                   additionalProperties:
 *                     type: integer
 *                     minimum: 0
 *       400:
 *         description: Missing or invalid slug list.
 *       429:
 *         description: Rate limit exceeded.
 *       500:
 *         description: Failed to load league counts.
 */
export async function GET(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const slugs = Array.from(
      new Set(
        request.nextUrl.searchParams
          .getAll("slug")
          .map((slug) => slug.trim().toLowerCase())
          .filter(Boolean)
      )
    );

    if (slugs.length === 0) {
      return NextResponse.json(
        { success: false, error: "At least one slug is required" },
        { status: 400 }
      );
    }

    if (slugs.length > COUNT_FILTERS_BY_TAG_SLUG.size) {
      return NextResponse.json(
        {
          success: false,
          error: `Maximum ${COUNT_FILTERS_BY_TAG_SLUG.size} slugs per request`,
        },
        { status: 400 }
      );
    }

    const invalidSlugs = slugs.filter(
      (slug) => !COUNT_FILTERS_BY_TAG_SLUG.has(slug)
    );
    if (invalidSlugs.length > 0) {
      return NextResponse.json(
        { success: false, error: "One or more slugs are not supported" },
        { status: 400 }
      );
    }

    const counts = await mapWithConcurrency(
      slugs,
      COUNT_FETCH_CONCURRENCY,
      (slug) => fetchCount(COUNT_FILTERS_BY_TAG_SLUG.get(slug), false)
    );
    const liveCount = await fetchCount(
      COUNT_FILTERS_BY_TAG_SLUG.get(ALL_SPORTS_TAG_SLUG),
      true
    );

    const byTagSlug: Record<string, number> = {};
    let sportsTotal = 0;
    for (let i = 0; i < slugs.length; i += 1) {
      byTagSlug[slugs[i]] = counts[i];
      if (slugs[i] === ALL_SPORTS_TAG_SLUG) sportsTotal = counts[i];
    }

    return NextResponse.json(
      {
        sports: sportsTotal,
        live: liveCount,
        byTagSlug,
      },
      {
        headers: {
          "Cache-Control": `public, s-maxage=${CACHE_DURATION.EVENTS}, stale-while-revalidate=${CACHE_DURATION.EVENTS * 2}`,
        },
      }
    );
  } catch (error) {
    logger.error("events.league_counts.fetch_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        success: false,
        error: "Failed to load league counts",
      },
      { status: 500 }
    );
  }
}

async function fetchCount(
  filter: CountFilter | undefined,
  liveOnly: boolean
): Promise<number> {
  if (!filter) return 0;

  const nowMs = Date.now();
  const shouldFilterCurrentSchedule = filter.filterCurrentSchedule === true;
  const baseParams = new URLSearchParams({
    closed: "false",
    active: "true",
    limit: String(COUNT_PAGE_LIMIT),
  });
  if (filter.seriesId !== undefined) {
    baseParams.set("series_id", String(filter.seriesId));
  } else {
    baseParams.set("tag_slug", filter.tagSlug);
  }
  if (liveOnly) baseParams.set("live", "true");

  let total = 0;
  let afterCursor: string | undefined;

  try {
    for (let pageIndex = 0; pageIndex < COUNT_MAX_PAGES; pageIndex += 1) {
      const params = new URLSearchParams(baseParams);
      if (afterCursor) params.set("after_cursor", afterCursor);

      const page = await fetchGammaKeysetPage<SportsEventActivityCandidate>(
        {
          endpoint: POLYMARKET_API.GAMMA.EVENTS_KEYSET,
          params,
          revalidate: CACHE_DURATION.EVENTS,
        },
        ["events", "data"]
      );

      if (page.totalResults !== undefined && !shouldFilterCurrentSchedule) {
        return page.totalResults;
      }

      total += shouldFilterCurrentSchedule
        ? page.items.filter((event) => isCurrentSportsEvent(event, nowMs))
            .length
        : page.items.length;
      if (!page.nextCursor) return total;
      afterCursor = page.nextCursor;
    }

    logger.warn("events.league_counts.page_limit_reached", {
      tagSlug: filter.tagSlug,
      seriesId: filter.seriesId,
      liveOnly,
      pages: COUNT_MAX_PAGES,
      counted: total,
    });
    return total;
  } catch (error) {
    logger.warn("events.league_counts.gamma_failed", {
      tagSlug: filter.tagSlug,
      seriesId: filter.seriesId,
      liveOnly,
      error: error instanceof Error ? error.message : String(error),
    });
    return 0;
  }
}
