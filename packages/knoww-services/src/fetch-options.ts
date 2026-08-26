export interface ServiceFetchOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function abortReason(signal: AbortSignal): unknown {
  return (
    signal.reason ?? new DOMException("The request was aborted", "AbortError")
  );
}

/**
 * Combines the caller's cancellation signal with a bounded upstream timeout.
 * The timer remains active until both the response and its body have been read.
 */
export async function withUpstreamTimeout<T>(
  options: ServiceFetchOptions | undefined,
  defaultTimeoutMs: number,
  run: (fetchImpl: typeof fetch, signal: AbortSignal) => Promise<T>
): Promise<T> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const controller = new AbortController();
  const callerSignal = options?.signal;

  if (callerSignal?.aborted) {
    throw abortReason(callerSignal);
  }

  const abortFromCaller = () => {
    if (callerSignal) controller.abort(abortReason(callerSignal));
  };
  callerSignal?.addEventListener("abort", abortFromCaller, { once: true });

  const timeoutId = setTimeout(
    () => controller.abort(),
    options?.timeoutMs ?? defaultTimeoutMs
  );

  try {
    return await run(fetchImpl, controller.signal);
  } finally {
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}
