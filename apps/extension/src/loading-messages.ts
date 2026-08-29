export const LONG_WAIT_MESSAGE_DELAYS_MS = [5_000, 12_000] as const;

export type LoadingMessageInput = string | readonly string[];

function loadingMessages(input: LoadingMessageInput): readonly string[] {
  return typeof input === "string" ? [input] : input;
}

export function startLoadingMessageUpdates(
  update: (message: string) => void,
  input: LoadingMessageInput,
  delays: readonly number[] = LONG_WAIT_MESSAGE_DELAYS_MS
): () => void {
  const messages = loadingMessages(input);
  const first = messages[0];
  if (!first) return () => {};

  update(first);
  const lastConfiguredDelay = delays[delays.length - 1] ?? 0;
  const timers = messages.slice(1).map((message, index) => {
    const fallbackDelay =
      lastConfiguredDelay + Math.max(1, index - delays.length + 1) * 7_000;
    return setTimeout(() => {
      update(message);
    }, delays[index] ?? fallbackDelay);
  });

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    for (const timer of timers) clearTimeout(timer);
  };
}

/**
 * Keeps a visible status message moving during a long operation without
 * claiming progress that the underlying process has not reported.
 */
export function startLoadingMessageSequence(
  target: HTMLElement,
  input: LoadingMessageInput,
  delays: readonly number[] = LONG_WAIT_MESSAGE_DELAYS_MS
): () => void {
  const messages = loadingMessages(input);
  const first = messages[0];
  if (!first) return () => {};

  target.setAttribute("role", "status");
  target.setAttribute("aria-live", "polite");
  target.setAttribute("aria-atomic", "true");
  target.setAttribute("aria-busy", "true");
  const stopUpdates = startLoadingMessageUpdates(
    (message) => {
      target.textContent = message;
    },
    messages,
    delays
  );

  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    stopUpdates();
    target.setAttribute("aria-busy", "false");
  };
}
