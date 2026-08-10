import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { checkAiRateLimit } from "./ai-rate-limit";
import { TRUSTED_CLIENT_IP_HEADER } from "./client-ip";
import { _resetRateLimitStore } from "./rate-limit";

function makeRequest(ip: string): NextRequest {
  return {
    headers: new Headers({ [TRUSTED_CLIENT_IP_HEADER]: ip }),
    nextUrl: new URL("http://localhost/api/ai/extract-topics"),
  } as unknown as NextRequest;
}

describe("checkAiRateLimit", () => {
  beforeEach(() => {
    _resetRateLimitStore();
  });

  it("enforces the authenticated per-minute limit", () => {
    const req = makeRequest("3.3.3.3");
    expect(checkAiRateLimit(req, 1)).toBeNull();
    expect(checkAiRateLimit(req, 1)?.status).toBe(429);
  });
});
