import { createLogger } from "@knoww/logger";
import { createMcpHandler, type StatelessMcpHandler } from "agents/mcp/server";
import { type WorkerConfig, workerConfigFromEnv } from "./config";
import { currentRequestId, requestContext } from "./context";
import { createKnowwMcpServer } from "./server";

const log = createLogger("mcp");

// Vars are static per deployment, so this holds one handler in practice; the
// map only exists because config must be read from the per-request env.
const handlerCache = new Map<string, StatelessMcpHandler>();

function handlerFor(config: WorkerConfig): StatelessMcpHandler {
  const key = JSON.stringify([
    config.allowedHostnames,
    config.allowedOriginHostnames,
  ]);
  let handler = handlerCache.get(key);
  if (!handler) {
    handler = createMcpHandler(() => createKnowwMcpServer(), {
      route: "/mcp",
      allowedHostnames: config.allowedHostnames,
      allowedOriginHostnames: config.allowedOriginHostnames,
      onerror(error) {
        log.error("handler.failed", {
          requestId: currentRequestId(),
          errorName: error.name,
        });
      },
    });
    handlerCache.set(key, handler);
  }
  return handler;
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  requestId: string,
  extraHeaders?: Record<string, string>
): Response {
  return Response.json(
    { error: { code, message, requestId } },
    { status, headers: { "x-request-id": requestId, ...extraHeaders } }
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
      if (url.pathname !== "/mcp") {
        log.info("request.finished", {
          requestId,
          status: 404,
          durationMs: Date.now() - startedAt,
        });
        return errorResponse(404, "NOT_FOUND", "Not found.", requestId);
      }

      const config = workerConfigFromEnv(env);
      if (config.authMode !== "dev-bypass") {
        log.warn("auth.denied", {
          requestId,
          reason: "oauth_not_yet_available",
        });
        return errorResponse(
          401,
          "UNAUTHENTICATED",
          "Authentication required.",
          requestId,
          { "www-authenticate": 'Bearer realm="knoww-mcp"' }
        );
      }

      // Run the MCP handler inside the request context so tool callbacks can
      // stamp their meta with the same id the worker logs and echoes in the
      // x-request-id header.
      const response = await requestContext.run({ requestId }, () =>
        handlerFor(config)(request, env, ctx)
      );
      log.info("request.finished", {
        requestId,
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      const withId = new Response(response.body, response);
      withId.headers.set("x-request-id", requestId);
      return withId;
    } catch (error) {
      log.error("request.failed", {
        requestId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
      return errorResponse(
        500,
        "INTERNAL_ERROR",
        "Something went wrong.",
        requestId
      );
    }
  },
} satisfies ExportedHandler<Env>;

export default worker;
