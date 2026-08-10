export interface RequestDeadline {
  signal: AbortSignal;
  dispose: () => void;
}

function keepDeadlineUntilBodyConsumed(
  response: Response,
  deadline: RequestDeadline
): Response {
  if (!response.body) {
    deadline.dispose();
    return response;
  }

  const reader = response.body.getReader();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    deadline.dispose();
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) {
          dispose();
          controller.close();
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        dispose();
        controller.error(error);
      }
    },
    async cancel(reason) {
      dispose();
      await reader.cancel(reason);
    },
  });

  return new Response(body, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
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
  let disposed = false;
  const abortFromParent = () => {
    controller.abort(parentSignal?.reason);
    dispose();
  };
  const timeoutId = setTimeout(() => {
    controller.abort(new DOMException("Request timed out", "TimeoutError"));
    dispose();
  }, timeoutMs);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timeoutId);
    parentSignal?.removeEventListener("abort", abortFromParent);
  };

  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });

  return {
    signal: controller.signal,
    dispose,
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
    const response = await fetch(input, { ...init, signal: deadline.signal });
    return keepDeadlineUntilBodyConsumed(response, deadline);
  } catch (error) {
    deadline.dispose();
    throw error;
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
