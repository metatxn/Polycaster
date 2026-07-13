import { createLogger } from "@knoww/logger";
import { generateText, Output } from "ai";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAiRateLimit } from "@/lib/ai-rate-limit";
import { jsonError } from "@/lib/api-error";
import { readJsonBodyWithLimit } from "@/lib/api-request-body";
import {
  extensionCorsHeaders,
  handleExtensionPreflight,
  verifyExtensionAccessPreAuth,
} from "@/lib/extension-auth";
import { createAttributedOpenRouter } from "@/lib/openrouter";

const log = createLogger("api.ai.validate-relevance");

const AI_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
const MAX_REQUEST_BODY_BYTES = 8 * 1024;
const MAX_POST_TEXT_CHARS = 4000;
const MAX_MARKET_TITLE_CHARS = 300;
const MAX_MARKET_TAGS_CHARS = 1000;
const MAX_MARKET_TAGS = 20;
const MAX_MARKET_TAG_CHARS = 80;

const ValidationSchema = z.object({
  relevant: z
    .boolean()
    .describe("Whether the market is genuinely relevant to the post"),
  reason: z
    .string()
    .max(80)
    .describe(
      "A short, user-facing reason explaining the connection (e.g., 'Post discusses Bitcoin price')"
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("How confident you are in this relevance judgment"),
});

const requestBodySchema = z
  .object({
    postText: z.string().trim().min(1).max(MAX_POST_TEXT_CHARS),
    marketTitle: z.string().trim().min(1).max(MAX_MARKET_TITLE_CHARS),
    marketTags: z
      .union([
        z.string().max(MAX_MARKET_TAGS_CHARS),
        z
          .array(z.string().trim().min(1).max(MAX_MARKET_TAG_CHARS))
          .max(MAX_MARKET_TAGS),
      ])
      .optional()
      .transform((value) => {
        if (Array.isArray(value)) return value;
        if (typeof value === "string") {
          return value
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
            .slice(0, MAX_MARKET_TAGS);
        }
        return [];
      }),
  })
  .strict();

const SYSTEM_PROMPT = `You are a relevance judge for a prediction market Chrome extension.

Given a social media post and a prediction market title, decide whether the market is genuinely relevant to what the post is discussing.

Rules:
1. The market must be DIRECTLY related to the topic of the post — not just loosely associated.
2. Sharing a single common word (like "golden", "cup", "race") is NOT enough. The actual subject matter must match.
3. A post about food promotions is NOT relevant to entertainment awards, even if both contain "golden".
4. A post about a sports team is NOT relevant to a political market just because both mention the same city.
5. If the market IS relevant, write a short (under 80 chars) reason that a user would understand, like "Post discusses Bitcoin price target" or "Mentions Trump's tariff policy".
6. If the market is NOT relevant, set reason to an empty string.
7. Be strict. When in doubt, mark as NOT relevant. False positives hurt user trust more than false negatives.`;

interface ValidationResponse {
  relevant: boolean;
  reason: string;
  confidence: number;
  cached?: boolean;
  durationMs?: number;
  error?: string;
}

interface CacheEntry {
  value: ValidationResponse;
  cachedAt: number;
}

const IS_DEV = process.env.NODE_ENV === "development";

const cache = IS_DEV ? new Map<string, CacheEntry>() : null;

async function getCacheKey(
  postText: string,
  marketTitle: string,
  marketTags: string[]
): Promise<string> {
  const normalizedTags = marketTags
    .map((t) => t.toLowerCase().trim())
    .filter(Boolean)
    .sort()
    .join(",");
  const raw = `${postText.toLowerCase().slice(0, 400)}|${marketTitle.toLowerCase().slice(0, 150)}|${normalizedTags}`;
  const data = new TextEncoder().encode(raw);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function getCached(
  postText: string,
  marketTitle: string,
  marketTags: string[]
): Promise<ValidationResponse | null> {
  if (!cache) return null;
  const key = await getCacheKey(postText, marketTitle, marketTags);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return { ...entry.value, cached: true, durationMs: 0 };
}

async function setCache(
  postText: string,
  marketTitle: string,
  marketTags: string[],
  value: ValidationResponse
): Promise<void> {
  if (!cache) return;
  const key = await getCacheKey(postText, marketTitle, marketTags);

  if (cache.size >= CACHE_MAX_ENTRIES) {
    const now = Date.now();
    for (const [k, v] of cache.entries()) {
      if (now - v.cachedAt > CACHE_TTL_MS) cache.delete(k);
    }
    while (cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }

  cache.set(key, {
    value: { ...value, cached: undefined, durationMs: undefined },
    cachedAt: Date.now(),
  });
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  msg: string
): Promise<T> {
  let tid: ReturnType<typeof setTimeout> | null = null;
  try {
    const tp = new Promise<T>((_, reject) => {
      tid = setTimeout(() => reject(new Error(msg)), timeoutMs);
    });
    return await Promise.race([promise, tp]);
  } finally {
    if (tid) clearTimeout(tid);
  }
}

async function validateRelevance(
  postText: string,
  marketTitle: string,
  marketTags: string[]
): Promise<ValidationResponse> {
  const startedAt = Date.now();

  const cached = await getCached(postText, marketTitle, marketTags);
  if (cached) return cached;

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return {
      relevant: true,
      reason: "",
      confidence: 0,
      error: "AI service not configured",
      durationMs: Date.now() - startedAt,
    };
  }

  try {
    const openrouter = createAttributedOpenRouter(apiKey);
    const tagsStr =
      marketTags.length > 0 ? `\nMarket tags: ${marketTags.join(", ")}` : "";

    const aiResult = await withTimeout(
      generateText({
        model: openrouter.chat("google/gemini-3-flash-preview"),
        output: Output.object({ schema: ValidationSchema }),
        system: SYSTEM_PROMPT,
        prompt: `Social media post:
<<<POST>>>
${postText.slice(0, 400)}
<<<END_POST>>>

Prediction market title: "${marketTitle}"${tagsStr}

Is this market relevant to what the post is discussing?`,
        temperature: 0.1,
        maxOutputTokens: 150,
      }),
      AI_TIMEOUT_MS,
      "Validation timeout"
    );

    const output = aiResult.output;
    if (!output) {
      return {
        relevant: true,
        reason: "",
        confidence: 0,
        error: "AI response missing",
        durationMs: Date.now() - startedAt,
      };
    }

    const response: ValidationResponse = {
      relevant: output.relevant,
      reason: output.relevant ? output.reason : "",
      confidence: output.confidence ?? 0,
      durationMs: Date.now() - startedAt,
    };

    await setCache(postText, marketTitle, marketTags, response);
    return response;
  } catch (error) {
    const isTimeout =
      error instanceof Error && error.message === "Validation timeout";
    log.error("validate.failed", { isTimeout, error });
    // On failure, allow the market through (fail-open)
    return {
      relevant: true,
      reason: "",
      confidence: 0,
      error: isTimeout ? "timeout" : "provider-error",
      durationMs: Date.now() - startedAt,
    };
  }
}

/**
 * @openapi
 * /api/ai/validate-relevance:
 *   options:
 *     summary: Handle preflight for /api/ai/validate-relevance.
 *     tags: [Ai]
 *     responses:
 *       200:
 *         description: Preflight response.
 *       400:
 *         description: Invalid request.
 *       401:
 *         description: Authentication required.
 *       403:
 *         description: Request forbidden.
 *       404:
 *         description: Resource not found.
 *       429:
 *         description: Rate limit exceeded.
 *       500:
 *         description: Request failed.
 */
export async function OPTIONS(request: NextRequest) {
  return handleExtensionPreflight(request);
}

/**
 * @openapi
 * /api/ai/validate-relevance:
 *   post:
 *     summary: Create or proxy /api/ai/validate-relevance.
 *     tags: [Ai]
 *     responses:
 *       200:
 *         description: Successful response.
 *       400:
 *         description: Invalid request.
 *       401:
 *         description: Authentication required.
 *       403:
 *         description: Request forbidden.
 *       404:
 *         description: Resource not found.
 *       429:
 *         description: Rate limit exceeded.
 *       500:
 *         description: Request failed.
 */
export async function POST(request: NextRequest) {
  const cors = extensionCorsHeaders(request);

  const { response: authResponse } = await verifyExtensionAccessPreAuth(
    request,
    "ai:validate"
  );
  if (authResponse) {
    for (const [k, v] of Object.entries(cors)) authResponse.headers.set(k, v);
    return authResponse;
  }

  const rateLimitResponse = checkAiRateLimit(request, 30);
  if (rateLimitResponse) {
    for (const [k, v] of Object.entries(cors))
      rateLimitResponse.headers.set(k, v);
    return rateLimitResponse;
  }

  try {
    const jsonBody = await readJsonBodyWithLimit(
      request,
      MAX_REQUEST_BODY_BYTES
    );
    if (!jsonBody.ok) {
      const errRes = jsonError(jsonBody.error, jsonBody.status);
      for (const [k, v] of Object.entries(cors)) errRes.headers.set(k, v);
      return errRes;
    }

    const parsed = requestBodySchema.safeParse(jsonBody.body);
    if (!parsed.success) {
      const errRes = jsonError("Invalid request body", 400);
      for (const [k, v] of Object.entries(cors)) errRes.headers.set(k, v);
      return errRes;
    }

    const body = parsed.data;

    const result = await validateRelevance(
      body.postText,
      body.marketTitle,
      body.marketTags
    );
    return NextResponse.json(result, { status: 200, headers: cors });
  } catch (error) {
    log.error("request.failed", { error });
    const isClientError =
      error instanceof SyntaxError ||
      (error instanceof Error && error.message.includes("JSON"));
    // Extra fields preserved; success: false added manually
    return NextResponse.json(
      {
        success: false,
        relevant: true,
        reason: "",
        confidence: 0,
        error: isClientError ? "Invalid request body" : "Internal server error",
      },
      { status: isClientError ? 400 : 500, headers: cors }
    );
  }
}
