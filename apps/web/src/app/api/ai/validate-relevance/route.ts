import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output } from "ai";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/api-rate-limit";
import { verifyExtensionRequest } from "@/lib/extension-auth";

const AI_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

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
    const openrouter = createOpenRouter({ apiKey });
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
    console.error("Validate relevance error:", { isTimeout, error });
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

export async function POST(request: NextRequest) {
  const authResponse = await verifyExtensionRequest(request);
  if (authResponse) return authResponse;

  const rateLimitResponse = checkRateLimit(request, {
    uniqueTokenPerInterval: 30,
  });
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = (await request.json()) as {
      postText?: string;
      marketTitle?: string;
      marketTags?: string[] | string;
    };

    if (
      !body.postText ||
      typeof body.postText !== "string" ||
      !body.marketTitle ||
      typeof body.marketTitle !== "string"
    ) {
      return NextResponse.json(
        { error: "Missing 'postText' or 'marketTitle'" },
        { status: 400 }
      );
    }

    const tags = Array.isArray(body.marketTags)
      ? body.marketTags
      : typeof body.marketTags === "string"
        ? body.marketTags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [];

    const result = await validateRelevance(
      body.postText,
      body.marketTitle,
      tags
    );
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Validate relevance request error:", error);
    const isClientError =
      error instanceof SyntaxError ||
      (error instanceof Error && error.message.includes("JSON"));
    return NextResponse.json(
      {
        relevant: true,
        reason: "",
        confidence: 0,
        error: isClientError ? "Invalid request body" : "Internal server error",
      },
      { status: isClientError ? 400 : 500 }
    );
  }
}
