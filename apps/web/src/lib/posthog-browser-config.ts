export const DEFAULT_POSTHOG_BROWSER_HOST = "https://a.knoww.app";

export function getPostHogBrowserHost(
  configuredHost: string | undefined
): string {
  const normalizedHost = configuredHost?.trim().replace(/\/+$/, "");

  if (!normalizedHost) return DEFAULT_POSTHOG_BROWSER_HOST;

  // Existing US ingestion settings should use the managed proxy after deployment.
  if (normalizedHost === "https://us.i.posthog.com") {
    return DEFAULT_POSTHOG_BROWSER_HOST;
  }

  try {
    const url = new URL(normalizedHost);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return normalizedHost;
    }
  } catch {}

  return DEFAULT_POSTHOG_BROWSER_HOST;
}
