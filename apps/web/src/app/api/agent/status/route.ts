import { getLlmPanelStatus } from "@knoww/agent";
import { type NextRequest, NextResponse } from "next/server";
import { requireAgentAdmin } from "@/lib/agent/api";
import { checkRateLimit } from "@/lib/api-rate-limit";

/**
 * @openapi
 * /api/agent/status:
 *   get:
 *     summary: Get paper-trading agent readiness status
 *     tags: [Agent]
 *     responses:
 *       200:
 *         description: Agent provider readiness without secret values.
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

  return NextResponse.json({
    success: true,
    status: {
      llm: getLlmPanelStatus(),
      admin: {
        configured: Boolean(process.env.AGENT_ADMIN_TOKEN),
      },
    },
  });
}
