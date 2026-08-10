export interface RequestDeadline {
  signal: AbortSignal;
  dispose: () => void;
}

export function isAbortLikeError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("name" in error)) return false;
  const { name } = error as { name?: unknown };
  return name === "AbortError" || name === "TimeoutError";
}

/**
 * Create one aggregate deadline that can also follow a caller disconnect.
 * Call dispose() once the request completes to release the timer/listener.
 */
export function createRequestDeadline(
  timeoutMs: number,
  parentSignal?: AbortSignal | null
): RequestDeadline {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal?.reason);

  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });

  const timeoutId = setTimeout(
    () =>
      controller.abort(new DOMException("Request timed out", "TimeoutError")),
    timeoutMs
  );

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeoutId);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

/** Fetch with a per-upstream timeout while preserving a parent deadline. */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 8_000
): Promise<Response> {
  const deadline = createRequestDeadline(timeoutMs, init.signal);
  try {
    return await fetch(input, { ...init, signal: deadline.signal });
  } finally {
    deadline.dispose();
  }
}

/** Stop awaiting a non-fetch operation when its enclosing request aborts. */
export function waitForAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal | null
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(
      signal.reason ?? new DOMException("Request aborted", "AbortError")
    );
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () =>
      reject(
        signal.reason ?? new DOMException("Request aborted", "AbortError")
      );
    const cleanup = () => signal.removeEventListener("abort", onAbort);

    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      }
    );
  });
}
