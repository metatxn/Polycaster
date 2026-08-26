import { createLogger } from "@knoww/logger";
import { createMcpHandler, type StatelessMcpHandler } from "agents/mcp/server";
import type { WorkerConfig } from "./config";
import { currentRequestId } from "./context";
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

export function dispatchMcpRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  config: WorkerConfig
): Promise<Response> {
  return handlerFor(config)(request, env, ctx);
}
