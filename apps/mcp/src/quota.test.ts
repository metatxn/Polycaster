import { describe, expect, it } from "vitest";
import { requestContext } from "./context";
import type { KnowwToolError } from "./errors/tool-error";
import { requireToolQuota } from "./quota";

function fakeLimiter(success: boolean, keys: string[]): RateLimit {
  return {
    limit: async ({ key }) => {
      keys.push(key);
      return { success };
    },
  } as RateLimit;
}

describe("MCP tool quotas", () => {
  it("keys tool quotas by plan, principal, and tool", async () => {
    const keys: string[] = [];

    await requestContext.run(
      {
        requestId: "quota-test",
        principal: {
          authMethod: "google-oidc",
          id: "google-test",
          plan: "free",
          scopes: ["markets:read"],
        },
        toolRateLimiter: fakeLimiter(true, keys),
      },
      () => requireToolQuota("search_markets")
    );

    expect(keys).toEqual(["free:google-test:search_markets"]);
  });

  it("returns a retryable tool error when the quota is exhausted", async () => {
    await expect(
      requestContext.run(
        {
          requestId: "quota-test",
          principal: {
            authMethod: "google-oidc",
            id: "google-test",
            plan: "free",
            scopes: ["markets:read"],
          },
          toolRateLimiter: fakeLimiter(false, []),
        },
        () => requireToolQuota("get_market")
      )
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
      retryAfterSeconds: 60,
    } satisfies Partial<KnowwToolError>);
  });

  it("fails closed when the tool limiter is missing", async () => {
    await expect(
      requestContext.run(
        {
          requestId: "quota-test",
          principal: {
            authMethod: "google-oidc",
            id: "google-test",
            plan: "free",
            scopes: ["markets:read"],
          },
        },
        () => requireToolQuota("get_event")
      )
    ).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    } satisfies Partial<KnowwToolError>);
  });
});
