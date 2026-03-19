import { type NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/api-rate-limit";

/**
 * Polymarket Gamma API URL
 */
const GAMMA_API = "https://gamma-api.polymarket.com";

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
        next: { revalidate: 300 }, // Cache for 5 minutes
      }
    );

    if (gammaResponse.ok) {
      const gammaData = await gammaResponse.json();

      if (Array.isArray(gammaData) && gammaData.length > 0) {
        const market = gammaData[0];

        // Determine outcome based on which token matches
        // clobTokenIds is a comma-separated string like "tokenId1,tokenId2"
        // outcomes is a string like "Yes,No"
        let outcome = "Yes";
        if (market.clobTokenIds && market.outcomes) {
          const tokenIds = market.clobTokenIds.split(",");
          const outcomes = market.outcomes.split(",");
          const tokenIndex = tokenIds.findIndex(
            (id: string) => id.trim() === tokenId
          );
          if (tokenIndex !== -1 && outcomes[tokenIndex]) {
            outcome = outcomes[tokenIndex].trim();
          }
        }

        return NextResponse.json({
          success: true,
          market: {
            question: market.question || market.title || "Unknown Market",
            slug: market.slug || market.marketSlug || "",
            eventSlug:
              market.eventSlug || market.event_slug || market.slug || "",
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
