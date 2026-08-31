import { createExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { requestContext } from "../context";
import { type KnowwToolError, requireToolScope } from "../errors/tool-error";
import { mcpOAuthApiHandler } from "./api";
import { MARKETS_READ_SCOPE } from "./scopes";
import type { McpOAuthEnv } from "./types";

describe("tool scope enforcement", () => {
  it("rejects a tool call without an authenticated principal", () => {
    expect(() => requireToolScope(MARKETS_READ_SCOPE)).toThrowError(
      expect.objectContaining<Partial<KnowwToolError>>({
        code: "UNAUTHENTICATED",
      })
    );
  });

  it("rejects a principal that lacks the tool scope", () => {
    expect(() =>
      requestContext.run(
        {
          requestId: "scope-test",
          principal: {
            authMethod: "google-oidc",
            id: "google-test",
            plan: "free",
            scopes: [],
          },
        },
        () => requireToolScope(MARKETS_READ_SCOPE)
      )
    ).toThrowError(
      expect.objectContaining<Partial<KnowwToolError>>({ code: "FORBIDDEN" })
    );
  });

  it("allows a principal with the exact tool scope", () => {
    expect(() =>
      requestContext.run(
        {
          requestId: "scope-test",
          principal: {
            authMethod: "google-oidc",
            id: "google-test",
            plan: "free",
            scopes: [MARKETS_READ_SCOPE],
          },
        },
        () => requireToolScope(MARKETS_READ_SCOPE)
      )
    ).not.toThrow();
  });

  it("returns an insufficient_scope challenge before MCP dispatch", async () => {
    const ctx = createExecutionContext() as ExecutionContext & {
      props: unknown;
    };
    ctx.props = {
      authMethod: "google-oidc",
      googleSubject: "102030405060708090",
      principalId: "google-102030405060708090",
      plan: "free",
      scopes: [],
    };

    const response = await mcpOAuthApiHandler.fetch(
      new Request("https://mcp.knoww.app/mcp", {
        method: "POST",
        headers: { host: "mcp.knoww.app" },
      }),
      env as McpOAuthEnv,
      ctx
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toContain(
      'error="insufficient_scope"'
    );
    expect(response.headers.get("www-authenticate")).toContain(
      'scope="markets:read"'
    );
  });

  it("enforces the free-plan principal quota before MCP dispatch", async () => {
    const keys: string[] = [];
    const limiter = {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        return { success: false };
      },
    } as RateLimit;
    const ctx = createExecutionContext() as ExecutionContext & {
      props: unknown;
    };
    ctx.props = {
      authMethod: "google-oidc",
      googleSubject: "102030405060708090",
      principalId: "google-102030405060708090",
      plan: "free",
      scopes: [MARKETS_READ_SCOPE],
    };

    const response = await mcpOAuthApiHandler.fetch(
      new Request("https://mcp.knoww.app/mcp", {
        method: "POST",
        headers: { host: "mcp.knoww.app" },
      }),
      { ...env, MCP_FREE_PRINCIPAL_RATE_LIMITER: limiter } as McpOAuthEnv,
      ctx
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(keys).toEqual(["free:google-102030405060708090"]);
  });
});
