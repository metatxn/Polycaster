import { type NextRequest, NextResponse } from "next/server";
import { CACHE_DURATION, POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";

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
      next: { revalidate: CACHE_DURATION.EVENTS },
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
      throw new Error(
        `Gamma API error: ${eventResponse.status} ${eventResponse.statusText} - ${errorText}`
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
    let markets = [];

    // If the event has markets array, use it directly
    if (event.markets && Array.isArray(event.markets)) {
      markets = event.markets;
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
          next: { revalidate: CACHE_DURATION.MARKETS },
        });

        if (marketsResponse.ok) {
          markets = (await marketsResponse.json()) as Record<string, unknown>[];
        }
      } catch {
        // Continue with empty markets array
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
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
