import {
  AGENT_EXECUTION_LOCK_KEY,
  AGENT_EXECUTION_LOCK_LEASE_MS,
  DecimalStringSchema,
  resolveAgentExecutionMode,
  runPaperAgent,
  startAgentExecutionLockHeartbeat,
} from "@knoww/agent";
import { createLogger } from "@knoww/logger";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  JsonBodyError,
  jsonError,
  readJson,
  requireAgentAdmin,
  requireMutatingAgentAdmin,
} from "@/lib/agent/api";
import {
  DurableAgentRepositoryUnavailableError,
  getAgentRepository,
} from "@/lib/agent/repository";
import { checkRateLimit } from "@/lib/api-rate-limit";

const log = createLogger("api.agent.runs");
const LiveRunIdempotencyKeySchema = z.string().uuid();

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

async function fingerprintRunIntent(
  input: z.infer<typeof RunInputSchema>,
  executionMode: "live" | "paper"
): Promise<string> {
  const canonical = JSON.stringify({
    executionMode,
    watchlistItemIds: [...(input.watchlistItemIds ?? [])].sort(),
    portfolio: input.portfolio ?? null,
  });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

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
 *               executionMode:
 *                 type: string
 *                 enum: [paper, live]
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: false
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Required for live runs. Reuse the key when retrying the same run intent.
 *     responses:
 *       200:
 *         description: Completed run detail.
 *       400:
 *         description: Invalid input.
 *       401:
 *         description: Missing or invalid admin token.
 *       403:
 *         description: Origin validation failed.
 *       409:
 *         description: Another agent execution currently holds the global lock.
 *       429:
 *         description: Rate limit exceeded.
 *       500:
 *         description: Run failed.
 *       503:
 *         description: Durable live-run storage is unavailable.
 */
export async function POST(request: NextRequest) {
  const auth = requireMutatingAgentAdmin(request);
  if (auth) return auth;

  try {
    let body: unknown = {};
    if (request.headers.get("content-length") !== "0") {
      try {
        body = await readJson(request);
      } catch (error) {
        if (error instanceof JsonBodyError) {
          return jsonError(error.message, error.status);
        }
        return jsonError("Invalid JSON payload", 400);
      }
    }
    const parsed = RunInputSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError("Invalid run input", 400);
    }

    const executionMode = resolveAgentExecutionMode(parsed.data.executionMode);
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (
      executionMode === "live" &&
      !LiveRunIdempotencyKeySchema.safeParse(idempotencyKey).success
    ) {
      return jsonError(
        "A UUID Idempotency-Key header is required for live runs",
        400
      );
    }

    const rateLimitResponse = checkRateLimit(request, {
      uniqueTokenPerInterval: executionMode === "live" ? 5 : 60,
      keySuffix: `post:${executionMode}`,
    });
    if (rateLimitResponse) return rateLimitResponse;
    const requestFingerprint =
      executionMode === "live"
        ? await fingerprintRunIntent(parsed.data, executionMode)
        : undefined;

    const repository = await getAgentRepository({
      requireDurable: executionMode === "live",
    });
    const ownerId = crypto.randomUUID();
    const now = new Date().toISOString();
    const lock = await repository.tryAcquireSchedulerLock({
      lockKey: AGENT_EXECUTION_LOCK_KEY,
      ownerId,
      now,
      leaseMs: AGENT_EXECUTION_LOCK_LEASE_MS,
    });
    if (!lock) {
      return jsonError("Another agent execution is already in progress", 409);
    }

    const heartbeat = startAgentExecutionLockHeartbeat(repository, {
      lockKey: AGENT_EXECUTION_LOCK_KEY,
      ownerId,
      leaseMs: AGENT_EXECUTION_LOCK_LEASE_MS,
    });

    try {
      const liveRunId =
        executionMode === "live" ? (idempotencyKey as string) : null;
      if (liveRunId) {
        const existingRun = await repository.getRun(liveRunId);
        if (existingRun) {
          const storedFingerprint =
            await repository.getRunRequestFingerprint(liveRunId);
          if (
            storedFingerprint !== null &&
            storedFingerprint !== requestFingerprint
          ) {
            return jsonError(
              "Idempotency-Key was already used for a different live run",
              409
            );
          }
          if (existingRun.status === "RUNNING") {
            return jsonError(
              "The idempotent live run is still in progress",
              409
            );
          }
          return NextResponse.json({
            success: true,
            run: existingRun,
            replayed: true,
          });
        }
      }

      const run = await runPaperAgent(repository, {
        ...parsed.data,
        executionMode,
        runId: liveRunId ?? undefined,
        requestFingerprint,
        assertExecutionLock: () => heartbeat.assertHeld(),
      });
      return NextResponse.json({
        success: true,
        run,
        ...(liveRunId ? { replayed: false } : {}),
      });
    } finally {
      await heartbeat.stop();
      await repository.releaseSchedulerLock(AGENT_EXECUTION_LOCK_KEY, ownerId);
    }
  } catch (error) {
    if (error instanceof DurableAgentRepositoryUnavailableError) {
      return jsonError("Durable live-run storage is unavailable", 503);
    }
    log.error("run.failed", { error });
    return jsonError("Failed to run paper-trading agent", 500);
  }
}
