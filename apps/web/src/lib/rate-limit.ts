/**
 * Simple in-memory rate limiter for API routes.
 *
 * IMPORTANT: This limiter is process-local. On Cloudflare Workers each isolate
 * maintains its own Map, so effective limits scale linearly with the number of
 * active isolates. Under high traffic the actual throughput per IP can exceed
 * the configured limit by a factor equal to the number of concurrent isolates.
 *
 * For strict global enforcement, migrate to one of:
 * - Cloudflare Rate Limiting rules (WAF product — per-zone, no code change)
 * - Cloudflare KV (eventually consistent counters, ~50ms latency)
 * - Cloudflare Durable Objects (strongly consistent, higher cost)
 *
 * The in-memory approach is still valuable as a first line of defence: it
 * protects each isolate from burst abuse and is zero-latency / zero-cost.
 */

interface RateLimitStore {
  count: number;
  resetTime: number;
}

const rateLimitMap = new Map<string, RateLimitStore>();

interface RateLimitOptions {
  interval: number; // Time window in milliseconds
  uniqueTokenPerInterval: number; // Max requests per interval
}

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

/**
 * Rate limiter using token bucket algorithm
 * @param uniqueId - Unique identifier (e.g., IP address, user ID)
 * @param options - Rate limit configuration
 * @returns true if request is allowed, false otherwise
 */
export function rateLimit(
  uniqueId: string,
  options: RateLimitOptions = {
    interval: 60 * 1000, // 1 minute
    uniqueTokenPerInterval: 60, // 60 requests per minute
  }
): { success: boolean; limit: number; remaining: number; reset: number } {
  const now = Date.now();
  const store = rateLimitMap.get(uniqueId);

  // If no store exists or reset time has passed, create new store
  if (!store || now > store.resetTime) {
    const resetTime = now + options.interval;
    rateLimitMap.set(uniqueId, {
      count: 1,
      resetTime,
    });

    return {
      success: true,
      limit: options.uniqueTokenPerInterval,
      remaining: options.uniqueTokenPerInterval - 1,
      reset: resetTime,
    };
  }

  // Increment count
  store.count += 1;

  // Check if limit exceeded
  if (store.count > options.uniqueTokenPerInterval) {
    return {
      success: false,
      limit: options.uniqueTokenPerInterval,
      remaining: 0,
      reset: store.resetTime,
    };
  }

  return {
    success: true,
    limit: options.uniqueTokenPerInterval,
    remaining: options.uniqueTokenPerInterval - store.count,
    reset: store.resetTime,
  };
}

/**
 * Cleanup old entries periodically to prevent memory leaks
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitMap.entries()) {
    if (now > value.resetTime) {
      rateLimitMap.delete(key);
    }
  }
}, 60 * 1000); // Clean up every minute
