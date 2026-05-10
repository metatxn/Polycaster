import { createOpenRouter } from "@openrouter/ai-sdk-provider";

const DEFAULT_OPENROUTER_APP_NAME = "Knoww";
const DEFAULT_OPENROUTER_APP_URL = "https://knoww.app";

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function createAttributedOpenRouter(apiKey: string) {
  const appName =
    envValue("OPENROUTER_APP_NAME") ?? DEFAULT_OPENROUTER_APP_NAME;
  const appUrl =
    envValue("OPENROUTER_APP_URL") ??
    envValue("NEXT_PUBLIC_APP_URL") ??
    DEFAULT_OPENROUTER_APP_URL;

  return createOpenRouter({
    apiKey,
    appName,
    appUrl,
    headers: {
      "X-Title": appName,
    },
  });
}
