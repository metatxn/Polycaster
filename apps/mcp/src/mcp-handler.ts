import { createLogger } from "@knoww/logger";
import { createMcpHandler, type StatelessMcpHandler } from "agents/mcp/server";
import { MCP_ANALYTICS_EVENTS, parseMcpProtocolMessages } from "./analytics";
import type { WorkerConfig } from "./config";
import {
  currentAnalytics,
  currentPrincipal,
  currentRequestId,
} from "./context";
import { createKnowwMcpServer } from "./server";

const log = createLogger("mcp");

// Deployment configuration is static. The map keeps local test overrides from
// sharing a handler with production-shaped requests in the same isolate.
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

export async function dispatchMcpRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  config: WorkerConfig
): Promise<Response> {
  const startedAt = Date.now();
  const metadataPromise =
    request.method === "POST"
      ? request
          .clone()
          .json<unknown>()
          .then(parseMcpProtocolMessages)
          .catch(() => [])
      : Promise.resolve([]);

  const captureOutcome = async (status: number) => {
    const analytics = currentAnalytics();
    const principal = currentPrincipal();
    const metadata = await metadataPromise;
    for (const properties of metadata) {
      analytics?.capture(
        MCP_ANALYTICS_EVENTS.protocolRequestCompleted,
        {
          request_id: currentRequestId(),
          ...properties,
          status,
          outcome: status < 400 ? "success" : "error",
          duration_ms: Date.now() - startedAt,
          auth_method: principal?.authMethod,
          plan: principal?.plan,
        },
        principal?.id
      );
    }
  };

  try {
    const response = await handlerFor(config)(request, env, ctx);
    await captureOutcome(response.status);
    return response;
  } catch (error) {
    await captureOutcome(500);
    throw error;
  }
}
