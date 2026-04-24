import { type NextRequest, NextResponse } from "next/server";
import { runBacktest } from "@/lib/insider/backtest";

/**
 * One-shot insider-detector backtest runner.
 *
 * Heavier than a normal route — expect 30-120s to run since it
 * paginates trades for ~20 markets and resolves account ages for
 * thousands of wallets. Node-runtime + large maxDuration.
 *
 * Query params (all optional):
 *   maxDaysAgo       default 21   — oldest resolved market to include
 *   minDaysAgo       default 2    — freshness buffer for indexing
 *   minDurationHours default 24   — skip 5-minute crypto markets
 *   minVolumeUsd     default 5000 — skip dead markets
 *   maxMarkets       default 20   — cap scan size (capped at 40)
 *   minScore         default 30   — suspicion threshold (balanced)
 *   minTradeUsd      default 500  — minimum trade size to score
 */

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

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const options = {
      maxDaysAgo: clampInt(searchParams.get("maxDaysAgo"), 21, 2, 60),
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
      maxMarkets: clampInt(searchParams.get("maxMarkets"), 20, 1, 40),
      minSuspicionScore: clampInt(searchParams.get("minScore"), 30, 1, 100),
      minTradeUsd: clampFloat(
        searchParams.get("minTradeUsd"),
        500,
        0,
        1_000_000
      ),
    };

    if (options.minDaysAgo >= options.maxDaysAgo) {
      return NextResponse.json(
        { error: "minDaysAgo must be less than maxDaysAgo" },
        { status: 400 }
      );
    }

    const result = await runBacktest(options);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Backtest runner error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unknown backtest error",
      },
      { status: 500 }
    );
  }
}
