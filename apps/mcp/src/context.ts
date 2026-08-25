import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request context threaded from the worker entry into tool callbacks.
 * The handler runs each request inside `requestContext.run`, so tools can
 * stamp responses with the same request id the worker logs and returns in
 * the x-request-id header.
 */
export const requestContext = new AsyncLocalStorage<{ requestId: string }>();

export function currentRequestId(): string {
  return requestContext.getStore()?.requestId ?? crypto.randomUUID();
}
