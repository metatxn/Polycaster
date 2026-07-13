import {
  isAllowedAgentNewsUrl,
  resolvePolymarketEventWatchlistItem,
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
import { getAgentRepository } from "@/lib/agent/repository";
import { checkRateLimit } from "@/lib/api-rate-limit";

const log = createLogger("api.agent.watchlist");

const WatchlistInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    polymarketUrl: z.string().trim().url().max(500).optional(),
    question: z.string().trim().min(8).max(240).optional(),
    tokenId: z.string().trim().min(8).max(160).optional(),
    conditionId: z.string().trim().min(8).max(160).optional(),
    marketSlug: z.string().trim().min(1).max(180).optional(),
    side: z.enum(["YES", "NO"]).optional(),
    outcomeLabel: z.string().trim().min(1).max(80).optional(),
    marketType: z.enum(["binary", "multi_outcome", "unknown"]).optional(),
    eventType: z.enum(["single_market", "multi_market", "unknown"]).optional(),
    outcomes: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
    oppositeOutcomeLabel: z.string().trim().min(1).max(80).optional(),
    oppositeTokenId: z.string().trim().min(8).max(160).optional(),
    eventMarketCount: z.number().int().nonnegative().max(500).optional(),
    eventStartTime: z.string().datetime().optional(),
    eventEndTime: z.string().datetime().optional(),
    resolutionSource: z.string().trim().url().max(500).optional(),
    newsUrls: z
      .array(
        z
          .string()
          .url()
          .max(500)
          .refine(isAllowedAgentNewsUrl, "News URL host is not allowed")
      )
      .max(5)
      .default([]),
    socialNotes: z
      .array(z.string().trim().min(1).max(1000))
      .max(10)
      .default([]),
    active: z.boolean().default(true),
  })
  .superRefine((input, context) => {
    if (input.polymarketUrl) return;
    if (!input.question) {
      context.addIssue({
        code: "custom",
        path: ["question"],
        message: "Question is required unless polymarketUrl is provided.",
      });
    }
    if (!input.tokenId) {
      context.addIssue({
        code: "custom",
        path: ["tokenId"],
        message: "Token id is required unless polymarketUrl is provided.",
      });
    }
  });

/**
 * @openapi
 * /api/agent/watchlist:
 *   get:
 *     summary: List paper-trading watchlist items
 *     tags: [Agent]
 *     responses:
 *       200:
 *         description: Watchlist items.
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
      items: await repository.listWatchlist(),
    });
  } catch (error) {
    log.error("list.failed", { error });
    return jsonError("Failed to list watchlist", 500);
  }
}

/**
 * @openapi
 * /api/agent/watchlist:
 *   post:
 *     summary: Create or update a paper-trading watchlist item
 *     tags: [Agent]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             oneOf:
 *               - required: [question, tokenId]
 *               - required: [polymarketUrl]
 *             properties:
 *               id:
 *                 type: string
 *                 format: uuid
 *               polymarketUrl:
 *                 type: string
 *                 format: uri
 *               question:
 *                 type: string
 *               tokenId:
 *                 type: string
 *               conditionId:
 *                 type: string
 *               marketSlug:
 *                 type: string
 *               side:
 *                 type: string
 *                 enum: [YES, NO]
 *               outcomeLabel:
 *                 type: string
 *               marketType:
 *                 type: string
 *                 enum: [binary, multi_outcome, unknown]
 *               eventType:
 *                 type: string
 *                 enum: [single_market, multi_market, unknown]
 *               outcomes:
 *                 type: array
 *                 items:
 *                   type: string
 *               oppositeOutcomeLabel:
 *                 type: string
 *               oppositeTokenId:
 *                 type: string
 *               eventMarketCount:
 *                 type: integer
 *               eventStartTime:
 *                 type: string
 *                 format: date-time
 *               eventEndTime:
 *                 type: string
 *                 format: date-time
 *               resolutionSource:
 *                 type: string
 *                 format: uri
 *               newsUrls:
 *                 type: array
 *                 description: HTTPS URLs from supported public news hosts.
 *                 items:
 *                   type: string
 *                   format: uri
 *               socialNotes:
 *                 type: array
 *                 items:
 *                   type: string
 *               active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Upserted watchlist item.
 *       400:
 *         description: Invalid input.
 *       401:
 *         description: Missing or invalid admin token.
 *       403:
 *         description: Origin validation failed.
 *       429:
 *         description: Rate limit exceeded.
 */
export async function POST(request: NextRequest) {
  const auth = requireMutatingAgentAdmin(request);
  if (auth) return auth;
  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 20,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    let body: unknown;
    try {
      body = await readJson(request);
    } catch (error) {
      if (error instanceof JsonBodyError) {
        return jsonError(error.message, error.status);
      }
      return jsonError("Invalid JSON payload", 400);
    }
    const parsed = WatchlistInputSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError("Invalid watchlist input", 400);
    }
    const imported = parsed.data.polymarketUrl
      ? await resolvePolymarketEventWatchlistItem(parsed.data.polymarketUrl, {
          outcomeLabel: parsed.data.outcomeLabel,
        })
      : null;
    const itemInput = {
      ...imported,
      id: parsed.data.id,
      question: parsed.data.question ?? imported?.question,
      tokenId: parsed.data.tokenId ?? imported?.tokenId,
      conditionId: parsed.data.conditionId ?? imported?.conditionId,
      marketSlug: parsed.data.marketSlug ?? imported?.marketSlug,
      side: parsed.data.side ?? imported?.side ?? "YES",
      outcomeLabel: parsed.data.outcomeLabel ?? imported?.outcomeLabel,
      marketType: parsed.data.marketType ?? imported?.marketType,
      eventType: parsed.data.eventType ?? imported?.eventType,
      outcomes: parsed.data.outcomes ?? imported?.outcomes ?? [],
      oppositeOutcomeLabel:
        parsed.data.oppositeOutcomeLabel ?? imported?.oppositeOutcomeLabel,
      oppositeTokenId: parsed.data.oppositeTokenId ?? imported?.oppositeTokenId,
      eventMarketCount:
        parsed.data.eventMarketCount ?? imported?.eventMarketCount,
      eventStartTime: parsed.data.eventStartTime ?? imported?.eventStartTime,
      eventEndTime: parsed.data.eventEndTime ?? imported?.eventEndTime,
      resolutionSource:
        parsed.data.resolutionSource ?? imported?.resolutionSource,
      newsUrls: parsed.data.newsUrls,
      socialNotes: parsed.data.socialNotes,
      active: parsed.data.active,
    };
    if (!itemInput.question || !itemInput.tokenId) {
      return jsonError("Invalid watchlist input", 400);
    }
    const repository = await getAgentRepository();
    const item = await repository.upsertWatchlistItem({
      ...itemInput,
      question: itemInput.question,
      tokenId: itemInput.tokenId,
    });
    return NextResponse.json({ success: true, item });
  } catch (error) {
    log.error("upsert.failed", { error });
    return jsonError("Failed to save watchlist item", 500);
  }
}
