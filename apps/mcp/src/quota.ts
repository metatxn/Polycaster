import type { McpPlan } from "./auth/scopes";
import { type RequestPrincipal, requestContext } from "./context";
import { KnowwToolError } from "./errors/tool-error";

export const QUOTA_RETRY_AFTER_SECONDS = 60;

export function quotaResponse(requestId: string): Response {
  return Response.json(
    {
      error: {
        code: "RATE_LIMITED",
        message: "Request quota exceeded.",
        requestId,
      },
    },
    {
      status: 429,
      headers: {
        "cache-control": "no-store",
        "retry-after": String(QUOTA_RETRY_AFTER_SECONDS),
        "x-request-id": requestId,
      },
    }
  );
}

function sourceAddress(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

export async function checkEdgeQuota(
  request: Request,
  env: Env
): Promise<boolean> {
  const outcome = await env.MCP_EDGE_RATE_LIMITER.limit({
    key: `source:${sourceAddress(request)}`,
  });
  return outcome.success;
}

export async function checkPrincipalQuota(
  env: Env,
  principal: RequestPrincipal
): Promise<boolean> {
  const limiter = principalLimiterFor(env, principal.plan);
  const outcome = await limiter.limit({
    key: `${principal.plan}:${principal.id}`,
  });
  return outcome.success;
}

function principalLimiterFor(env: Env, plan: McpPlan): RateLimit {
  switch (plan) {
    case "free":
      return env.MCP_FREE_PRINCIPAL_RATE_LIMITER;
  }
}

export function toolLimiterFor(env: Env, plan: McpPlan): RateLimit {
  switch (plan) {
    case "free":
      return env.MCP_FREE_TOOL_RATE_LIMITER;
  }
}

export async function requireToolQuota(toolName: string): Promise<void> {
  const context = requestContext.getStore();
  const principal = context?.principal;
  if (!principal) {
    throw new KnowwToolError(
      "UNAUTHENTICATED",
      "Authenticate before calling this tool."
    );
  }
  if (!context.toolRateLimiter) {
    throw new KnowwToolError("INTERNAL_ERROR", "Something went wrong.");
  }
  const outcome = await context.toolRateLimiter.limit({
    key: `${principal.plan}:${principal.id}:${toolName}`,
  });
  if (!outcome.success) {
    throw new KnowwToolError(
      "RATE_LIMITED",
      "This tool's request quota has been reached.",
      { retryAfterSeconds: QUOTA_RETRY_AFTER_SECONDS }
    );
  }
}
