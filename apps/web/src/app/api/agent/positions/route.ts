import { createLogger } from "@knoww/logger";
import { type NextRequest, NextResponse } from "next/server";
import { jsonError, requireAgentAdmin } from "@/lib/agent/api";
import { getAgentRepository } from "@/lib/agent/repository";
import { checkRateLimit } from "@/lib/api-rate-limit";

const log = createLogger("api.agent.positions");

/**
 * @openapi
 * /api/agent/positions:
 *   get:
 *     summary: List paper-trading positions (open + closed)
 *     tags: [Agent]
 *     responses:
 *       200:
 *         description: Positions and aggregate P&L.
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
    const [positions, pnl] = await Promise.all([
      repository.listPositions(),
      repository.getPortfolioPnl(),
    ]);
    return NextResponse.json({ success: true, positions, pnl });
  } catch (error) {
    log.error("list.failed", { error });
    return jsonError("Failed to load positions", 500);
  }
}
