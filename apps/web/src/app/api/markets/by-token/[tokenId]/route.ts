import { type NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/api-rate-limit";

/**
 * Polymarket Gamma API URL
 */
const GAMMA_API = "https://gamma-api.polymarket.com";

/**
 * Resolve the parent event slug for a market.
 *
 * The Gamma API nests the parent event inside `market.events[]`.
 * We prefer `events[0].slug` (the actual event slug) over the market's own slug,
 * since these differ for multi-outcome events.
 * Falls back to top-level `eventSlug` fields, then fetching by event ID.
 */
async function resolveEventSlug(
  market: Record<string, unknown>
): Promise<string> {
  // 1. Preferred: embedded events array from Gamma API
  const events = market.events as
    | Array<{ id?: string; slug?: string }>
    | undefined;
  if (Array.isArray(events) && events.length > 0 && events[0].slug) {
    return events[0].slug;
  }

  // 2. Direct top-level field (some API shapes include this)
  const direct = (market.eventSlug as string) || (market.event_slug as string);
  if (direct) return direct;

  // 3. Fetch parent event by numeric ID as last resort
  const eventId =
    (market.events_id as string) ||
    (market.eventId as string) ||
    (market.event_id as string);

  if (eventId) {
    try {
      const res = await fetch(`${GAMMA_API}/events/${eventId}`, {
        headers: { Accept: "application/json" },
        next: { revalidate: 300 },
      });
      if (res.ok) {
        const event = (await res.json()) as Record<string, unknown>;
        if (event.slug) return event.slug as string;
      }
    } catch {
      // fall through to market slug
    }
  }

  return (market.slug as string) || "";
}

/**
 * GET /api/markets/by-token/:tokenId
 * Get market information by token ID (CLOB token ID)
 *
 * The token ID is the outcome token ID from the CLOB API.
 * We use the Gamma API with clob_token_ids parameter to look up the market.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tokenId: string }> }
) {
  // Rate limit: 60 requests per minute
  const rateLimitResponse = checkRateLimit(_request, {
    uniqueTokenPerInterval: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { tokenId } = await params;

    // Use Gamma API with clob_token_ids parameter
    const gammaResponse = await fetch(
      `${GAMMA_API}/markets?clob_token_ids=${tokenId}`,
      {
        headers: { Accept: "application/json" },
        next: { revalidate: 300 },
      }
    );

    if (gammaResponse.ok) {
      const gammaData = await gammaResponse.json();

      if (Array.isArray(gammaData) && gammaData.length > 0) {
        const market = gammaData[0];

        // Gamma returns `clobTokenIds` and `outcomes` as JSON-stringified
        // arrays (e.g. `'["<id1>", "<id2>"]'`, `'["Yes", "No"]'`), not CSV.
        // The previous implementation used `.split(",")`, which produced
        // `['["<id1>"', ' "<id2>"]']` and never matched the raw tokenId —
        // so the outcome defaulted to "Yes" for every row, which is why
        // portfolio's open-orders tab mislabelled NO orders as Yes.
        const parseArrayField = (value: unknown): string[] => {
          if (Array.isArray(value)) return value as string[];
          if (typeof value !== "string") return [];
          try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) return parsed.map((v) => String(v));
          } catch {
            // Fall back to CSV for older/legacy rows just in case.
          }
          return value.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
        };

        let outcome = "Yes";
        if (market.clobTokenIds && market.outcomes) {
          const tokenIds = parseArrayField(market.clobTokenIds);
          const outcomes = parseArrayField(market.outcomes);
          const tokenIndex = tokenIds.findIndex(
            (id: string) => id.trim() === tokenId
          );
          if (tokenIndex !== -1 && outcomes[tokenIndex]) {
            outcome = outcomes[tokenIndex].trim();
          }
        }

        const eventSlug = await resolveEventSlug(market);

        return NextResponse.json({
          success: true,
          market: {
            question: market.question || market.title || "Unknown Market",
            slug: market.slug || market.marketSlug || "",
            eventSlug,
            conditionId: market.conditionId || "",
            outcome,
            endDate: market.endDate || market.endDateIso || null,
            icon: market.image || market.icon || null,
          },
        });
      }
    }

    // If API fails or no market found, return not found
    return NextResponse.json({
      success: false,
      error: "Market not found for token ID",
    });
  } catch (error) {
    console.error("Error fetching market by token ID:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
