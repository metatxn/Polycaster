import { createLogger } from "@knoww/logger";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { z } from "zod";
import type {
  AgentEvidencePack,
  ModelVote,
  ModelVoteDebugSchema,
} from "./types.ts";
import { AgentActionSchema, ModelVoteSchema } from "./types.ts";

const log = createLogger("agent.llm-panel");

const DEFAULT_MODELS = [
  "google/gemini-2.5-flash-lite",
  "deepseek/deepseek-v4-flash",
  "tencent/hy3-preview",
];

const DEFAULT_VOTE_TIMEOUT_MS = 45_000;
const DEFAULT_VOTE_SPACING_MS = 1_500;
const DEFAULT_OPENROUTER_APP_NAME = "Knoww";
const DEFAULT_OPENROUTER_APP_URL = "https://knoww.app";

export const LlmVoteOutputSchema = z.object({
  action: AgentActionSchema,
  confidence: z.number(),
  fairProbability: z.number(),
  sizeUsd: z.string(),
  reasoning: z.string(),
  citations: z.array(z.string()),
  riskFlags: z.array(z.string()),
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
    action: "HOLD",
    confidence: 0,
    fairProbability: 0,
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

function buildPrompt(evidence: AgentEvidencePack): string {
  return JSON.stringify(
    {
      instructions:
        "Return a paper-trading recommendation only. Do not assume live execution. Prefer HOLD unless the evidence supports positive expected value after liquidity and uncertainty.",
      market: evidence.market,
      watchlistItem: {
        question: evidence.watchlistItem.question,
        side: evidence.watchlistItem.side ?? "YES",
      },
      news: evidence.news.map((entry) => ({
        url: entry.url,
        title: entry.title,
        excerpt: entry.excerpt,
      })),
      social: evidence.social,
      outputRules: {
        format: "JSON object only, no markdown or prose",
        schema: {
          action: "BUY, SELL, or HOLD",
          confidence: "number from 0 to 1",
          fairProbability: "number from 0 to 1",
          sizeUsd: "decimal string, 0 for HOLD",
          reasoning: "short explanation",
          citations: "array of evidence keys or URLs",
          riskFlags: "array of risk flag strings",
        },
      },
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
    return {
      output: null,
      debug: {
        status: "invalid-json",
        rawTextLength,
        rawTextPreview,
        validationIssues: ["No JSON object braces found in model response."],
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
  if (!apiKey) {
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

  // Calls are sequenced (not parallel) with a small spacing gap so we stay
  // under OpenRouter's free-tier per-minute cap, which would otherwise 429
  // the second/third model on every run.
  const votes: ModelVote[] = [];
  for (let index = 0; index < models.length; index++) {
    const model = models[index];
    const controller = new AbortController();
    const startedAt = Date.now();
    try {
      const result = await withTimeout(
        generateText({
          model: openrouter.chat(model),
          system:
            "You are one member of a three-model paper-trading committee for Polymarket. You must be skeptical, cite evidence, and return exactly one JSON object with keys action, confidence, fairProbability, sizeUsd, reasoning, citations, and riskFlags. Do not return markdown.",
          prompt,
          temperature: 0.15,
          maxOutputTokens: 700,
          maxRetries: 0,
          abortSignal: controller.signal,
          // Reasoning models like deepseek-v4-flash and gpt-5-nano otherwise
          // burn the entire output-token budget on internal reasoning and
          // emit zero text. enabled:false covers DeepSeek's reasoning toggle;
          // effort:"minimal" covers OpenAI's reasoning_effort param.
          providerOptions: {
            openrouter: {
              reasoning: { enabled: false, effort: "minimal" },
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
  return votes;
}
