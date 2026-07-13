import type { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/api-rate-limit";

/**
 * Rate limits for the LLM-invoking AI routes (paid OpenRouter calls).
 *
 * Authentication is enforced before this limiter. The route-specific
 * per-minute bucket remains defense in depth for valid signed sessions.
 */
export function checkAiRateLimit(
  request: NextRequest,
  perMinuteLimit: number
): NextResponse | null {
  return checkRateLimit(request, {
    uniqueTokenPerInterval: perMinuteLimit,
  });
}
