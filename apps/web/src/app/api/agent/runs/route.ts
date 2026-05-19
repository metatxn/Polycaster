import { DecimalStringSchema, runPaperAgent } from "@knoww/agent";
import { createLogger } from "@knoww/logger";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  jsonError,
  readJson,
  requireAgentAdmin,
  requireMutatingAgentAdmin,
} from "@/lib/agent/api";
import { getAgentRepository } from "@/lib/agent/repository";
import { checkRateLimit } from "@/lib/api-rate-limit";

const log = createLogger("api.agent.runs");

const RunInputSchema = z.object({
  watchlistItemIds: z.array(z.string().uuid()).max(25).optional(),
  portfolio: z
    .object({
      bankrollUsd: DecimalStringSchema,
      cashUsd: DecimalStringSchema,
      maxPositionUsd: DecimalStringSchema,
      maxTradeUsd: DecimalStringSchema,
      maxDrawdownPct: DecimalStringSchema,
      realizedPnlUsd: z
        .string()
        .trim()
        .regex(/^-?\d+(\.\d+)?$/),
    })
    .optional(),
  executionMode: z.enum(["paper", "live"]).optional(),
});

/**
 * @openapi
 * /api/agent/runs:
 *   get:
 *     summary: List paper-trading agent runs
 *     tags: [Agent]
 *     responses:
 *       200:
 *         description: Recent run summaries.
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
      runs: await repository.listRuns(),
    });
  } catch (error) {
    log.error("list.failed", { error });
    return jsonError("Failed to list agent runs", 500);
  }
}

/**
 * @openapi
 * /api/agent/runs:
 *   post:
 *     summary: Manually run the paper-trading agent
 *     tags: [Agent]
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               watchlistItemIds:
 *                 type: array
 *                 maxItems: 25
 *                 items:
 *                   type: string
 *                   format: uuid
 *               portfolio:
 *                 type: object
 *                 properties:
 *                   bankrollUsd:
 *                     type: string
 *                   cashUsd:
 *                     type: string
 *                   maxPositionUsd:
 *                     type: string
 *                   maxTradeUsd:
 *                     type: string
 *                   maxDrawdownPct:
 *                     type: string
 *                   realizedPnlUsd:
 *                     type: string
 *     responses:
 *       200:
 *         description: Completed run detail.
 *       400:
 *         description: Invalid input.
 *       401:
 *         description: Missing or invalid admin token.
 *       403:
 *         description: Origin validation failed.
 *       500:
 *         description: Run failed.
 */
export async function POST(request: NextRequest) {
  const auth = requireMutatingAgentAdmin(request);
  if (auth) return auth;

  try {
    let body: unknown = {};
    if (request.headers.get("content-length") !== "0") {
      try {
        body = await readJson(request);
      } catch {
        return jsonError("Invalid JSON payload", 400);
      }
    }
    const parsed = RunInputSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError("Invalid run input", 400, parsed.error.flatten());
    }
    const repository = await getAgentRepository();
    const run = await runPaperAgent(repository, parsed.data);
    return NextResponse.json({ success: true, run });
  } catch (error) {
    log.error("run.failed", { error });
    return jsonError("Failed to run paper-trading agent", 500);
  }
}
