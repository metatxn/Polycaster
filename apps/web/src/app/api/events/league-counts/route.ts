import { getCloudflareContext } from "@opennextjs/cloudflare";
import { type NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/api-rate-limit";
import {
  getLeagueCountSnapshot,
  isKnownCountTagSlug,
  knownCountTagSlugCount,
  LIVE_STALE_KEY,
} from "@/lib/league-count-snapshot";
import { logger } from "@/lib/logger";

/**
 * Served entirely from the canonical league-count snapshot — the request
 * path downloads no Gamma keyset pages and performs no JSON scanning.
 * Short edge TTL: the snapshot refreshes every ~30s, so a longer TTL would
 * only add staleness on top, and per-slug-combination keys make long TTLs
 * ineffective anyway.
 */
const EDGE_CACHE_SECONDS = 15;

/**
 * Keep the snapshot refresh alive past the response on Cloudflare Workers.
 * Outside a Cloudflare request context (vitest, plain node) the refresh
 * runs inline instead.
 */
function getWaitUntil(): ((promise: Promise<unknown>) => void) | undefined {
  try {
    const { ctx } = getCloudflareContext();
    return ctx.waitUntil.bind(ctx);
  } catch {
    return undefined;
  }
}

/**
 * @openapi
 * /api/events/league-counts:
 *   get:
 *     summary: Get current open sports event counts by Gamma tag slug.
 *     description: Serves counts from a canonical snapshot built from Gamma `/events/pagination` totals (one `limit=1` call per taxonomy filter). League entries with a configured `seriesId` are counted with Gamma `series_id` while preserving the response key as the requested tag slug, and league baselines are bounded with `start_time_min = now - 8h`. On upstream failure the last valid value is served and flagged in `meta.staleKeys`; a count is never silently reported as zero. Rate limited by the shared API limiter with 60 unique tokens per interval.
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
 *                   nullable: true
 *                   description: Total open sports events; null only if the total has never been fetched successfully.
 *                 live:
 *                   type: integer
 *                   minimum: 0
 *                   nullable: true
 *                   description: Gamma live-baseline count for the WebSocket badge bootstrap; null only if never fetched successfully.
 *                 byTagSlug:
 *                   type: object
 *                   additionalProperties:
 *                     type: integer
 *                     minimum: 0
 *                   description: Counts for the requested slugs. A requested slug with no successful count yet is omitted rather than reported as zero.
 *                 meta:
 *                   type: object
 *                   properties:
 *                     generatedAt:
 *                       type: string
 *                       format: date-time
 *                       description: When the serving snapshot's refresh attempt started (drives the 30s cadence).
 *                     lastSuccessAt:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *                       description: Last refresh in which every filter succeeded; values in staleKeys are no fresher than this. Null until one full success.
 *                     ageSeconds:
 *                       type: integer
 *                       minimum: 0
 *                     staleKeys:
 *                       type: array
 *                       items:
 *                         type: string
 *                       description: Requested keys (plus "live") whose latest refresh failed and are serving carried-forward values.
 *       400:
 *         description: Missing or invalid slug list.
 *       429:
 *         description: Rate limit exceeded.
 *       503:
 *         description: No snapshot available yet (cold start with Gamma unreachable).
 */
export async function GET(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

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

  if (slugs.length > knownCountTagSlugCount()) {
    return NextResponse.json(
      {
        success: false,
        error: `Maximum ${knownCountTagSlugCount()} slugs per request`,
      },
      { status: 400 }
    );
  }

  if (slugs.some((slug) => !isKnownCountTagSlug(slug))) {
    return NextResponse.json(
      { success: false, error: "One or more slugs are not supported" },
      { status: 400 }
    );
  }

  const { snapshot, source, ageMs } = await getLeagueCountSnapshot({
    waitUntil: getWaitUntil(),
  });

  if (!snapshot) {
    logger.error("events.league_counts.no_snapshot_available", {
      slugs: slugs.length,
    });
    return NextResponse.json(
      { success: false, error: "League counts temporarily unavailable" },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }

  const byTagSlug: Record<string, number> = {};
  for (const slug of slugs) {
    const count = snapshot.byTagSlug[slug];
    if (count !== undefined) byTagSlug[slug] = count;
  }

  const staleKeys = snapshot.staleKeys.filter(
    (key) => key === LIVE_STALE_KEY || slugs.includes(key)
  );

  logger.info("events.league_counts.served", {
    slugs: slugs.length,
    source,
    snapshotAgeMs: ageMs,
    stale: staleKeys.length,
  });

  return NextResponse.json(
    {
      sports: snapshot.sports,
      live: snapshot.live,
      byTagSlug,
      meta: {
        generatedAt: snapshot.generatedAt,
        lastSuccessAt: snapshot.lastSuccessAt,
        ageSeconds: ageMs === null ? null : Math.round(ageMs / 1000),
        staleKeys,
      },
    },
    {
      headers: {
        "Cache-Control": `public, s-maxage=${EDGE_CACHE_SECONDS}, stale-while-revalidate=${EDGE_CACHE_SECONDS * 2}`,
      },
    }
  );
}
