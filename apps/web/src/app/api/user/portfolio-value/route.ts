import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ERROR_MESSAGES } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { isValidAddress } from "@/lib/validation";

/**
 * Polymarket Data API base URL
 */
const DATA_API_BASE = "https://data-api.polymarket.com";

/**
 * Portfolio Value API Response
 * Based on: GET https://data-api.polymarket.com/value?user=<WALLET_ADDRESS>
 *
 * This returns total current positions value in USD.
 *
 * Includes:
 * - Value of YES/NO tokens you hold (positions)
 * - Value of any fully matched trades
 * - Unrealized P/L included
 *
 * Does NOT include:
 * - Open order collateral waiting in the book
 * - Amount still sitting as unused USDC (unless Polymarket counts it)
 */
interface PortfolioValueResponse {
  value: number;
}

/**
 * Validation schema for query parameters
 */
const querySchema = z.object({
  user: z
    .string()
    .min(1, "User address is required")
    .refine(isValidAddress, { message: "Invalid Ethereum address format" }),
});

/**
 * GET /api/user/portfolio-value
 *
 * Fetch portfolio value from Polymarket Data API
 * Uses: GET https://data-api.polymarket.com/value?user=<WALLET_ADDRESS>
 *
 * This endpoint returns the total current positions value in USD.
 * "Everything you currently own, marked to market"
 *
 * Query Parameters:
 * - user: User's wallet address (required) - should be the proxy wallet address
 *
 * Response:
 * - value: Total portfolio value in USD
 */
export async function GET(request: NextRequest) {
  // Rate limit: 60 requests per minute
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const searchParams = request.nextUrl.searchParams;

    // Parse and validate query parameters
    const parsed = querySchema.safeParse({
      user: searchParams.get("user"),
    });

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid query parameters",
          details: parsed.error.message,
        },
        { status: 400 }
      );
    }

    const { user } = parsed.data;

    // Fetch portfolio value from Polymarket Data API
    // Note: Use the proxy wallet address, not EOA
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    let response: Response;
    try {
      response = await fetch(
        `${DATA_API_BASE}/value?user=${user.toLowerCase()}`,
        {
          headers: {
            Accept: "application/json",
          },
          next: { revalidate: 30 }, // Cache for 30 seconds
          signal: controller.signal,
        }
      );
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof DOMException && err.name === "AbortError") {
        return NextResponse.json(
          {
            success: false,
            error: "Request to Polymarket timed out",
          },
          { status: 504 }
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[portfolio-value] Polymarket API error:", errorText);
      return NextResponse.json(
        {
          success: false,
          error: "Failed to fetch portfolio value from Polymarket",
          details: response.status,
        },
        { status: response.status }
      );
    }

    const data: PortfolioValueResponse = await response.json();

    return NextResponse.json({
      success: true,
      user,
      portfolioValue: data.value ?? 0,
      // Additional context
      description: "Total current positions value in USD (marked to market)",
      includes: [
        "Value of YES/NO tokens held",
        "Value of fully matched trades",
        "Unrealized P/L",
      ],
      excludes: ["Open order collateral", "Unused USDC balance"],
    });
  } catch (error) {
    console.error("[portfolio-value] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : ERROR_MESSAGES.UNKNOWN_ERROR,
      },
      { status: 500 }
    );
  }
}
