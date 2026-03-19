import { type NextRequest, NextResponse } from "next/server";
import { POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { getCacheHeaders } from "@/lib/cache-headers";
import type {
  GammaEvent,
  GammaEventsResponse,
  GammaMarket,
  GammaTag,
} from "@/types/gamma-api";

/**
 * GET /api/events/trending
 * Get trending events sorted by volume (highest volume first)
 * Uses the pagination endpoint for infinite scroll support
 */
export async function GET(request: NextRequest) {
  // Apply rate limiting: 100 requests per minute
  const rateLimitResponse = checkRateLimit(request, {
    interval: 60 * 1000,
    uniqueTokenPerInterval: 100,
  });
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = searchParams.get("limit") || "15";
    const offset = searchParams.get("offset") || "0";

    // Extract filter parameters explicitly
    const volume24hrMin = searchParams.get("volume24hr_min");
    const volume1wkMin = searchParams.get("volume1wk_min");
    const liquidityMin = searchParams.get("liquidity_min");
    const competitiveMin = searchParams.get("competitive_min");
    const tagSlug = searchParams.get("tag_slug");
    const active = searchParams.get("active");
    const archived = searchParams.get("archived");
    const closed = searchParams.get("closed");

    // Build query params with explicit parameters only
    const queryParams = new URLSearchParams();

    // Set base parameters
    queryParams.set("limit", limit);
    queryParams.set("offset", offset);
    queryParams.set("active", active || "true");
    queryParams.set("archived", archived || "false");
    queryParams.set("closed", closed || "false");
    queryParams.set("order", "volume"); // Sort by volume (most traded)
    queryParams.set("ascending", "false"); // Highest volume first

    // Exclude crypto up/down spam markets
    queryParams.append("exclude_tag_id", "100639");
    queryParams.append("exclude_tag_id", "102169");

    // Map internal filter names to Gamma API names
    if (volume24hrMin) {
      queryParams.set("volume_min", volume24hrMin);
    }
    if (volume1wkMin) {
      queryParams.set("volume_min", volume1wkMin);
    }
    if (liquidityMin) {
      queryParams.set("liquidity_min", liquidityMin);
    }
    if (competitiveMin) {
      queryParams.set("competitive_min", competitiveMin);
    }
    if (tagSlug) {
      queryParams.set("tag_slug", tagSlug);
    }

    const response = await fetch(
      `${POLYMARKET_API.GAMMA.EVENTS_PAGINATION}?${queryParams.toString()}`,
      {
        headers: {
          "Content-Type": "application/json",
        },
        next: { revalidate: 60 }, // Cache for 1 minute
      }
    );

    if (!response.ok) {
      throw new Error(`Gamma API error: ${response.statusText}`);
    }

    const data = (await response.json()) as GammaEventsResponse;

    // Performance Optimization: Strip down event objects to only the fields needed by the UI
    const slimData = data.data.map((event: GammaEvent) => ({
      id: event.id,
      slug: event.slug,
      title: event.title,
      description: event.description,
      image: event.image,
      volume: event.volume,
      volume24hr: event.volume24hr,
      volume1wk: event.volume1wk,
      volume1mo: event.volume1mo,
      volume1yr: event.volume1yr,
      liquidity: event.liquidity,
      liquidityClob: event.liquidityClob,
      active: event.active,
      closed: event.closed,
      live: event.live,
      ended: event.ended,
      competitive: event.competitive,
      negRisk: event.enableNegRisk || event.negRiskAugmented,
      startDate: event.startDate,
      endDate: event.endDate,
      markets: event.markets?.map((m: GammaMarket) => ({ id: m.id })),
      tags: event.tags?.map((t: GammaTag | string) =>
        typeof t === "string" ? t : { id: t.id, slug: t.slug, label: t.label }
      ),
    }));

    // Return with cache headers for Cloudflare edge caching
    return NextResponse.json(
      {
        success: true,
        data: slimData,
        pagination: data.pagination,
      },
      { headers: getCacheHeaders("events") }
    );
  } catch (error) {
    console.error("Error fetching trending events:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
