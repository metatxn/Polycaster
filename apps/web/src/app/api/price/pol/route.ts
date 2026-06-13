import { createLogger } from "@knoww/logger";
import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-error";
import { checkRateLimit } from "@/lib/api-rate-limit";

const log = createLogger("api.price.pol");

// CoinMarketCap API response types
interface CoinMarketCapQuote {
  price: number;
  volume_24h: number;
  percent_change_24h: number;
}

interface CoinMarketCapData {
  id: number;
  name: string;
  symbol: string;
  quote: {
    USD: CoinMarketCapQuote;
  };
}

interface CoinMarketCapResponse {
  data: {
    POL: CoinMarketCapData;
  };
}

// Cache the price for 5 minutes to stay within CoinMarketCap free tier limits
// Free tier: 10,000 requests/month
// 5 min cache = 12 req/hour × 24 hours × 30 days = 8,640 req/month (safe buffer)
let cachedPrice: { price: number; timestamp: number } | null = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export async function GET(request: NextRequest) {
  // Rate limit: 60 requests per minute
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    // Check if we have a valid cached price
    if (cachedPrice && Date.now() - cachedPrice.timestamp < CACHE_DURATION) {
      return NextResponse.json({
        price: cachedPrice.price,
        cached: true,
      });
    }

    const apiKey = process.env.COINMARKET_API_KEY;

    if (!apiKey) {
      log.warn("config.missing", { key: "COINMARKET_API_KEY" });
      return jsonError("API key not configured", 500);
    }

    const response = await fetch(
      "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=POL&convert=USD",
      {
        headers: {
          "X-CMC_PRO_API_KEY": apiKey,
          Accept: "application/json",
        },
        next: { revalidate: 300 }, // Next.js cache for 5 minutes
      }
    );

    if (!response.ok) {
      throw new Error(`CoinMarketCap API error: ${response.status}`);
    }

    const data: CoinMarketCapResponse = await response.json();

    // Extract POL price from the response
    const polData = data.data?.POL;
    if (!polData) {
      throw new Error("POL data not found in response");
    }

    const price = polData.quote?.USD?.price;
    if (typeof price !== "number") {
      throw new Error("Invalid price data");
    }

    // Update cache
    cachedPrice = {
      price,
      timestamp: Date.now(),
    };

    return NextResponse.json({
      price,
      cached: false,
    });
  } catch (error) {
    log.error("fetch.failed", { error });

    // Return cached price if available, even if expired
    if (cachedPrice) {
      return NextResponse.json({
        price: cachedPrice.price,
        cached: true,
        stale: true,
      });
    }

    return jsonError("Failed to fetch POL price", 500);
  }
}
