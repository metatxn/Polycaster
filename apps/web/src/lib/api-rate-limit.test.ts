import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit } from "./api-rate-limit";
import { TRUSTED_CLIENT_IP_HEADER } from "./client-ip";
import { _resetRateLimitStore } from "./rate-limit";

function makeRequest(ip: string, headers?: HeadersInit): NextRequest {
  const requestHeaders = new Headers(headers);
  if (ip) requestHeaders.set(TRUSTED_CLIENT_IP_HEADER, ip);
  return {
    headers: requestHeaders,
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

  it("keeps separate buckets for trusted client identities", () => {
    const tight = { interval: 60_000, uniqueTokenPerInterval: 1 };
    expect(checkRateLimit(makeRequest("1.1.1.1"), tight)).toBeNull();
    expect(checkRateLimit(makeRequest("1.1.1.1"), tight)).not.toBeNull();
    expect(checkRateLimit(makeRequest("2.2.2.2"), tight)).toBeNull();
  });

  it("ignores caller-controlled forwarding headers", () => {
    const tight = { interval: 60_000, uniqueTokenPerInterval: 1 };
    const first = makeRequest("", {
      "cf-connecting-ip": "1.1.1.1",
      "x-forwarded-for": "2.2.2.2",
      "x-real-ip": "3.3.3.3",
    });
    const second = makeRequest("", {
      "cf-connecting-ip": "4.4.4.4",
      "x-forwarded-for": "5.5.5.5",
      "x-real-ip": "6.6.6.6",
    });

    expect(checkRateLimit(first, tight)).toBeNull();
    expect(checkRateLimit(second, tight)).not.toBeNull();
  });
});
