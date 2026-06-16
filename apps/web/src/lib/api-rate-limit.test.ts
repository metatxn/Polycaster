import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit } from "./api-rate-limit";
import { _resetRateLimitStore } from "./rate-limit";

function makeRequest(ip: string): NextRequest {
  return {
    headers: new Headers({ "cf-connecting-ip": ip }),
    nextUrl: new URL("http://localhost/api/ai/extract-topics"),
  } as unknown as NextRequest;
}

describe("checkRateLimit", () => {
  beforeEach(() => {
    _resetRateLimitStore();
  });

  it("returns null under the limit and 429 over it", () => {
    const req = makeRequest("1.1.1.1");
    const opts = { interval: 60_000, uniqueTokenPerInterval: 2 };
    expect(checkRateLimit(req, opts)).toBeNull();
    expect(checkRateLimit(req, opts)).toBeNull();
    const blocked = checkRateLimit(req, opts);
    expect(blocked?.status).toBe(429);
  });

  it("keySuffix creates an independent bucket on the same route+ip", () => {
    const req = makeRequest("2.2.2.2");
    const tight = { interval: 60_000, uniqueTokenPerInterval: 1 };
    expect(checkRateLimit(req, tight)).toBeNull();
    expect(checkRateLimit(req, tight)).not.toBeNull(); // base bucket exhausted
    // Same route+ip but suffixed bucket is fresh:
    expect(checkRateLimit(req, { ...tight, keySuffix: "daily" })).toBeNull();
    // The suffixed bucket enforces its own limit too:
    expect(
      checkRateLimit(req, { ...tight, keySuffix: "daily" })
    ).not.toBeNull();
  });
});
