import { fetchMarketResolution } from "@knoww/agent";
import { createLogger } from "@knoww/logger";
import { type NextRequest, NextResponse } from "next/server";
import {
  jsonError,
  requireAgentAdmin,
  requireMutatingAgentAdmin,
} from "@/lib/agent/api";
import { getAgentRepository } from "@/lib/agent/repository";
import { checkRateLimit } from "@/lib/api-rate-limit";

const log = createLogger("api.agent.resolutions");

/**
 * @openapi
 * /api/agent/resolutions:
 *   get:
 *     summary: List stored market resolutions
 *     tags: [Agent]
 *     responses:
 *       200:
 *         description: Resolutions known to the agent.
 */
export async function GET(request: NextRequest) {
  const auth = requireAgentAdmin(request);
  if (auth) return auth;
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const repository = await getAgentRepository();
    return NextResponse.json({
      success: true,
      resolutions: await repository.listResolutions(),
    });
  } catch (error) {
    log.error("list.failed", { error });
    return jsonError("Failed to list resolutions", 500);
  }
}

/**
 * @openapi
 * /api/agent/resolutions:
 *   post:
 *     summary: Refresh resolutions for active watchlist items past their end time
 *     tags: [Agent]
 *     responses:
 *       200:
 *         description: Summary of resolution refresh.
 */
export async function POST(request: NextRequest) {
  const auth = requireMutatingAgentAdmin(request);
  if (auth) return auth;
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 12,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const repository = await getAgentRepository();
    const items = await repository.listWatchlist();
    const nowIso = new Date().toISOString();
    // Only fetch for items whose event end time has passed AND we don't
    // already have a stored resolution. Skips items missing conditionId
    // or end time so we don't burn gamma calls on unresolvable rows.
    const candidates = [];
    for (const item of items) {
      if (!item.conditionId) continue;
      if (!item.eventEndTime) continue;
      if (item.eventEndTime > nowIso) continue;
      const existing = await repository.getResolutionByTokenId(item.tokenId);
      if (existing) continue;
      candidates.push(item);
    }

    let resolvedCount = 0;
    let settledPositionCount = 0;
    const skipped: string[] = [];
    for (const item of candidates) {
      const resolution = await fetchMarketResolution(item);
      if (!resolution) {
        skipped.push(item.tokenId);
        continue;
      }
      await repository.upsertResolution(resolution);
      resolvedCount += 1;
      // Cascade: any open position on this token settles at the resolved
      // outcome price (0 or 1 on Polymarket binary markets). This is the
      // only way realized P&L flows in when the agent holds to resolution.
      const settlementPrice = resolution.outcomeYes === 1 ? "1" : "0";
      const openPositions = await repository.listOpenPositionsByToken(
        resolution.tokenId
      );
      for (const position of openPositions) {
        await repository.closePosition(position.id, {
          exitPrice: settlementPrice,
          closeReason: "resolution",
          closedRunId: null,
        });
        settledPositionCount += 1;
      }
    }

    return NextResponse.json({
      success: true,
      checked: candidates.length,
      resolved: resolvedCount,
      settledPositions: settledPositionCount,
      stillUnresolved: skipped,
    });
  } catch (error) {
    log.error("refresh.failed", { error });
    return jsonError("Failed to refresh resolutions", 500);
  }
}
