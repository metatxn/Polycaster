import { type NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/api-rate-limit";
import {
  requireExtensionSession,
  revokeExtensionSession,
} from "@/lib/auth/extension-session";

export async function POST(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 20,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { session, response } = await requireExtensionSession(request);
    if (response || !session) {
      return (
        response ??
        NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      );
    }

    await revokeExtensionSession(session);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "Failed to revoke extension session" },
      { status: 503 }
    );
  }
}
