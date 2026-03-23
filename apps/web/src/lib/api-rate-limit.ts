import { type NextRequest, NextResponse } from "next/server";
import { rateLimit } from "./rate-limit";

/**
 * Get the client IP for rate limiting.
 * Priority: Cloudflare > real-ip > forwarded > fallback.
 */
function getClientIp(request: NextRequest): string {
  const cfConnectingIp = request.headers.get("cf-connecting-ip");
  const realIp = request.headers.get("x-real-ip");
  const forwarded = request.headers.get("x-forwarded-for");

  return (
    (cfConnectingIp || realIp || forwarded?.split(",")[0])?.trim() ||
    "anonymous"
  );
}

/**
 * Normalize a pathname to its route template so that dynamic segments
 * don't create separate rate-limit buckets.
 *
 * e.g. `/api/markets/orderbook/abc123` → `/api/markets/orderbook/[param]`
 *      `/api/tags/sports`              → `/api/tags/[param]`
 *      `/api/events/list`              → `/api/events/list` (unchanged — static child)
 *
 * Uses an explicit map of known dynamic route parents rather than heuristics,
 * so short slugs ("sports", "nba") are normalized correctly.
 */

/** Route parents whose last segment is always dynamic. */
const DYNAMIC_ROUTE_PARENTS = new Set([
  "/api/markets/info",
  "/api/markets/price-history",
  "/api/markets/orderbook",
  "/api/markets/trades",
  "/api/markets/by-token",
  "/api/markets/slug",
  "/api/profile",
  "/api/tags",
]);

/**
 * /api/events has BOTH static children (list, trending, …) and a dynamic
 * child ([id]). We whitelist the known static ones; anything else is dynamic.
 */
const STATIC_EVENT_CHILDREN = new Set([
  "list",
  "trending",
  "breaking",
  "new",
  "paginated",
]);

function normalizeRoutePath(pathname: string): string {
  if (!pathname.startsWith("/api/")) return pathname;

  const segments = pathname.split("/");
  if (segments.length < 3) return pathname;

  const lastSegment = segments[segments.length - 1];
  const parentPath = segments.slice(0, -1).join("/");

  // Known dynamic parents — always normalize the last segment
  if (DYNAMIC_ROUTE_PARENTS.has(parentPath)) {
    segments[segments.length - 1] = "[param]";
    return segments.join("/");
  }

  // Special case: /api/events/[id] vs /api/events/list etc.
  if (parentPath === "/api/events" && !STATIC_EVENT_CHILDREN.has(lastSegment)) {
    segments[segments.length - 1] = "[param]";
    return segments.join("/");
  }

  return pathname;
}

/**
 * Build a per-route rate limit key: `normalizedRoute:ip`.
 *
 * Each route template gets its own bucket so that:
 * - Hitting /api/search doesn't consume tokens from /api/user/positions
 * - Hitting /api/markets/orderbook/tokenA shares the bucket with /tokenB
 *   (dynamic segments are normalized)
 */
function getRateLimitKey(request: NextRequest): string {
  const ip = getClientIp(request);
  const route = normalizeRoutePath(request.nextUrl.pathname);
  return `${route}:${ip}`;
}

/**
 * Apply rate limiting to an API route.
 *
 * Each route maintains its own per-IP bucket, so consuming
 * the limit on one endpoint won't affect others.
 *
 * Returns a NextResponse with 429 status if rate limit exceeded,
 * or null to continue processing.
 */
export function checkRateLimit(
  request: NextRequest,
  options?: {
    interval?: number;
    uniqueTokenPerInterval?: number;
  }
): NextResponse | null {
  const identifier = getRateLimitKey(request);

  const rateLimitResult = rateLimit(identifier, {
    interval: options?.interval || 60 * 1000, // Default: 1 minute
    uniqueTokenPerInterval: options?.uniqueTokenPerInterval || 60, // Default: 60 req/min
  });

  // If rate limit exceeded, return 429 response
  if (!rateLimitResult.success) {
    return NextResponse.json(
      {
        success: false,
        error: "Too many requests. Please try again later.",
        rateLimit: {
          limit: rateLimitResult.limit,
          remaining: 0,
          reset: new Date(rateLimitResult.reset).toISOString(),
        },
      },
      {
        status: 429,
        headers: {
          "X-RateLimit-Limit": rateLimitResult.limit.toString(),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": rateLimitResult.reset.toString(),
          "Retry-After": Math.ceil(
            (rateLimitResult.reset - Date.now()) / 1000
          ).toString(),
        },
      }
    );
  }

  // Rate limit not exceeded, return null to continue
  return null;
}
