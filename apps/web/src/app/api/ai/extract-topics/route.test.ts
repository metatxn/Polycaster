import { afterEach, describe, expect, it } from "vitest";
import { getTopicExtractionModelName } from "./model-config";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("getTopicExtractionModelName", () => {
  it("uses OPENROUTER_LLM_MODEL when configured", () => {
    process.env.OPENROUTER_LLM_MODEL = " anthropic/claude-haiku-4.5 ";

    expect(getTopicExtractionModelName()).toBe("anthropic/claude-haiku-4.5");
  });

  it("falls back to the current extractor model when unset", () => {
    delete process.env.OPENROUTER_LLM_MODEL;

    expect(getTopicExtractionModelName()).toBe("openai/gpt-5.4-nano");
  });
});
