import { createLogger } from "@knoww/logger";
import { type NextRequest, NextResponse } from "next/server";
import { jsonError, requireAgentAdmin } from "@/lib/agent/api";
import { getAgentRepository } from "@/lib/agent/repository";
import { checkRateLimit } from "@/lib/api-rate-limit";

const log = createLogger("api.agent.calibration");

/**
 * @openapi
 * /api/agent/calibration:
 *   get:
 *     summary: Per-model Brier scores over resolved markets
 *     tags: [Agent]
 *     responses:
 *       200:
 *         description: Calibration summary.
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
      calibration: await repository.getCalibration(),
    });
  } catch (error) {
    log.error("calibration.failed", { error });
    return jsonError("Failed to load calibration", 500);
  }
}
