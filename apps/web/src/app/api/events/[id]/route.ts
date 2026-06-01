import { type NextRequest, NextResponse } from "next/server";
import { CACHE_DURATION, POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { logger } from "@/lib/logger";
import { sanitizeUpstreamBody } from "@/lib/upstream-error";

/**
 * Check if the identifier is a numeric event ID or a slug
 * Event IDs are numeric (e.g., 35908)
 * Slugs contain letters and hyphens (e.g., who-will-trump-nominate-as-fed-chair)
 */
function isNumericId(str: string): boolean {
  return /^\d+$/.test(str);
}

/**
 * GET /api/events/:id
 * Get event details by ID or slug including all associated markets (closed=false by default)
 *
 * Supports both:
 * - Numeric ID (e.g., 35908): Uses https://gamma-api.polymarket.com/events/{id}
 * - Event slug: Uses https://gamma-api.polymarket.com/events/slug/{slug}
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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
    const { id } = await params;
    const fresh = request.nextUrl.searchParams.get("fresh") === "1";

    if (!id) {
      return NextResponse.json(
        {
          success: false,
          error: "Event ID or slug is required",
        },
        { status: 400 }
      );
    }

    // Determine the correct API endpoint based on whether it's a numeric ID or slug
    // - Numeric ID (e.g., 35908): /events/{id}
    // - Slug (e.g., who-will-trump-win): /events/slug/{slug}
    const isEventId = isNumericId(id);
    const eventUrl = isEventId
      ? `${POLYMARKET_API.GAMMA.EVENTS}/${id}`
      : `${POLYMARKET_API.GAMMA.EVENTS}/slug/${id}`;

    // Fetch event details from Gamma API
    const eventResponse = await fetch(eventUrl, {
      headers: {
        "Content-Type": "application/json",
      },
      ...(fresh
        ? { cache: "no-store" as const }
        : { next: { revalidate: CACHE_DURATION.EVENTS } }),
    });

    if (!eventResponse.ok) {
      if (eventResponse.status === 404) {
        return NextResponse.json(
          {
            success: false,
            error: "Event not found",
          },
          { status: 404 }
        );
      }
      const errorText = await eventResponse.text();
      logger.warn("events.detail.gamma_failed", {
        id,
        status: eventResponse.status,
        statusText: eventResponse.statusText,
        body: sanitizeUpstreamBody(errorText),
      });
      return NextResponse.json(
        {
          success: false,
          error: "Failed to fetch event details",
        },
        { status: 502 }
      );
    }

    const event = (await eventResponse.json()) as Record<string, unknown>;

    if (!event) {
      return NextResponse.json(
        {
          success: false,
          error: "Event not found",
        },
        { status: 404 }
      );
    }

    // Fetch markets associated with this event
    // Markets are linked to events, so we need to fetch them separately
    let markets: Record<string, unknown>[] = [];

    // If the event has markets array, use it directly
    if (event.markets && Array.isArray(event.markets)) {
      markets = event.markets as Record<string, unknown>[];
    } else {
      // Otherwise, fetch markets by event slug or ID (always filter closed=false)
      const marketsUrl = `${POLYMARKET_API.GAMMA.MARKETS}?events_slug=${
        event.slug || id
      }&closed=false`;

      try {
        const marketsResponse = await fetch(marketsUrl, {
          headers: {
            "Content-Type": "application/json",
          },
          ...(fresh
            ? { cache: "no-store" as const }
            : { next: { revalidate: CACHE_DURATION.MARKETS } }),
        });

        if (marketsResponse.ok) {
          markets = (await marketsResponse.json()) as Record<string, unknown>[];
        }
      } catch (error) {
        logger.warn("events.detail.markets_fetch_failed", {
          id,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with empty markets array
      }
    }

    // Polymarket nests "Most Sixes" / "Top Batter" / "Toss Match Double" etc.
    // as separate negRisk child events linked back via `parentEventId`. The
    // standard `/events/slug/{slug}` payload does NOT include them, so the
    // detail page would silently drop those rows. Fan out to fetch the
    // children and append their markets to the response so the outcomes
    // table renders the full set.
    const eventId = typeof event.id === "string" ? event.id : null;
    if (eventId) {
      try {
        const childrenUrl = `${POLYMARKET_API.GAMMA.EVENTS}?parent_event_id=${eventId}&limit=50&closed=false`;
        const childrenResponse = await fetch(childrenUrl, {
          headers: { "Content-Type": "application/json" },
          ...(fresh
            ? { cache: "no-store" as const }
            : { next: { revalidate: CACHE_DURATION.EVENTS } }),
        });

        if (childrenResponse.ok) {
          const childEvents = (await childrenResponse.json()) as Array<
            Record<string, unknown>
          >;
          if (Array.isArray(childEvents)) {
            const seenMarketIds = new Set(
              markets
                .map((m) => (typeof m.id === "string" ? m.id : null))
                .filter((v): v is string => v !== null)
            );
            for (const child of childEvents) {
              const childMarkets = Array.isArray(child.markets)
                ? (child.markets as Record<string, unknown>[])
                : [];
              const childEventId =
                typeof child.id === "string"
                  ? child.id
                  : typeof child.id === "number"
                    ? String(child.id)
                    : null;
              for (const market of childMarkets) {
                const mid = typeof market.id === "string" ? market.id : null;
                if (mid && seenMarketIds.has(mid)) continue;
                if (mid) seenMarketIds.add(mid);
                markets.push({
                  ...market,
                  // Tag with the IMMEDIATE child event id (Most Sixes, Top
                  // Batter, …), not the grandparent event id. The UI groups
                  // negRisk siblings by this so each section maps to one
                  // child event — using the grandparent collapsed every
                  // negRisk market into a single nine-button row.
                  parentEventId: childEventId,
                  parentEventTitle: child.title,
                });
              }
            }
          }
        }
      } catch (error) {
        logger.warn("events.detail.children_fetch_failed", {
          id,
          error: error instanceof Error ? error.message : String(error),
        });
        // Children fan-out is best-effort; missing children should not fail
        // the parent event response.
      }
    }

    return NextResponse.json({
      success: true,
      event: {
        ...event,
        markets,
        marketCount: markets.length,
      },
    });
  } catch (error) {
    logger.error("events.detail.fetch_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch event details",
      },
      { status: 500 }
    );
  }
}
