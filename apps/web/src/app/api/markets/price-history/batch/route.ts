import { createLogger } from "@knoww/logger";
import {
  ClobRequestError,
  fetchClobPriceHistory,
} from "@knoww/shared-types/clob";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { readJsonBodyWithLimit } from "@/lib/api-request-body";
import { getCacheHeaders } from "@/lib/cache-headers";

const log = createLogger("api.markets.price-history.batch");

interface PriceHistoryPoint {
  t: number;
  p: number;
}

interface PolymarketPriceHistoryResponse {
  history: PriceHistoryPoint[];
}

type BatchEntryStatus = "ok" | "timeout" | "upstream_error" | "not_found";

interface BatchEntry {
  tokenId: string;
  status: BatchEntryStatus;
  history: PriceHistoryPoint[];
}

const MAX_TOKENS_PER_BATCH = 40;
const DEFAULT_FIDELITY = 60;
const MAX_FIDELITY_MINUTES = 24 * 60;
const MAX_START_TS = 4_102_444_800; // 2100-01-01T00:00:00Z
const MAX_REQUEST_BODY_BYTES = 8 * 1024;
const FETCH_CONCURRENCY = 4;
const PER_TOKEN_TIMEOUT_MS = 8_000;
// Keep the full batch comfortably below the Worker's 128 MiB isolate limit.
// A real 30-day, one-minute history measured ~44k points / ~1.2 MiB for one
// token; 30k points keeps normal chart requests intact while rejecting the
// dense multi-token shapes that caused Error 1102.
const MAX_ESTIMATED_TOTAL_POINTS = 30_000;
const SECONDS_PER_MINUTE = 60;
// Shorter than the slowest observed full batch so one stuck upstream token
// can no longer hold the whole invocation open; tokens that miss the
// deadline are reported per-entry as "timeout" rather than delaying peers.
const REQUEST_DEADLINE_MS = 25_000;

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

function estimateTotalPoints(
  tokenCount: number,
  startTs: number,
  fidelity: number,
  nowTs: number
): number {
  const spanSeconds = Math.max(0, nowTs - startTs);
  const pointsPerToken =
    Math.ceil(spanSeconds / (fidelity * SECONDS_PER_MINUTE)) + 1;
  return tokenCount * pointsPerToken;
}

function minimumFidelityForBudget(
  tokenCount: number,
  startTs: number,
  nowTs: number
): number {
  const spanSeconds = Math.max(0, nowTs - startTs);
  const maxPointsPerToken = Math.floor(MAX_ESTIMATED_TOTAL_POINTS / tokenCount);
  const maxIntervalsPerToken = Math.max(1, maxPointsPerToken - 1);
  return Math.max(
    1,
    Math.ceil(spanSeconds / (maxIntervalsPerToken * SECONDS_PER_MINUTE))
  );
}

async function fetchOne(
  tokenId: string,
  startTs: string,
  fidelity: string,
  outerSignal: AbortSignal
): Promise<BatchEntry> {
  if (outerSignal.aborted) {
    return { tokenId, status: "timeout", history: [] };
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PER_TOKEN_TIMEOUT_MS);
  const onOuterAbort = () => controller.abort();
  outerSignal.addEventListener("abort", onOuterAbort, { once: true });
  try {
    const data = await fetchClobPriceHistory<PolymarketPriceHistoryResponse>(
      tokenId,
      { startTs, fidelity },
      {
        requestInit: {
          headers: { "Content-Type": "application/json" },
          next: { revalidate: 60 },
          signal: controller.signal,
        },
      }
    );
    return { tokenId, status: "ok", history: data.history ?? [] };
  } catch (error) {
    if (controller.signal.aborted) {
      return { tokenId, status: "timeout", history: [] };
    }
    if (error instanceof ClobRequestError && error.status === 404) {
      return { tokenId, status: "not_found", history: [] };
    }
    return { tokenId, status: "upstream_error", history: [] };
  } finally {
    clearTimeout(timeoutId);
    outerSignal.removeEventListener("abort", onOuterAbort);
  }
}

/** Run `worker` over `items` with at most `concurrency` in flight. Results
 * keep item order. */
async function runPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        results[index] = await worker(items[index]);
      }
    })
  );
  return results;
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
 *                 description: Resolution in minutes. The token count, requested time span, and fidelity must fit within a 30,000-point batch budget.
 *     responses:
 *       200:
 *         description: Batched price history response.
 *       400:
 *         description: Invalid request body or requested history exceeds the batch workload budget.
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
    const jsonBody = await readJsonBodyWithLimit(
      request,
      MAX_REQUEST_BODY_BYTES
    );
    if (!jsonBody.ok) {
      if (jsonBody.status === 400) {
        log.warn("request.invalid_json");
      }
      return NextResponse.json(
        { success: false, error: jsonBody.error, histories: [] },
        { status: jsonBody.status }
      );
    }

    const parsed = batchRequestSchema.safeParse(jsonBody.body);
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
    const nowTs = Math.floor(Date.now() / 1000);
    const startTs = parsed.data.startTs ?? nowTs - 30 * 24 * 60 * 60;
    const estimatedTotalPoints = estimateTotalPoints(
      tokenIds.length,
      startTs,
      fidelity,
      nowTs
    );

    if (estimatedTotalPoints > MAX_ESTIMATED_TOTAL_POINTS) {
      const minimumFidelity = minimumFidelityForBudget(
        tokenIds.length,
        startTs,
        nowTs
      );
      log.warn("request.budget_exceeded", {
        tokenCount: tokenIds.length,
        estimatedTotalPoints,
        fidelity,
        minimumFidelity,
      });
      return NextResponse.json(
        {
          success: false,
          code: "PRICE_HISTORY_BUDGET_EXCEEDED",
          error:
            "Requested price history is too dense; increase fidelity or shorten the time range",
          histories: [],
          estimatedTotalPoints,
          maxTotalPoints: MAX_ESTIMATED_TOTAL_POINTS,
          minimumFidelity,
        },
        { status: 400 }
      );
    }

    const startedAt = Date.now();
    const deadline = new AbortController();
    const deadlineTimer = setTimeout(
      () => deadline.abort(),
      REQUEST_DEADLINE_MS
    );
    const onClientAbort = () => deadline.abort();
    request.signal.addEventListener("abort", onClientAbort, { once: true });

    let results: BatchEntry[];
    try {
      results = await runPool(tokenIds, FETCH_CONCURRENCY, (tokenId) =>
        fetchOne(tokenId, String(startTs), String(fidelity), deadline.signal)
      );
    } finally {
      clearTimeout(deadlineTimer);
      request.signal.removeEventListener("abort", onClientAbort);
    }

    const statusCounts = results.reduce<Record<string, number>>(
      (counts, entry) => {
        counts[entry.status] = (counts[entry.status] ?? 0) + 1;
        return counts;
      },
      {}
    );
    // Only transient failures make a batch partial. A `not_found` entry is a
    // stable, complete answer for that token — treating it as partial would
    // force no-store and put fast-poll clients into an endless retry loop
    // against a permanent 404.
    const partial = results.some(
      (entry) => entry.status === "timeout" || entry.status === "upstream_error"
    );
    if (partial) {
      log.warn("fetch.partial", {
        tokenCount: tokenIds.length,
        wallTimeMs: Date.now() - startedAt,
        statusCounts,
      });
    } else {
      log.info("fetch.complete", {
        tokenCount: tokenIds.length,
        wallTimeMs: Date.now() - startedAt,
      });
    }

    return NextResponse.json(
      {
        success: true,
        partial,
        histories: results,
        startTs,
        fidelity,
      },
      {
        // A partial batch must not be edge/browser-cached for five minutes as
        // if it were complete data; only fully-ok batches keep the standard
        // price-history cache profile.
        headers: partial
          ? { "Cache-Control": "no-store" }
          : getCacheHeaders("priceHistory"),
      }
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
