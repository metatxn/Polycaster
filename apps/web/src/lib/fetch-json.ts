/**
 * The one fetch wrapper for first-party /api/* calls from client hooks.
 * Replaces ~21 hand-rolled copies of fetch -> ok-check -> json ->
 * success-unwrap. Throws on transport failure, non-2xx, and explicit
 * `{ success: false }` envelopes; resolves with the parsed body otherwise.
 */
export async function fetchJson<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(url, init);
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // non-JSON body — fall through to the status check
  }
  const envelope = body as { success?: boolean; error?: string } | null;
  if (!response.ok) {
    throw new Error(
      `${url} failed (${response.status}): ${envelope?.error ?? response.statusText}`
    );
  }
  if (envelope && envelope.success === false) {
    throw new Error(envelope.error || `${url} returned success=false`);
  }
  return body as T;
}
