import { type NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { sanitizeAnalyticsProperties } from "@/lib/analytics-sanitization";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { readJsonBodyWithLimit } from "@/lib/api-request-body";
import {
  extensionCorsHeaders,
  handleExtensionPreflight,
} from "@/lib/extension-auth";
import { logger } from "@/lib/logger";
import {
  captureServerEvents,
  isPostHogServerConfigured,
  type ServerPostHogEvent,
} from "@/lib/posthog-server";

const MAX_REQUEST_BODY_BYTES = 32 * 1024;

const primitiveSchema = z.union([
  z.string().max(200),
  z.number(),
  z.boolean(),
  z.null(),
]);

const analyticsEventSchema = z.object({
  event: z.string().min(1).max(64),
  distinctId: z.union([
    z.string().uuid(),
    z
      .string()
      .refine((value) => isAddress(value))
      .transform((value) => getAddress(value)),
  ]),
  timestamp: z.string().datetime(),
  properties: z.record(z.string().min(1).max(64), primitiveSchema).default({}),
});

const requestSchema = z.object({
  events: z.array(analyticsEventSchema).min(1).max(20),
});

/**
 * @openapi
 * /api/analytics/batch:
 *   post:
 *     summary: Ingest batched extension analytics events
 *     description: Accepts sanitized extension usage analytics and forwards them to PostHog.
 *     tags:
 *       - Analytics
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - events
 *             properties:
 *               events:
 *                 type: array
 *                 minItems: 1
 *                 maxItems: 20
 *                 items:
 *                   type: object
 *                   required:
 *                     - event
 *                     - distinctId
 *                     - timestamp
 *                     - properties
 *                   properties:
 *                     event:
 *                       type: string
 *                     distinctId:
 *                       description: Anonymous installation UUID or connected EOA wallet address, normalized to EIP-55 checksum.
 *                       oneOf:
 *                         - type: string
 *                           format: uuid
 *                         - type: string
 *                           pattern: '^0x[0-9a-fA-F]{40}$'
 *                     timestamp:
 *                       type: string
 *                       format: date-time
 *                     properties:
 *                       type: object
 *                       additionalProperties:
 *                         oneOf:
 *                           - type: string
 *                           - type: number
 *                           - type: boolean
 *                           - type: "null"
 *     responses:
 *       202:
 *         description: Events accepted and forwarded
 *       400:
 *         description: Invalid request payload
 *       429:
 *         description: Too many requests
 *       503:
 *         description: Analytics backend unavailable
 */
export async function OPTIONS(request: NextRequest) {
  return handleExtensionPreflight(request);
}

export async function POST(request: NextRequest) {
  const cors = extensionCorsHeaders(request);

  const rateLimitResponse = checkRateLimit(request, {
    interval: 60 * 1000,
    uniqueTokenPerInterval: 30,
  });
  if (rateLimitResponse) {
    for (const [k, v] of Object.entries(cors))
      rateLimitResponse.headers.set(k, v);
    return rateLimitResponse;
  }

  if (!isPostHogServerConfigured()) {
    logger.warn("analytics.batch.misconfigured");
    return NextResponse.json(
      { success: false, error: "Analytics backend is not configured" },
      { status: 503, headers: cors }
    );
  }

  const jsonBody = await readJsonBodyWithLimit(request, MAX_REQUEST_BODY_BYTES);
  if (!jsonBody.ok) {
    return NextResponse.json(
      { success: false, error: jsonBody.error },
      { status: jsonBody.status, headers: cors }
    );
  }

  const parsed = requestSchema.safeParse(jsonBody.body);

  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: "Invalid analytics payload",
      },
      { status: 400, headers: cors }
    );
  }

  try {
    const events = parsed.data.events.map(sanitizeAnalyticsEvent);

    await captureServerEvents(events);

    logger.info("analytics.batch.accepted", {
      count: events.length,
      route: request.nextUrl.pathname,
    });

    return NextResponse.json(
      { success: true, accepted: events.length },
      { status: 202, headers: cors }
    );
  } catch (error) {
    logger.error("analytics.batch.failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json(
      { success: false, error: "Failed to capture analytics events" },
      { status: 503, headers: cors }
    );
  }
}

function sanitizeAnalyticsEvent(
  event: z.infer<typeof analyticsEventSchema>
): ServerPostHogEvent {
  const properties = sanitizeAnalyticsProperties(event.properties);

  return {
    event: event.event,
    distinctId: event.distinctId,
    timestamp: event.timestamp,
    properties: {
      ...properties,
      source: "knoww_extension",
      product: "extension",
    },
  };
}
