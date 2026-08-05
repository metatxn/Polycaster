import { createLogger } from "@knoww/logger";
import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-error";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { runBacktest } from "@/lib/insider/backtest";

const log = createLogger("api.whales.backtest");

export const runtime = "nodejs";
export const maxDuration = 180;
export const dynamic = "force-dynamic";

function clampInt(
  value: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  const n = Number.parseInt(value ?? `${fallback}`, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function clampFloat(
  value: string | null,
  fallback: number,
  min: number,
  max: number
): number {
  const n = Number.parseFloat(value ?? `${fallback}`);
  if (Number.isNaN(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

/**
 * @openapi
 * /api/whales/backtest:
 *   get:
 *     summary: Run insider-detector backtest
 *     description: Runs a heavyweight one-shot backtest against recently resolved Polymarket markets.
 *     tags:
 *       - Whales
 *     parameters:
 *       - in: query
 *         name: maxDaysAgo
 *         schema:
 *           type: integer
 *           minimum: 2
 *           maximum: 30
 *       - in: query
 *         name: minDaysAgo
 *         schema:
 *           type: integer
 *           minimum: 0
 *           maximum: 30
 *       - in: query
 *         name: minDurationHours
 *         schema:
 *           type: integer
 *           minimum: 0
 *           maximum: 720
 *       - in: query
 *         name: minVolumeUsd
 *         schema:
 *           type: number
 *           minimum: 0
 *           maximum: 10000000
 *       - in: query
 *         name: maxMarkets
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 30
 *       - in: query
 *         name: minScore
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *       - in: query
 *         name: minTradeUsd
 *         schema:
 *           type: number
 *           minimum: 0
 *           maximum: 1000000
 *     responses:
 *       200:
 *         description: Backtest result.
 *       400:
 *         description: Invalid query parameter combination.
 *       429:
 *         description: Rate limit exceeded.
 *       500:
 *         description: Backtest failed.
 */
export async function GET(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, {
    interval: 5 * 60 * 1000,
    uniqueTokenPerInterval: 2,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { searchParams } = new URL(request.url);

    // Interim workload clamps until the backtest moves to an async Workflow:
    // the market sample and discovery window are the main cost drivers, so
    // their maxima are held at the UI's default workload (30 markets, ≤30-day
    // window) rather than the previous 40/60.
    const options = {
      maxDaysAgo: clampInt(searchParams.get("maxDaysAgo"), 21, 2, 30),
      minDaysAgo: clampInt(searchParams.get("minDaysAgo"), 2, 0, 30),
      minDurationHours: clampInt(
        searchParams.get("minDurationHours"),
        24,
        0,
        720
      ),
      minVolumeUsd: clampFloat(
        searchParams.get("minVolumeUsd"),
        5000,
        0,
        10_000_000
      ),
      maxMarkets: clampInt(searchParams.get("maxMarkets"), 20, 1, 30),
      minSuspicionScore: clampInt(searchParams.get("minScore"), 30, 1, 100),
      minTradeUsd: clampFloat(
        searchParams.get("minTradeUsd"),
        500,
        0,
        1_000_000
      ),
    };

    if (options.minDaysAgo >= options.maxDaysAgo) {
      return jsonError("minDaysAgo must be less than maxDaysAgo", 400);
    }

    const result = await runBacktest(options);
    return NextResponse.json(result);
  } catch (error) {
    log.error("run.failed", { error });
    return jsonError("Backtest failed", 500);
  }
}
