/**
 * Returns the absolute URL for the builder signing proxy route.
 *
 * Browser: uses window.location.origin (works in dev and production).
 * SSR:     falls back to NEXTAUTH_URL or http://localhost:<PORT>.
 */
export function getBuilderSignProxyUrl(): string {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/api/sign`;
  }

  if (process.env.NEXTAUTH_URL) {
    const baseUrl = process.env.NEXTAUTH_URL.replace(/\/$/, "");
    return `${baseUrl}/api/sign`;
  }

  const port = process.env.PORT ?? "8000";
  return `http://localhost:${port}/api/sign`;
}
