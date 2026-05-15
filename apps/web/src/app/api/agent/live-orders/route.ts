import { getLiveExecutionConfig } from "@knoww/agent";
import { createLogger } from "@knoww/logger";
import { type NextRequest, NextResponse } from "next/server";
import { jsonError, requireAgentAdmin } from "@/lib/agent/api";
import { getAgentRepository } from "@/lib/agent/repository";
import { checkRateLimit } from "@/lib/api-rate-limit";

const log = createLogger("api.agent.live-orders");

/**
 * @openapi
 * /api/agent/live-orders:
 *   get:
 *     summary: List recent live-mode order audit rows + current config
 *     tags: [Agent]
 *     responses:
 *       200:
 *         description: Live order audit rows + live-execution config status.
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
    const config = getLiveExecutionConfig();
    return NextResponse.json({
      success: true,
      orders: await repository.listLiveOrders(),
      // Never leak the private key or the funder address into the API
      // response — clients only need to know whether live is enabled, the
      // dry-run posture, and the per-trade cap.
      config: {
        enabled: config.enabled,
        dryRun: config.dryRun,
        confirmedReal: config.confirmedReal,
        hasWalletKey: Boolean(config.privateKey),
        hasCredentialEncryptionKey: Boolean(
          process.env.AGENT_CREDENTIAL_ENCRYPTION_KEY?.trim()
        ),
        emergencyStop: process.env.AGENT_LIVE_EMERGENCY_STOP === "true",
        dailyOrderCap:
          process.env.AGENT_LIVE_DAILY_MAX_ORDER_COUNT?.trim() || null,
        dailyNotionalCap:
          process.env.AGENT_LIVE_DAILY_MAX_NOTIONAL_USD?.trim() || null,
        maxLiveNotionalUsd: config.maxLiveNotionalUsd,
        clobHost: config.clobHost,
        chainId: config.chainId,
      },
    });
  } catch (error) {
    log.error("list.failed", { error });
    return jsonError("Failed to load live orders", 500);
  }
}
