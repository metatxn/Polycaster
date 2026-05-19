import { createLogger } from "@knoww/logger";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, stepCountIs } from "ai";
import { z } from "zod";
import { configuredNativeWebSearchEnabled } from "./search-tools.ts";
import type {
  AgentEvidencePack,
  ModelVote,
  ModelVoteDebugSchema,
} from "./types.ts";
import { AgentActionSchema, ModelVoteSchema } from "./types.ts";

const log = createLogger("agent.llm-panel");

const DEFAULT_MODELS = [
  "google/gemini-2.5-flash-lite",
  "openai/gpt-5.4-nano",
  "anthropic/claude-haiku-4.5",
];

// Bumped from 60s to 90s to leave headroom for slower OpenRouter routes and
// one round-trip through the
// openrouter:web_search server tool (which adds latency on top of the
// model's own generation).
const DEFAULT_VOTE_TIMEOUT_MS = 90_000;
const DEFAULT_VOTE_SPACING_MS = 1_500;
const DEFAULT_WEB_SEARCH_MAX_RESULTS = 5;
const DEFAULT_MAX_OUTPUT_TOKENS = 5000;
const DEFAULT_OPENROUTER_APP_NAME = "Knoww";
const DEFAULT_OPENROUTER_APP_URL = "https://knoww.app";

// Lenient on purpose: providers reject our request if we attach strict
// minItems/numeric bounds via tool-use JSON Schema, and some providers also
// emit type variants we'd rather normalize than reject. The final strict
// gate is ModelVoteSchema in types.ts.
//
// Observed model quirks this normalizes:
//   - sizeUsd: 0 (number) when we asked for "0" (string)         [Grok 4.3]
//   - confidence: 60 (percentage scale) when we asked for 0..1   [Grok 4.3]
//   - confidence: "low" (qualitative keyword) when we asked num  [Ring 2.6]
const probabilityFromString = (s: string): number => {
  const lower = s.toLowerCase().trim();
  if (lower === "low") return 0.3;
  if (lower === "medium" || lower === "med") return 0.5;
  if (lower === "high") return 0.8;
  const parsed = Number.parseFloat(s);
  return Number.isFinite(parsed) ? parsed : 0;
};

const probabilityCoerce = z.union([z.number(), z.string()]).transform((v) => {
  let n = typeof v === "number" ? v : probabilityFromString(v);
  if (!Number.isFinite(n)) n = 0;
  // Models sometimes emit percentage scale (0..100 instead of 0..1).
  if (n > 1) n = n / 100;
  return n;
});

const numberCoerce = z.union([z.number(), z.string()]).transform((v) => {
  if (typeof v === "number") return v;
  const parsed = Number.parseFloat(v);
  return Number.isFinite(parsed) ? parsed : 0;
});

const stringCoerce = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "string" ? v : String(v)));

// Some models (notably tool-use-trained ones like gpt-oss) emit array entries
// as structured objects instead of bare strings — e.g. citations as
// `{ url, title }` or the OpenAI Harmony `{ type, url_citation: { url } }`
// shape. Flatten any reasonable shape to a non-empty string so the downstream
// ModelVoteSchema (which requires string items) accepts them.
const stringFromAnyCoerce = z.unknown().transform((v) => {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return "";
  if (typeof v !== "object") return "";
  const obj = v as Record<string, unknown>;
  const nested = (key: string): string | undefined => {
    const value = obj[key];
    if (value && typeof value === "object") {
      const url = (value as Record<string, unknown>).url;
      if (typeof url === "string") return url;
    }
    return undefined;
  };
  const url =
    (typeof obj.url === "string" && obj.url) ||
    (typeof obj.href === "string" && obj.href) ||
    (typeof obj.link === "string" && obj.link) ||
    nested("url_citation") ||
    nested("source") ||
    "";
  const title =
    (typeof obj.title === "string" && obj.title) ||
    (typeof obj.text === "string" && obj.text) ||
    (typeof obj.content === "string" && obj.content) ||
    (typeof obj.description === "string" && obj.description) ||
    "";
  if (url && title) return `${title} (${url})`.trim();
  if (url) return url.trim();
  if (title) return title.trim();
  // Unrecognized object shape — drop. Falling back to JSON.stringify here
  // would produce strings that often blow past the downstream length caps
  // (citations <= 240 chars) and add no real signal.
  return "";
});

// Match ModelVoteSchema's strict caps in types.ts. Tool-using models
// (web_search) sometimes inline source titles + URLs into citations, blowing
// past the 240-char limit, and verbose models occasionally produce >6 entries
// per evidence array. Truncate here so we don't reject otherwise-fine votes.
const MAX_BULLET_ITEMS = 6;
const MAX_BULLET_CHARS = 400;
const MAX_CITATIONS = 8;
const MAX_CITATION_CHARS = 240;
const MAX_RISK_FLAGS = 12;
const MAX_RISK_FLAG_CHARS = 120;

const truncatedStringArray = (maxItems: number, maxChars: number) =>
  z.array(stringFromAnyCoerce).transform((arr) =>
    arr
      .filter((entry) => entry.length > 0)
      .slice(0, maxItems)
      .map((entry) =>
        entry.length > maxChars ? entry.slice(0, maxChars).trimEnd() : entry
      )
  );

export const LlmVoteOutputSchema = z.object({
  resolutionView: z.string(),
  marketImpliedProbability: probabilityCoerce,
  fairProbability: probabilityCoerce,
  edgePct: numberCoerce,
  evidenceFor: truncatedStringArray(MAX_BULLET_ITEMS, MAX_BULLET_CHARS),
  evidenceAgainst: truncatedStringArray(MAX_BULLET_ITEMS, MAX_BULLET_CHARS),
  missingEvidence: truncatedStringArray(MAX_BULLET_ITEMS, MAX_BULLET_CHARS),
  action: AgentActionSchema,
  confidence: probabilityCoerce,
  sizeUsd: stringCoerce,
  reasoning: z.string(),
  citations: truncatedStringArray(MAX_CITATIONS, MAX_CITATION_CHARS),
  riskFlags: truncatedStringArray(MAX_RISK_FLAGS, MAX_RISK_FLAG_CHARS),
});

export interface LlmPanelStatus {
  provider: "openrouter";
  models: string[];
  ready: boolean;
  missing: string[];
}

export interface OpenRouterAttribution {
  appName: string;
  appUrl: string;
}

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function getOpenRouterAttribution(): OpenRouterAttribution {
  return {
    appName: envValue("OPENROUTER_APP_NAME") ?? DEFAULT_OPENROUTER_APP_NAME,
    appUrl:
      envValue("OPENROUTER_APP_URL") ??
      envValue("NEXT_PUBLIC_APP_URL") ??
      DEFAULT_OPENROUTER_APP_URL,
  };
}

function createOpenRouterClient(apiKey: string) {
  const attribution = getOpenRouterAttribution();
  return createOpenRouter({
    apiKey,
    appName: attribution.appName,
    appUrl: attribution.appUrl,
    headers: {
      "X-Title": attribution.appName,
    },
  });
}

function configuredModels(): string[] {
  const configured = process.env.AGENT_LLM_MODELS?.split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return configured && configured.length >= 3
    ? configured.slice(0, 3)
    : DEFAULT_MODELS;
}

function configuredVoteTimeoutMs(): number {
  const configured = Number.parseInt(
    process.env.AGENT_LLM_TIMEOUT_MS ?? "",
    10
  );
  return Number.isFinite(configured) && configured >= 1_000
    ? configured
    : DEFAULT_VOTE_TIMEOUT_MS;
}

function configuredVoteSpacingMs(): number {
  const configured = Number.parseInt(
    process.env.AGENT_LLM_SPACING_MS ?? "",
    10
  );
  return Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_VOTE_SPACING_MS;
}

export function getLlmPanelStatus(): LlmPanelStatus {
  const models = configuredModels();
  const missing = process.env.OPENROUTER_API_KEY ? [] : ["OPENROUTER_API_KEY"];
  return {
    provider: "openrouter",
    models,
    ready: missing.length === 0 && models.length === 3,
    missing,
  };
}

type ModelVoteDebug = z.infer<typeof ModelVoteDebugSchema>;

function fallbackVote(
  provider: string,
  reason: string,
  debug?: ModelVoteDebug
): ModelVote {
  return {
    provider,
    resolutionView: "Model unavailable; no analysis produced.",
    marketImpliedProbability: 0,
    fairProbability: 0,
    edgePct: 0,
    evidenceFor: [],
    evidenceAgainst: [],
    missingEvidence: [],
    action: "HOLD",
    confidence: 0,
    sizeUsd: "0",
    reasoning: reason,
    citations: ["agent-runtime"],
    riskFlags: ["model-unavailable"],
    ...(debug ? { debug } : {}),
  };
}

function modelFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("timeout") || message.includes("aborted")) {
    return "Model vote timed out.";
  }
  if (message.includes("rate limit") || message.includes("429")) {
    return "Model provider rate limit hit.";
  }
  if (
    message.includes("not found") ||
    message.includes("no endpoints") ||
    message.includes("unavailable")
  ) {
    return "Model is unavailable on OpenRouter.";
  }
  if (
    message.includes("unsupported") ||
    message.includes("not supported") ||
    message.includes("invalid parameter")
  ) {
    return "Model does not support the requested vote format.";
  }
  if (message.includes("no output")) {
    return "Model returned no output.";
  }
  return "Model API call failed.";
}

export function buildPrompt(evidence: AgentEvidencePack): string {
  const m = evidence.market;
  const tokenWinProbability = Number.parseFloat(m.price);
  const side = evidence.watchlistItem.side ?? "YES";
  const marketType = m.marketType ?? "unknown";
  const eventType = m.eventType ?? "unknown";
  // The CLOB token model is symmetric: each tokenId represents one outcome,
  // and its price is the market's estimate of P(this token pays out 1.0 at
  // resolution). Express everything from the perspective of the token we
  // track so the model can't accidentally invert the math on NO-side rows.
  const outcomeDescription =
    marketType === "multi_outcome"
      ? `We are tracking one outcome token in a multi-outcome market: ${m.outcomeLabel ?? "the selected outcome"}. tokenWinProbability is the market's estimate of P(this specific outcome wins), not P(YES).`
      : side === "YES"
        ? "We are tracking the YES outcome of this market. tokenWinProbability is the market's estimate of P(YES wins)."
        : "We are tracking the NO outcome of this market. tokenWinProbability is the market's estimate of P(NO wins) = P(this market resolves NO).";
  return JSON.stringify(
    {
      market: {
        question: m.question,
        tokenId: m.tokenId,
        conditionId: m.conditionId,
        marketSlug: m.marketSlug,
        side,
        outcomeLabel: m.outcomeLabel,
        marketType,
        eventType,
        outcomes: m.outcomes,
        oppositeOutcomeLabel: m.oppositeOutcomeLabel,
        oppositeTokenId: m.oppositeTokenId,
        eventMarketCount: m.eventMarketCount,
        outcomeDescription,
        resolutionSource: m.resolutionSource,
        eventStartTime: m.eventStartTime,
        eventEndTime: m.eventEndTime,
        tokenWinProbability: Number.isFinite(tokenWinProbability)
          ? tokenWinProbability
          : null,
        bestBid: m.bestBid,
        bestAsk: m.bestAsk,
        midPrice: m.midPrice,
        spread: m.spread,
        spreadPct: m.spreadPct,
        liquidityUsd: m.liquidityUsd,
        stale: m.stale,
        orderBook: m.orderBook,
        priceMovement: m.priceMovement,
      },
      evidence: {
        news: evidence.news.map((entry) => ({
          url: entry.url,
          title: entry.title,
          excerpt: entry.excerpt,
        })),
        relatedMarkets: evidence.relatedMarkets.map((entry) => ({
          question: entry.question,
          outcomeLabel: entry.outcomeLabel,
          price: entry.price,
          marketType: entry.marketType,
          eventType: entry.eventType,
          eventEndTime: entry.eventEndTime,
          selected: entry.selected,
        })),
        search: evidence.search.map((entry) => ({
          provider: entry.provider,
          kind: entry.kind,
          query: entry.query,
          url: entry.url,
          title: entry.title,
          excerpt: entry.excerpt,
          publishedAt: entry.publishedAt,
        })),
        social: evidence.social,
      },
      capturedAt: evidence.capturedAt,
    },
    null,
    2
  );
}

interface ParsedModelVoteOutput {
  output: z.infer<typeof LlmVoteOutputSchema> | null;
  debug: Pick<
    ModelVoteDebug,
    "status" | "rawTextLength" | "rawTextPreview" | "validationIssues"
  >;
}

function previewText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 800);
}

function validationIssueMessages(error: z.ZodError): string[] {
  return error.issues
    .slice(0, 8)
    .map((issue) =>
      issue.path.length > 0
        ? `${issue.path.join(".")}: ${issue.message}`
        : issue.message
    );
}

export function inspectModelVoteOutput(text: string): ParsedModelVoteOutput {
  const trimmed = text.trim();
  const rawTextLength = text.length;
  const rawTextPreview = previewText(text);
  if (!trimmed) {
    return {
      output: null,
      debug: {
        status: "no-output",
        rawTextLength,
        rawTextPreview,
      },
    };
  }

  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace <= firstBrace) {
    const issue =
      firstBrace >= 0 && lastBrace === -1
        ? "JSON object was truncated before closing brace."
        : "No JSON object braces found in model response.";
    return {
      output: null,
      debug: {
        status: "invalid-json",
        rawTextLength,
        rawTextPreview,
        validationIssues: [issue],
      },
    };
  }

  try {
    const parsed = JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1));
    const result = LlmVoteOutputSchema.safeParse(parsed);
    if (!result.success) {
      return {
        output: null,
        debug: {
          status: "schema-invalid",
          rawTextLength,
          rawTextPreview,
          validationIssues: validationIssueMessages(result.error),
        },
      };
    }
    return {
      output: result.data,
      debug: {
        status: "ok",
        rawTextLength,
        rawTextPreview,
      },
    };
  } catch (error) {
    return {
      output: null,
      debug: {
        status: "invalid-json",
        rawTextLength,
        rawTextPreview,
        validationIssues: [
          error instanceof Error ? error.message : "JSON.parse failed.",
        ],
      },
    };
  }
}

export function parseModelVoteOutput(
  text: string
): z.infer<typeof LlmVoteOutputSchema> | null {
  return inspectModelVoteOutput(text).output;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void
): Promise<T> {
  let tid: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        tid = setTimeout(() => {
          onTimeout?.();
          reject(new Error("model timeout"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (tid) clearTimeout(tid);
  }
}

function errorDebug(error: unknown, durationMs: number): ModelVoteDebug {
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  return {
    status:
      lowered.includes("timeout") || lowered.includes("aborted")
        ? "timeout"
        : "api-error",
    durationMs,
    errorName: error instanceof Error ? error.name : "Error",
    errorMessage: message.slice(0, 300),
  };
}

export async function collectModelVotes(
  evidence: AgentEvidencePack
): Promise<ModelVote[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const models = configuredModels();
  const searchCount = evidence.search.length;
  if (!apiKey) {
    log.warn("collection.unavailable", {
      reason: "missing-openrouter-api-key",
      models,
      searchCount,
    });
    return models.map((model) =>
      fallbackVote(
        model,
        "OPENROUTER_API_KEY is not configured, so this provider abstained."
      )
    );
  }

  const openrouter = createOpenRouterClient(apiKey);
  const prompt = buildPrompt(evidence);
  const voteTimeoutMs = configuredVoteTimeoutMs();
  const voteSpacingMs = configuredVoteSpacingMs();
  const webSearchEnabled = configuredNativeWebSearchEnabled();

  log.info("collection.started", {
    models,
    searchCount,
    directSearchProviders: [
      ...new Set(evidence.search.map((entry) => entry.provider)),
    ],
    nativeWebSearchEnabled: webSearchEnabled,
    voteTimeoutMs,
  });

  // Calls are sequenced (not parallel) with a small spacing gap so we stay
  // under OpenRouter's free-tier per-minute cap, which would otherwise 429
  // the second/third model on every run.
  const votes: ModelVote[] = [];
  for (let index = 0; index < models.length; index++) {
    const model = models[index];
    const controller = new AbortController();
    const startedAt = Date.now();
    try {
      log.info("vote.started", {
        model,
        searchCount,
        nativeWebSearchEnabled: webSearchEnabled,
      });
      const result = await withTimeout(
        generateText({
          model: openrouter.chat(model),
          system: `You are one member of a three-model paper-trading committee for Polymarket. Decompose the analysis before the verdict.${
            webSearchEnabled
              ? `

You have one tool available: web_search. Call it BEFORE finalizing your vote if (and only if) concrete recent facts not already in the evidence pack would change your call — e.g. team form, head-to-head record, injuries, latest event news, price-moving announcements. Skip it for markets with abstract or speculative resolution rules where search returns no useful signal. Cap yourself at two searches per vote.`
              : `

You have no external tools. Reason strictly from the evidence pack provided in the user prompt (news, direct search results, social, and market snapshot). Do not invent facts you cannot ground in the pack.`
          }

CRITICAL framing — read market.outcomeDescription and market.marketType. Every probability you emit is for the SPECIFIC TOKEN we track, not always for YES. If marketType=multi_outcome, fairProbability is P(the tracked outcomeLabel wins). If side=NO on a binary market, fairProbability is P(NO wins) = P(market resolves NO); evidenceFor entries are reasons the tracked token wins; evidenceAgainst entries are reasons it loses.

Process you MUST follow, in order:
1. resolutionView: state plainly what concrete event resolves the market to our tracked outcome (the side specified in market.side).
2. evidenceFor / evidenceAgainst: list each side's evidence as short bullets pulled from the news, direct search results, related market pricing context, social inputs${webSearchEnabled ? ", AND any web_search results you fetched" : ""}. Do NOT invent evidence to fill these. evidenceFor supports our tracked outcome winning; evidenceAgainst supports it losing.
3. priceMovement + orderBook: treat recent price movement, spread, depth, and bookPressure as market microstructure context only. Do NOT use order-book imbalance alone as the reason to trade.
4. missingEvidence: list what is NOT known but would change your call. Empty arrays are meaningful${webSearchEnabled ? " — they signal the system that web_search would not help next run" : ""}.
5. marketImpliedProbability: restate market.tokenWinProbability from the input verbatim.
6. fairProbability: YOUR estimate of P(our tracked token wins). For side=YES on binary markets this is P(market resolves YES). For side=NO on binary markets this is P(market resolves NO). For multi_outcome markets this is P(outcomeLabel wins).
7. edgePct: (fairProbability - marketImpliedProbability) * 100, signed in percentage points. Positive means the market underprices OUR token.
8. action + sizeUsd: choose only after the above.

Action rules — apply mechanically; do not self-veto:
  Compute abs(edgePct) — the MAGNITUDE, ignoring sign. abs(-7.5) = 7.5, abs(2) = 2.
  Recommend HOLD unless ALL three conditions hold:
    A. abs(edgePct) >= 2
    B. at least one concrete evidenceFor or evidenceAgainst entry supports your direction
    C. liquidity and spread support a fill at your sized notional

  When ALL THREE conditions hold, you MUST choose:
    - BUY if edgePct > 0 (market underprices our tracked token — long it)
    - SELL if edgePct < 0 (market overprices our tracked token — reduce/close the tracked token; do not assume this means buying the opposite outcome unless marketType=binary and an oppositeTokenId is present)

  Do NOT downgrade to HOLD because the edge feels "thin", "just below conviction", or "needs confirmation". The 5pp threshold already encodes that judgment. If you want to express uncertainty WHILE the conditions are met, lower confidence (0.5) and shrink sizeUsd — do not change action.${
    webSearchEnabled
      ? "\n\nWhen you cite web_search results in citations, include the source URL verbatim."
      : ""
  }

OUTPUT FORMAT — STRICT:
  Respond with exactly ONE compact JSON object and nothing else. The first character MUST be '{' and the last character MUST be '}'. Do not use markdown fences. Keep resolutionView under 45 words, reasoning under 130 words, citations under 4 items, and each evidenceFor/evidenceAgainst/missingEvidence array to at most 3 short strings. Required keys: resolutionView, marketImpliedProbability, fairProbability, edgePct, evidenceFor, evidenceAgainst, missingEvidence, action, confidence, sizeUsd, reasoning, citations, riskFlags.`,
          prompt,
          temperature: 0.15,
          maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
          maxRetries: 0,
          abortSignal: controller.signal,
          // The model decides when to call web_search; OpenRouter executes it
          // server-side and feeds results back into the same response. Wired
          // conditionally — dropping the tool when AGENT_LLM_WEB_SEARCH_ENABLED
          // is false also lets us revert stopWhen to the AI SDK default
          // (stepCountIs(1)) since no tool round-trip is needed.
          ...(webSearchEnabled
            ? {
                tools: {
                  web_search: openrouter.tools.webSearch({
                    maxResults: DEFAULT_WEB_SEARCH_MAX_RESULTS,
                    engine: "auto",
                  }),
                },
                stopWhen: stepCountIs(4),
              }
            : {}),
          // Reasoning models like deepseek-v4-flash and gpt-5-nano otherwise
          // burn the entire output-token budget on internal reasoning and
          // emit zero text. enabled:false covers DeepSeek's reasoning toggle;
          // effort:"minimal" covers OpenAI's reasoning_effort param.
          providerOptions: {
            openrouter: {
              reasoning: { enabled: true, effort: "minimal" },
            },
          },
        }),
        voteTimeoutMs,
        () => controller.abort()
      );
      const rawText = result.text ?? "";
      const inspected = inspectModelVoteOutput(rawText);
      const debug = {
        ...inspected.debug,
        durationMs: Date.now() - startedAt,
        finishReason: result.finishReason,
      };
      const output = inspected.output;
      if (!output) {
        log.warn("vote.invalid_output", {
          model,
          ...debug,
        });
        votes.push(
          fallbackVote(model, "Model returned invalid JSON output.", debug)
        );
      } else {
        // ModelVoteSchema requires citations.min(1); models that cite nothing
        // (often correct when there's no real evidence) would otherwise be
        // rejected. Substitute a placeholder so the vote counts and the
        // audit trail makes the omission visible.
        const citations =
          output.citations.length > 0
            ? output.citations
            : ["no-citations-provided"];
        votes.push(
          ModelVoteSchema.parse({
            provider: model,
            ...output,
            citations,
            debug,
          })
        );
        log.info("vote.completed", {
          model,
          durationMs: debug.durationMs,
          finishReason: debug.finishReason,
          action: output.action,
          fairProbability: output.fairProbability,
          edgePct: output.edgePct,
        });
      }
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      log.error("vote.failed", { model, durationMs, error });
      votes.push(
        fallbackVote(
          model,
          modelFailureReason(error),
          errorDebug(error, durationMs)
        )
      );
    }

    if (index < models.length - 1 && voteSpacingMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, voteSpacingMs));
    }
  }
  log.info("collection.completed", {
    voteCount: votes.length,
    fallbackCount: votes.filter((vote) =>
      vote.riskFlags.includes("model-unavailable")
    ).length,
  });
  return votes;
}
