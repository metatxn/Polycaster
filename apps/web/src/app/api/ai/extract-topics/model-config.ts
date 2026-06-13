const DEFAULT_TOPIC_EXTRACTION_MODEL = "openai/gpt-5.4-nano";

export function getTopicExtractionModelName(): string {
  return (
    process.env.OPENROUTER_LLM_MODEL?.trim() || DEFAULT_TOPIC_EXTRACTION_MODEL
  );
}
