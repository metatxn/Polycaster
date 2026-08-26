import { createLogger } from "@knoww/logger";

const log = createLogger("mcp.health");
const READINESS_PROBE_ID = "knoww-mcp-readiness";
const INTERNAL_ORIGIN = "https://wallet-challenge.internal";

function healthResponse(
  status: "ok" | "ready" | "unavailable",
  requestId: string,
  httpStatus: number
): Response {
  return Response.json(
    { status, service: "knoww-mcp", requestId },
    {
      status: httpStatus,
      headers: { "cache-control": "no-store" },
    }
  );
}

async function checkStatefulBindings(env: Env): Promise<void> {
  await env.OAUTH_KV.get(READINESS_PROBE_ID);
  const id = env.MCP_AUTH_CHALLENGES.idFromName(READINESS_PROBE_ID);
  const response = await env.MCP_AUTH_CHALLENGES.get(id).fetch(
    new Request(`${INTERNAL_ORIGIN}/health`)
  );
  if (!response.ok) {
    throw new Error("Durable Object readiness check failed.");
  }
}

/**
 * @openapi
 * /healthz:
 *   get:
 *     summary: Check MCP Worker liveness.
 *     tags: [Operations]
 *     responses:
 *       200:
 *         description: The Worker can serve requests.
 *       429:
 *         description: Liveness request quota exceeded.
 * /readyz:
 *   get:
 *     summary: Check OAuth state-store readiness.
 *     tags: [Operations]
 *     responses:
 *       200:
 *         description: Required stateful bindings responded.
 *       429:
 *         description: Readiness request quota exceeded.
 *       503:
 *         description: A required binding did not respond.
 */
export async function handleHealthRequest(
  request: Request,
  env: Env,
  requestId: string
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (pathname !== "/healthz" && pathname !== "/readyz") return null;

  if (request.method !== "GET") {
    return new Response(null, {
      status: 405,
      headers: { allow: "GET", "cache-control": "no-store" },
    });
  }

  if (pathname === "/healthz") {
    return healthResponse("ok", requestId, 200);
  }

  try {
    await checkStatefulBindings(env);
    return healthResponse("ready", requestId, 200);
  } catch (error) {
    log.error("readiness.failed", {
      requestId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return healthResponse("unavailable", requestId, 503);
  }
}
