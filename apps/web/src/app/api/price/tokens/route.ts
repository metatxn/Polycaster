import { type NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/api-rate-limit";

/**
 * CoinMarketCap API response types
 */
interface CoinMarketCapQuote {
  price: number;
  volume_24h: number;
  percent_change_24h: number;
}

interface CoinMarketCapTokenData {
  id: number;
  name: string;
  symbol: string;
  quote: {
    USD: CoinMarketCapQuote;
  };
}

interface CoinMarketCapResponse {
  data: Record<string, CoinMarketCapTokenData>;
}

/**
 * Token price response
 */
export interface TokenPriceData {
  symbol: string;
  price: number;
  percentChange24h: number;
}

export interface TokenPricesResponse {
  prices: Record<string, number>;
  data: TokenPriceData[];
  cached: boolean;
  stale?: boolean;
  timestamp: number;
  warning?: string;
  error?: string;
}

/**
 * Mapping of our token symbols to CoinMarketCap symbols
 * CoinMarketCap uses different symbols for some tokens
 */
const TOKEN_SYMBOL_MAP: Record<string, string> = {
  POL: "POL",
  MATIC: "POL", // MATIC is now POL
  WMATIC: "POL", // Wrapped MATIC uses POL price
  WETH: "ETH", // Wrapped ETH uses ETH price
  ETH: "ETH",
  WBTC: "BTC", // Wrapped BTC uses BTC price
  BTC: "BTC",
  USDC: "USDC",
  "USDC.e": "USDC", // Bridged USDC uses same price
  USDT: "USDT",
  DAI: "DAI",
};

/**
 * Symbols to fetch from CoinMarketCap
 * These are the base symbols we need prices for
 */
const CMC_SYMBOLS = ["POL", "ETH", "BTC", "USDC", "USDT", "DAI"];

/**
 * Cache structure for token prices
 */
interface PriceCache {
  prices: Record<string, number>;
  data: TokenPriceData[];
  timestamp: number;
}

// Cache the prices for 5 minutes to stay within CoinMarketCap free tier limits
// Free tier: 10,000 requests/month
// 5 min cache = 12 req/hour × 24 hours × 30 days = 8,640 req/month (safe buffer)
let cachedPrices: PriceCache | null = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Fallback prices for when API is unavailable
 * These are conservative estimates and will be marked as stale
 */
const FALLBACK_PRICES: Record<string, number> = {
  POL: 0.5,
  MATIC: 0.5,
  WMATIC: 0.5,
  ETH: 3500,
  WETH: 3500,
  BTC: 100000,
  WBTC: 100000,
  USDC: 1,
  "USDC.e": 1,
  USDT: 1,
  DAI: 1,
};

/**
 * GET /api/price/tokens
 *
 * Fetches current prices for multiple tokens from CoinMarketCap.
 * Returns prices for POL, ETH, BTC, USDC, USDT, DAI and their wrapped variants.
 *
 * Response includes:
 * - prices: Record<string, number> - Simple symbol to price mapping for all supported tokens
 * - data: TokenPriceData[] - Detailed price data including 24h change
 * - cached: boolean - Whether the response is from cache
 * - stale: boolean - Whether the cached data is expired (only on error)
 * - timestamp: number - When the prices were last fetched
 */
export async function GET(request: NextRequest) {
  // Rate limit: 60 requests per minute
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    // Check if we have a valid cached price
    if (cachedPrices && Date.now() - cachedPrices.timestamp < CACHE_DURATION) {
      // Build response with mapped symbols
      const mappedPrices = buildMappedPrices(cachedPrices.prices);

      return NextResponse.json({
        prices: mappedPrices,
        data: cachedPrices.data,
        cached: true,
        timestamp: cachedPrices.timestamp,
      } satisfies TokenPricesResponse);
    }

    const apiKey = process.env.COINMARKET_API_KEY;

    if (!apiKey) {
      console.warn("COINMARKET_API_KEY is not defined");
      // Return fallback prices with warning
      return NextResponse.json(
        {
          prices: FALLBACK_PRICES,
          data: Object.entries(FALLBACK_PRICES).map(([symbol, price]) => ({
            symbol,
            price,
            percentChange24h: 0,
          })),
          cached: false,
          stale: true,
          timestamp: Date.now(),
          warning: "Using fallback prices - API key not configured",
        } satisfies TokenPricesResponse,
        { status: 200 }
      );
    }

    const symbolsParam = CMC_SYMBOLS.join(",");
    const response = await fetch(
      `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${symbolsParam}&convert=USD`,
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

    const responseData: CoinMarketCapResponse = await response.json();

    // Extract prices from the response
    const prices: Record<string, number> = {};
    const data: TokenPriceData[] = [];

    for (const symbol of CMC_SYMBOLS) {
      const tokenData = responseData.data?.[symbol];
      if (tokenData?.quote?.USD?.price) {
        const price = tokenData.quote.USD.price;
        const percentChange24h = tokenData.quote.USD.percent_change_24h || 0;

        prices[symbol] = price;
        data.push({
          symbol,
          price,
          percentChange24h,
        });
      }
    }

    // Update cache
    cachedPrices = {
      prices,
      data,
      timestamp: Date.now(),
    };

    // Build response with mapped symbols
    const mappedPrices = buildMappedPrices(prices);

    return NextResponse.json({
      prices: mappedPrices,
      data,
      cached: false,
      timestamp: cachedPrices.timestamp,
    } satisfies TokenPricesResponse);
  } catch (error) {
    console.error("Error fetching token prices:", error);

    // Return cached prices if available, even if expired
    if (cachedPrices) {
      const mappedPrices = buildMappedPrices(cachedPrices.prices);

      return NextResponse.json({
        prices: mappedPrices,
        data: cachedPrices.data,
        cached: true,
        stale: true,
        timestamp: cachedPrices.timestamp,
      } satisfies TokenPricesResponse);
    }

    // Return fallback prices as last resort
    return NextResponse.json(
      {
        prices: FALLBACK_PRICES,
        data: Object.entries(FALLBACK_PRICES).map(([symbol, price]) => ({
          symbol,
          price,
          percentChange24h: 0,
        })),
        cached: false,
        stale: true,
        timestamp: Date.now(),
        error: "Failed to fetch prices, using fallback values",
      } satisfies TokenPricesResponse,
      { status: 200 } // Return 200 with fallback prices instead of 500
    );
  }
}

/**
 * Build a price map that includes all our token symbols
 * Maps wrapped tokens to their base asset prices
 */
function buildMappedPrices(
  basePrices: Record<string, number>
): Record<string, number> {
  const mappedPrices: Record<string, number> = { ...basePrices };

  // Add mapped symbols
  for (const [ourSymbol, cmcSymbol] of Object.entries(TOKEN_SYMBOL_MAP)) {
    if (basePrices[cmcSymbol] !== undefined) {
      mappedPrices[ourSymbol] = basePrices[cmcSymbol];
    }
  }

  return mappedPrices;
}
