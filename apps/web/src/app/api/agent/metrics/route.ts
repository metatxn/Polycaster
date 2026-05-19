import { createLogger } from "@knoww/logger";
import { type NextRequest, NextResponse } from "next/server";
import { jsonError, requireAgentAdmin } from "@/lib/agent/api";
import { getAgentRepository } from "@/lib/agent/repository";
import { checkRateLimit } from "@/lib/api-rate-limit";

const log = createLogger("api.agent.metrics");

/**
 * @openapi
 * /api/agent/metrics:
 *   get:
 *     summary: Get paper-trading agent metrics
 *     tags: [Agent]
 *     responses:
 *       200:
 *         description: Aggregate paper-trading metrics.
 *       401:
 *         description: Missing or invalid admin token.
 *       429:
 *         description: Rate limit exceeded.
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
      metrics: await repository.getMetrics(),
    });
  } catch (error) {
    log.error("metrics.failed", { error });
    return jsonError("Failed to load agent metrics", 500);
  }
}
