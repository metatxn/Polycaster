import { createLogger } from "@knoww/logger";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, requireAgentAdmin } from "@/lib/agent/api";
import { getAgentRepository } from "@/lib/agent/repository";
import { checkRateLimit } from "@/lib/api-rate-limit";

const log = createLogger("api.agent.runs.detail");
const RunIdSchema = z.string().uuid();

/**
 * @openapi
 * /api/agent/runs/{id}:
 *   get:
 *     summary: Get paper-trading agent run detail
 *     tags: [Agent]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Run detail.
 *       400:
 *         description: Invalid run id.
 *       401:
 *         description: Missing or invalid admin token.
 *       404:
 *         description: Run not found.
 *       429:
 *         description: Rate limit exceeded.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireAgentAdmin(request);
  if (auth) return auth;
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 60,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { id } = await params;
    const parsedId = RunIdSchema.safeParse(id);
    if (!parsedId.success) {
      return jsonError("Invalid run id", 400);
    }
    const repository = await getAgentRepository();
    const run = await repository.getRun(parsedId.data);
    if (!run) return jsonError("Run not found", 404);
    return NextResponse.json({ success: true, run });
  } catch (error) {
    log.error("detail.failed", { error });
    return jsonError("Failed to load agent run", 500);
  }
}
