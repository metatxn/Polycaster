import assert from "node:assert/strict";
import test from "node:test";
import {
  getLlmPanelStatus,
  getOpenRouterAttribution,
  inspectModelVoteOutput,
  LlmVoteOutputSchema,
  parseModelVoteOutput,
} from "./llm-panel.ts";
import { ModelVoteSchema } from "./types.ts";

test("reports the LLM panel as blocked when OpenRouter is not configured", () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousModels = process.env.AGENT_LLM_MODELS;
  delete process.env.OPENROUTER_API_KEY;
  process.env.AGENT_LLM_MODELS = "model-a,model-b,model-c";

  try {
    const status = getLlmPanelStatus();

    assert.equal(status.ready, false);
    assert.equal(status.provider, "openrouter");
    assert.deepEqual(status.models, ["model-a", "model-b", "model-c"]);
    assert.deepEqual(status.missing, ["OPENROUTER_API_KEY"]);
  } finally {
    if (previousKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = previousKey;
    }
    if (previousModels === undefined) {
      delete process.env.AGENT_LLM_MODELS;
    } else {
      process.env.AGENT_LLM_MODELS = previousModels;
    }
  }
});

test("uses stable OpenRouter attribution defaults", () => {
  const previousName = process.env.OPENROUTER_APP_NAME;
  const previousUrl = process.env.OPENROUTER_APP_URL;
  const previousPublicUrl = process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.OPENROUTER_APP_NAME;
  delete process.env.OPENROUTER_APP_URL;
  delete process.env.NEXT_PUBLIC_APP_URL;

  try {
    assert.deepEqual(getOpenRouterAttribution(), {
      appName: "Knoww",
      appUrl: "https://knoww.app",
    });
  } finally {
    if (previousName === undefined) {
      delete process.env.OPENROUTER_APP_NAME;
    } else {
      process.env.OPENROUTER_APP_NAME = previousName;
    }
    if (previousUrl === undefined) {
      delete process.env.OPENROUTER_APP_URL;
    } else {
      process.env.OPENROUTER_APP_URL = previousUrl;
    }
    if (previousPublicUrl === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = previousPublicUrl;
    }
  }
});

test("allows OpenRouter attribution environment overrides", () => {
  const previousName = process.env.OPENROUTER_APP_NAME;
  const previousUrl = process.env.OPENROUTER_APP_URL;
  process.env.OPENROUTER_APP_NAME = "Knoww Paper Agent";
  process.env.OPENROUTER_APP_URL = "https://agent.knoww.app";

  try {
    assert.deepEqual(getOpenRouterAttribution(), {
      appName: "Knoww Paper Agent",
      appUrl: "https://agent.knoww.app",
    });
  } finally {
    if (previousName === undefined) {
      delete process.env.OPENROUTER_APP_NAME;
    } else {
      process.env.OPENROUTER_APP_NAME = previousName;
    }
    if (previousUrl === undefined) {
      delete process.env.OPENROUTER_APP_URL;
    } else {
      process.env.OPENROUTER_APP_URL = previousUrl;
    }
  }
});

test("parses JSON model vote text without requiring provider structured output", () => {
  const output = parseModelVoteOutput(`\`\`\`json
{
  "action": "HOLD",
  "confidence": 0.52,
  "fairProbability": 0.6,
  "sizeUsd": "0",
  "reasoning": "Evidence is not strong enough for a paper trade.",
  "citations": ["market-data"],
  "riskFlags": ["low-confidence"]
}
\`\`\``);

  assert.deepEqual(output, {
    action: "HOLD",
    confidence: 0.52,
    fairProbability: 0.6,
    sizeUsd: "0",
    reasoning: "Evidence is not strong enough for a paper trade.",
    citations: ["market-data"],
    riskFlags: ["low-confidence"],
  });
});

test("rejects malformed model vote text", () => {
  assert.equal(parseModelVoteOutput("I think this should be a hold."), null);
});

test("reports invalid JSON diagnostics for model vote text", () => {
  const inspected = inspectModelVoteOutput("I think this should be a hold.");

  assert.equal(inspected.output, null);
  assert.equal(inspected.debug.status, "invalid-json");
  assert.equal(inspected.debug.rawTextLength, 30);
  assert.deepEqual(inspected.debug.validationIssues, [
    "No JSON object braces found in model response.",
  ]);
});

test("reports schema diagnostics for incomplete model vote JSON", () => {
  const inspected = inspectModelVoteOutput(`{"action":"HOLD"}`);

  assert.equal(inspected.output, null);
  assert.equal(inspected.debug.status, "schema-invalid");
  assert.ok(
    inspected.debug.validationIssues?.some((issue) =>
      issue.startsWith("confidence:")
    )
  );
});

test("accepts provider numeric outputs before final vote validation clamps range", () => {
  const providerOutput = {
    action: "HOLD",
    confidence: 2,
    fairProbability: -1,
    sizeUsd: "0",
    reasoning:
      "Provider schema must not include numeric min or max constraints because some routes reject them.",
    citations: ["market-data"],
    riskFlags: [],
  };

  assert.equal(LlmVoteOutputSchema.safeParse(providerOutput).success, true);
  assert.equal(
    ModelVoteSchema.safeParse({ provider: "model-a", ...providerOutput })
      .success,
    false
  );
});

test("accepts provider array outputs before final vote validation checks citation counts", () => {
  const providerOutput = {
    action: "HOLD",
    confidence: 0.5,
    fairProbability: 0.5,
    sizeUsd: "0",
    reasoning:
      "Provider schema must not include array minItems or maxItems because Anthropic rejects those JSON Schema keywords.",
    citations: [],
    riskFlags: Array.from({ length: 20 }, (_, index) => `risk-${index}`),
  };

  assert.equal(LlmVoteOutputSchema.safeParse(providerOutput).success, true);
  assert.equal(
    ModelVoteSchema.safeParse({ provider: "model-a", ...providerOutput })
      .success,
    false
  );
});
