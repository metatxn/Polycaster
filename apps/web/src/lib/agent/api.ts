import { createLogger } from "@knoww/logger";
import { type NextRequest, NextResponse } from "next/server";
import { checkOriginAndFetchSite } from "@/lib/origin-guard";

const log = createLogger("agent.api");

export function jsonError(
  message: string,
  status: number,
  details?: unknown
): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: message,
      ...(details ? { details } : {}),
    },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

export async function readJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new Error("Invalid JSON payload");
  }
}

export function requireAgentAdmin(request: NextRequest): NextResponse | null {
  const configuredToken = process.env.AGENT_ADMIN_TOKEN;
  if (!configuredToken) {
    if (process.env.NODE_ENV === "development") return null;
    log.error("admin.token.missing", {
      reason: "AGENT_ADMIN_TOKEN is required outside development",
    });
    return jsonError("Agent admin access is not configured", 503);
  }

  const authHeader = request.headers.get("authorization");
  const headerToken = request.headers.get("x-knoww-agent-token");
  const bearer = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : null;
  if (headerToken === configuredToken || bearer === configuredToken) {
    return null;
  }
  return jsonError("Unauthorized", 401);
}

export function requireMutatingAgentAdmin(
  request: NextRequest
): NextResponse | null {
  return requireAgentAdmin(request) ?? checkOriginAndFetchSite(request);
}
