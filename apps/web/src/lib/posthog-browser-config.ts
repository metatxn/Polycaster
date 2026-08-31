export const DEFAULT_POSTHOG_BROWSER_HOST = "https://us.i.posthog.com";

export function getPostHogBrowserHost(
  configuredHost: string | undefined
): string {
  const normalizedHost = configuredHost?.trim().replace(/\/+$/, "");

  if (!normalizedHost) return DEFAULT_POSTHOG_BROWSER_HOST;

  try {
    const url = new URL(normalizedHost);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return normalizedHost;
    }
  } catch {
    // Relative proxy paths are not reliable in the Cloudflare deployment.
  }

  return DEFAULT_POSTHOG_BROWSER_HOST;
}
