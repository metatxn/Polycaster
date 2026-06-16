import type { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/api-rate-limit";
import type { ExtensionTrust } from "@/lib/extension-auth";

/**
 * Rate limits for the LLM-invoking AI routes (paid OpenRouter calls).
 *
 * Bearer-authenticated ("session") callers get the route's standard
 * per-minute limit. Low-trust callers — authenticated only by spoofable
 * Origin/Referer headers (the pre-auth extension flow) — additionally
 * consume from a per-day bucket, so a header-forging client cannot farm
 * paid LLM calls continuously. 300/day ≈ one post every 3 minutes for
 * 15 hours, comfortably above organic pre-auth usage.
 *
 * NOTE: buckets are per-isolate (see rate-limit.ts); this raises abuse
 * cost rather than enforcing a strict global ceiling. A shared store
 * (WAF rules / KV / Durable Objects) is the deferred follow-up.
 */
export const LOW_TRUST_DAILY_LIMIT = 300;
const DAY_MS = 24 * 60 * 60 * 1000;

export function checkAiRateLimit(
  request: NextRequest,
  trust: ExtensionTrust,
  perMinuteLimit: number
): NextResponse | null {
  const minuteLimited = checkRateLimit(request, {
    uniqueTokenPerInterval: perMinuteLimit,
  });
  if (minuteLimited) return minuteLimited;

  if (trust === "low-trust") {
    return checkRateLimit(request, {
      interval: DAY_MS,
      uniqueTokenPerInterval: LOW_TRUST_DAILY_LIMIT,
      keySuffix: "low-trust-day",
    });
  }

  return null;
}
