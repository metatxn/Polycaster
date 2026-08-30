import { createLogger } from "@knoww/logger";
import { oauthProviderFor } from "./auth/provider";
import { FREE_MCP_PLAN, MARKETS_READ_SCOPE } from "./auth/scopes";
import type { McpOAuthEnv } from "./auth/types";
import { boundPublicRequestBody } from "./body-limit";
import { type WorkerConfig, workerConfigFromEnv } from "./config";
import { type RequestPrincipal, requestContext } from "./context";
import { handleHealthRequest } from "./health";
import { dispatchMcpRequest } from "./mcp-handler";
import {
  checkEdgeQuota,
  checkPrincipalQuota,
  quotaResponse,
  toolLimiterFor,
} from "./quota";

export { WalletChallengeStore } from "./auth/challenge-store";

const log = createLogger("mcp");

function errorResponse(
  status: number,
  code: string,
  message: string,
  requestId: string,
  extraHeaders?: Record<string, string>
): Response {
  return Response.json(
    { error: { code, message, requestId } },
    {
      status,
      headers: {
        "cache-control": "no-store",
        "x-request-id": requestId,
        ...extraHeaders,
      },
    }
  );
}

function finalizeResponse(
  response: Response,
  requestId: string,
  useHsts: boolean
): Response {
  const finalized = new Response(response.body, response);
  finalized.headers.set("x-request-id", requestId);
  finalized.headers.set("x-content-type-options", "nosniff");
  if (!finalized.headers.has("referrer-policy")) {
    finalized.headers.set("referrer-policy", "no-referrer");
  }
  finalized.headers.set(
    "permissions-policy",
    "camera=(), geolocation=(), microphone=()"
  );
  if (useHsts) {
    finalized.headers.set("strict-transport-security", "max-age=31536000");
  }
  return finalized;
}

function inboundHostname(request: Request): string | null {
  const hostHeader = request.headers.get("host");
  if (!hostHeader) {
    return new URL(request.url).hostname.toLowerCase();
  }
  if (hostHeader !== hostHeader.trim() || /[\s/\\@?#,]/u.test(hostHeader)) {
    return null;
  }
  try {
    const parsed = new URL(`http://${hostHeader}`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isAuthRateLimitedPath(pathname: string): boolean {
  return (
    pathname === "/authorize" ||
    pathname === "/authorize/message" ||
    pathname === "/oauth/token" ||
    pathname === "/oauth/register"
  );
}

async function checkAuthRateLimit(
  request: Request,
  env: Env
): Promise<boolean> {
  if (request.method === "OPTIONS") return true;
  const url = new URL(request.url);
  if (!isAuthRateLimitedPath(url.pathname)) return true;
  const clientAddress = request.headers.get("cf-connecting-ip") ?? "unknown";
  const outcome = await env.MCP_AUTH_RATE_LIMITER.limit({
    key: `${url.pathname}:${clientAddress}`,
  });
  return outcome.success;
}

async function dispatchDevelopmentRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  config: WorkerConfig,
  requestId: string
): Promise<Response> {
  if (new URL(request.url).pathname !== "/mcp") {
    return errorResponse(404, "NOT_FOUND", "Not found.", requestId);
  }
  const principal: RequestPrincipal = {
    authMethod: "dev-bypass",
    id: "local-development",
    plan: FREE_MCP_PLAN,
    scopes: [MARKETS_READ_SCOPE],
  };
  if (!(await checkPrincipalQuota(env, principal))) {
    return quotaResponse(requestId);
  }
  return requestContext.run(
    {
      requestId,
      principal,
      toolRateLimiter: toolLimiterFor(env, principal.plan),
    },
    () => dispatchMcpRequest(request, env, ctx, config)
  );
}

function dispatchOAuthRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  config: WorkerConfig,
  requestId: string
): Promise<Response> {
  const provider = oauthProviderFor(config);
  return requestContext.run({ requestId }, () =>
    provider.fetch(request, env as McpOAuthEnv, ctx)
  );
}

const worker = {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const url = new URL(request.url);
    log.info("request.started", {
      requestId,
      method: request.method,
      path: url.pathname,
    });

    try {
      const config = workerConfigFromEnv(env);
      const useHsts = new URL(config.canonicalResource).protocol === "https:";
      const hostname = inboundHostname(request);
      if (!hostname || !config.allowedHostnames.includes(hostname)) {
        log.warn("request.denied", { requestId, reason: "invalid_host" });
        return finalizeResponse(
          errorResponse(403, "FORBIDDEN", "Forbidden.", requestId),
          requestId,
          useHsts
        );
      }

      let response: Response;
      if (!(await checkEdgeQuota(request, env))) {
        log.warn("request.denied", {
          requestId,
          path: url.pathname,
          reason: "edge_rate_limited",
        });
        response = quotaResponse(requestId);
      } else if (
        config.authMode === "oauth-required" &&
        !(await checkAuthRateLimit(request, env))
      ) {
        log.warn("auth.denied", { requestId, reason: "rate_limited" });
        response = errorResponse(
          429,
          "RATE_LIMITED",
          "Too many authentication requests.",
          requestId,
          { "retry-after": "60" }
        );
      } else {
        const boundedRequest = await boundPublicRequestBody(request, requestId);
        if (boundedRequest instanceof Response) {
          response = boundedRequest;
        } else {
          const healthResponse = await handleHealthRequest(
            boundedRequest,
            env,
            requestId
          );
          if (healthResponse) {
            response = healthResponse;
          } else if (config.authMode === "dev-bypass") {
            response = await dispatchDevelopmentRequest(
              boundedRequest,
              env,
              ctx,
              config,
              requestId
            );
          } else {
            response = await dispatchOAuthRequest(
              boundedRequest,
              env,
              ctx,
              config,
              requestId
            );
          }
        }
      }

      log.info("request.finished", {
        requestId,
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      return finalizeResponse(response, requestId, useHsts);
    } catch (error) {
      log.error("request.failed", {
        requestId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return finalizeResponse(
        errorResponse(
          500,
          "INTERNAL_ERROR",
          "Something went wrong.",
          requestId
        ),
        requestId,
        url.protocol === "https:"
      );
    }
  },
} satisfies ExportedHandler<Env>;

export default worker;
