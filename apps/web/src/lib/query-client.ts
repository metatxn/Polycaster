import {
  type DefaultOptions,
  MutationCache,
  QueryClient,
} from "@tanstack/react-query";

/**
 * TanStack Query client config.
 *
 * Centralized so that:
 *  - The Next.js App Router gets a *fresh* client per server request
 *    (avoiding cache leakage between users during SSR), while the
 *    browser reuses a single client across navigations.
 *  - Retry, stale-time, gc-time, and refetch behavior live in one
 *    place — every hook inherits them and only overrides when it has
 *    a real reason to.
 *  - The retry function refuses to hit the network again for genuine
 *    client errors (4xx) — only flaky / 5xx / network failures get
 *    retried.
 */

/** True for HTTP 4xx errors (auth, permission, not-found, validation).
 *  These should never be retried — they'll just fail the same way. */
function isClientError(error: unknown): boolean {
  if (error instanceof Response) {
    return error.status >= 400 && error.status < 500;
  }
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof (error as { status: unknown }).status === "number"
  ) {
    const status = (error as { status: number }).status;
    return status >= 400 && status < 500;
  }
  // Some fetch wrappers throw `Error("HTTP 404: ...")` — parse that.
  if (error instanceof Error) {
    const match = /\b(4\d{2})\b/.exec(error.message);
    if (match) {
      const code = Number(match[1]);
      return code >= 400 && code < 500;
    }
  }
  return false;
}

/** Standard retry policy: 4xx → never; 5xx / network → once. */
export function shouldRetryQuery(
  failureCount: number,
  error: unknown
): boolean {
  if (isClientError(error)) return false;
  return failureCount < 1;
}

export const defaultQueryOptions: DefaultOptions = {
  queries: {
    staleTime: 60 * 1000, // 1 minute — covers chatter inside a single page
    gcTime: 30 * 60 * 1000, // 30 minutes — keep navigated-away data warm
    refetchOnWindowFocus: false,
    refetchOnReconnect: false, // websockets / explicit refetches already handle this
    retry: shouldRetryQuery,
  },
  mutations: {
    retry: false,
  },
};

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: defaultQueryOptions,
    mutationCache: new MutationCache(),
  });
}

/** Browser-side singleton — created lazily on first call. */
let browserQueryClient: QueryClient | undefined;

/**
 * Returns the shared QueryClient.
 *
 * - On the server (no `window`), a brand new client is returned each
 *   call so concurrent SSR requests can't see each other's cache.
 * - In the browser, the same client is reused across the session,
 *   matching React's tree-reconciliation expectations.
 */
export function getQueryClient(): QueryClient {
  if (typeof window === "undefined") {
    return makeQueryClient();
  }
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

/** Test helper — resets the browser singleton between specs. */
export function _resetBrowserQueryClientForTests(): void {
  browserQueryClient = undefined;
}
