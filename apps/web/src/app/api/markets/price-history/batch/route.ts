import { createLogger } from "@knoww/logger";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { POLYMARKET_API } from "@/constants/polymarket";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { getCacheHeaders } from "@/lib/cache-headers";

const log = createLogger("api.markets.price-history.batch");

interface PriceHistoryPoint {
  t: number;
  p: number;
}

interface PolymarketPriceHistoryResponse {
  history: PriceHistoryPoint[];
}

interface BatchEntry {
  tokenId: string;
  history: PriceHistoryPoint[];
}

const MAX_TOKENS_PER_BATCH = 40;
const DEFAULT_FIDELITY = 60;
const MAX_FIDELITY_MINUTES = 24 * 60;
const MAX_START_TS = 4_102_444_800; // 2100-01-01T00:00:00Z

const optionalInteger = (min: number, max: number) =>
  z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
      return undefined;
    }
    return value;
  }, z.coerce.number().int().finite().min(min).max(max).optional());

const batchRequestSchema = z.object({
  tokenIds: z
    .array(
      z
        .string()
        .trim()
        .regex(/^\d{10,}$/, "Invalid token ID format")
    )
    .min(1, "tokenIds is required")
    .max(
      MAX_TOKENS_PER_BATCH,
      `Too many tokenIds (max ${MAX_TOKENS_PER_BATCH})`
    ),
  startTs: optionalInteger(0, MAX_START_TS),
  fidelity: optionalInteger(1, MAX_FIDELITY_MINUTES),
});

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
 * @openapi
 * /api/markets/price-history/batch:
 *   post:
 *     summary: Fetch batched market price history
 *     description: Fetches historical price points for multiple CLOB token IDs in a single request.
 *     tags:
 *       - Markets
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tokenIds
 *             properties:
 *               tokenIds:
 *                 type: array
 *                 minItems: 1
 *                 maxItems: 40
 *                 items:
 *                   type: string
 *                   pattern: "^[0-9]{10,}$"
 *               startTs:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 4102444800
 *               fidelity:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 1440
 *     responses:
 *       200:
 *         description: Batched price history response.
 *       400:
 *         description: Invalid JSON or request body.
 *       429:
 *         description: Rate limit exceeded.
 *       500:
 *         description: Failed to fetch price history.
 */
export async function POST(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    let json: unknown;
    try {
      json = await request.json();
    } catch (error) {
      log.warn("request.invalid_json", { error });
      return NextResponse.json(
        { success: false, error: "Invalid JSON body", histories: [] },
        { status: 400 }
      );
    }

    const parsed = batchRequestSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request body",
          histories: [],
        },
        { status: 400 }
      );
    }

    const tokenIds = Array.from(new Set(parsed.data.tokenIds));
    const fidelity = parsed.data.fidelity ?? DEFAULT_FIDELITY;
    const startTs =
      parsed.data.startTs ?? Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;

    const results: BatchEntry[] = await Promise.all(
      tokenIds.map(async (tokenId) => ({
        tokenId,
        history: await fetchOne(tokenId, String(startTs), String(fidelity)),
      }))
    );

    return NextResponse.json(
      {
        success: true,
        histories: results,
        startTs,
        fidelity,
      },
      { headers: getCacheHeaders("priceHistory") }
    );
  } catch (error) {
    log.error("fetch.failed", { error });
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch price history",
        histories: [],
      },
      { status: 500 }
    );
  }
}
