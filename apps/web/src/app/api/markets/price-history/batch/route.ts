import { type NextRequest, NextResponse } from "next/server";
import { POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { getCacheHeaders } from "@/lib/cache-headers";

interface PriceHistoryPoint {
  t: number;
  p: number;
}

interface PolymarketPriceHistoryResponse {
  history: PriceHistoryPoint[];
}

interface BatchRequestBody {
  tokenIds?: string[];
  startTs?: number | string;
  fidelity?: number | string;
}

interface BatchEntry {
  tokenId: string;
  history: PriceHistoryPoint[];
}

const MAX_TOKENS_PER_BATCH = 40;

async function fetchOne(
  tokenId: string,
  startTs: string,
  fidelity: string
): Promise<PriceHistoryPoint[]> {
  const qs = new URLSearchParams({ market: tokenId, startTs, fidelity });
  const res = await fetch(
    `${POLYMARKET_API.CLOB.BASE}/prices-history?${qs.toString()}`,
    {
      headers: { "Content-Type": "application/json" },
      next: { revalidate: 60 },
    }
  );
  if (!res.ok) return [];
  const data = (await res.json()) as PolymarketPriceHistoryResponse;
  return data.history ?? [];
}

/**
 * POST /api/markets/price-history/batch
 *
 * Body: { tokenIds: string[], startTs?: number, fidelity?: number }
 * Returns a single response with history arrays for every token — one round
 * trip from the browser instead of N. Each upstream fetch is individually
 * cached for 60s by the Next runtime, so repeated batches share the cache.
 */
export async function POST(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = (await request.json()) as BatchRequestBody;
    const rawIds = Array.isArray(body.tokenIds) ? body.tokenIds : [];
    const tokenIds = Array.from(
      new Set(
        rawIds.filter(
          (id): id is string => typeof id === "string" && id.length >= 10
        )
      )
    );

    if (tokenIds.length === 0) {
      return NextResponse.json(
        { success: false, error: "tokenIds is required" },
        { status: 400 }
      );
    }

    if (tokenIds.length > MAX_TOKENS_PER_BATCH) {
      return NextResponse.json(
        {
          success: false,
          error: `Too many tokenIds (max ${MAX_TOKENS_PER_BATCH})`,
        },
        { status: 400 }
      );
    }

    const fidelity = String(body.fidelity ?? "60");
    const startTs = body.startTs
      ? String(body.startTs)
      : String(Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60);

    const results: BatchEntry[] = await Promise.all(
      tokenIds.map(async (tokenId) => ({
        tokenId,
        history: await fetchOne(tokenId, startTs, fidelity),
      }))
    );

    return NextResponse.json(
      {
        success: true,
        histories: results,
        startTs: Number(startTs),
        fidelity: Number(fidelity),
      },
      { headers: getCacheHeaders("priceHistory") }
    );
  } catch (error) {
    console.error("Error fetching batch price history:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        histories: [],
      },
      { status: 500 }
    );
  }
}
