import { AsyncLocalStorage } from "node:async_hooks";
import type { McpAnalytics } from "./analytics";
import type { McpPlan } from "./auth/scopes";

/**
 * Per-request context threaded from the worker entry into tool callbacks.
 * The handler runs each request inside `requestContext.run`, so tools can
 * stamp responses with the same request id the worker logs and returns in
 * the x-request-id header.
 */
export interface RequestPrincipal {
  authMethod: "dev-bypass" | "google-oidc";
  id: string;
  plan: McpPlan;
  scopes: string[];
}

export interface RequestContextValue {
  requestId: string;
  analytics?: McpAnalytics;
  principal?: RequestPrincipal;
  toolRateLimiter?: RateLimit;
}

export const requestContext = new AsyncLocalStorage<RequestContextValue>();

export function currentRequestId(): string {
  return requestContext.getStore()?.requestId ?? crypto.randomUUID();
}

export function currentPrincipal(): RequestPrincipal | undefined {
  return requestContext.getStore()?.principal;
}

export function currentAnalytics(): McpAnalytics | undefined {
  return requestContext.getStore()?.analytics;
}
