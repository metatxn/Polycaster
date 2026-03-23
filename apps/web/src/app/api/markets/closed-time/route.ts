import { type NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { getCacheHeaders } from "@/lib/cache-headers";
import { getClobHost } from "@/lib/polymarket";

/**
 * Polymarket condition IDs are hex strings, optionally 0x-prefixed.
 * Reject anything that could cause path traversal or URL manipulation.
 */
const CONDITION_ID_RE = /^(?:0x)?[a-fA-F0-9]{1,128}$/;

/**
 * GET /api/markets/closed-time?ids=conditionId1,conditionId2,...
 *
 * Returns `end_date_iso` for each condition ID by querying the CLOB API.
 * Used by the portfolio page to resolve accurate closed timestamps for
 * lost positions.
 */
export async function GET(request: NextRequest) {
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  const idsParam = request.nextUrl.searchParams.get("ids");
  if (!idsParam) {
    return NextResponse.json(
      { success: false, error: "Missing 'ids' query parameter" },
      { status: 400 }
    );
  }

  const conditionIds = idsParam
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 50);

  if (conditionIds.length === 0) {
    return NextResponse.json(
      { success: false, error: "No valid condition IDs provided" },
      { status: 400 }
    );
  }

  if (conditionIds.some((id) => !CONDITION_ID_RE.test(id))) {
    return NextResponse.json(
      { success: false, error: "Invalid condition ID format" },
      { status: 400 }
    );
  }

  const host = getClobHost();
  const closedTimes: Record<string, string> = {};

  const results = await Promise.allSettled(
    conditionIds.map(async (id) => {
      const res = await fetch(`${host}/markets/${encodeURIComponent(id)}`);
      if (!res.ok) return { id, date: null };
      const data = (await res.json()) as {
        end_date_iso?: string;
        endDate?: string;
      };
      return { id, date: data.end_date_iso || data.endDate || null };
    })
  );

  for (const result of results) {
    if (result.status === "fulfilled" && result.value.date) {
      closedTimes[result.value.id] = result.value.date;
    }
  }

  return NextResponse.json(
    { success: true, closedTimes },
    { headers: getCacheHeaders("events") }
  );
}
