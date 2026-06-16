import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { checkAiRateLimit, LOW_TRUST_DAILY_LIMIT } from "./ai-rate-limit";
import { _resetRateLimitStore } from "./rate-limit";

function makeRequest(ip: string): NextRequest {
  return {
    headers: new Headers({ "cf-connecting-ip": ip }),
    nextUrl: new URL("http://localhost/api/ai/extract-topics"),
  } as unknown as NextRequest;
}

describe("checkAiRateLimit", () => {
  beforeEach(() => {
    _resetRateLimitStore();
  });

  it("enforces the per-minute limit for both tiers", () => {
    const req = makeRequest("3.3.3.3");
    expect(checkAiRateLimit(req, "session", 1)).toBeNull();
    expect(checkAiRateLimit(req, "session", 1)?.status).toBe(429);
  });

  it("caps low-trust callers at the daily limit even under the minute limit", () => {
    const req = makeRequest("4.4.4.4");
    // Minute limit high enough to never trip in this loop:
    for (let i = 0; i < LOW_TRUST_DAILY_LIMIT; i++) {
      expect(checkAiRateLimit(req, "low-trust", 100_000)).toBeNull();
    }
    expect(checkAiRateLimit(req, "low-trust", 100_000)?.status).toBe(429);
  });

  it("does not apply the daily cap to session-trust callers", () => {
    const req = makeRequest("5.5.5.5");
    for (let i = 0; i < LOW_TRUST_DAILY_LIMIT + 5; i++) {
      expect(checkAiRateLimit(req, "session", 100_000)).toBeNull();
    }
  });
});
