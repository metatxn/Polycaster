import { type NextRequest, NextResponse } from "next/server";
import { jsonError } from "@/lib/api-error";
import { checkRateLimit } from "@/lib/api-rate-limit";
import {
  requireExtensionSession,
  revokeExtensionSession,
} from "@/lib/auth/extension-session";
import {
  extensionCorsHeaders,
  handleExtensionPreflight,
} from "@/lib/extension-auth";

export async function OPTIONS(request: NextRequest) {
  return handleExtensionPreflight(request);
}

export async function POST(request: NextRequest) {
  const cors = extensionCorsHeaders(request);

  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 20,
  });
  if (rateLimitResponse) {
    for (const [k, v] of Object.entries(cors))
      rateLimitResponse.headers.set(k, v);
    return rateLimitResponse;
  }

  try {
    const { session, response } = await requireExtensionSession(request);
    if (response || !session) {
      const res = response ?? jsonError("Unauthorized", 401);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    }

    await revokeExtensionSession(session);

    return NextResponse.json({ success: true }, { status: 200, headers: cors });
  } catch {
    const res = jsonError("Failed to revoke extension session", 503);
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  }
}
