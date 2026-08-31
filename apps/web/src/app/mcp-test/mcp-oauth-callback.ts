export const OAUTH_CALLBACK_MESSAGE_TYPE = "knoww-mcp-oauth-callback";
export const OAUTH_CALLBACK_CHANNEL = "knoww-mcp-oauth";

const CALLBACK_FIELDS = ["code", "error", "iss", "state"] as const;

export interface OAuthCallbackMessage {
  params: Partial<Record<(typeof CALLBACK_FIELDS)[number], string>>;
  type: typeof OAUTH_CALLBACK_MESSAGE_TYPE;
}

export function createOAuthCallbackMessage(
  search: string
): OAuthCallbackMessage {
  const searchParams = new URLSearchParams(search);
  const params: OAuthCallbackMessage["params"] = {};
  for (const name of CALLBACK_FIELDS) {
    const value = searchParams.get(name);
    if (value) params[name] = value;
  }
  return { type: OAUTH_CALLBACK_MESSAGE_TYPE, params };
}

export function parseOAuthCallbackMessage(
  value: unknown
): URLSearchParams | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const message = value as Record<string, unknown>;
  if (message.type !== OAUTH_CALLBACK_MESSAGE_TYPE) return null;
  if (!message.params || typeof message.params !== "object") return null;

  const params = new URLSearchParams();
  const source = message.params as Record<string, unknown>;
  for (const name of CALLBACK_FIELDS) {
    if (typeof source[name] === "string") params.set(name, source[name]);
  }
  return params;
}

export function listenForOAuthCallbackBroadcast(
  listener: (value: unknown) => void
): () => void {
  if (typeof BroadcastChannel !== "function") return () => {};

  let channel: BroadcastChannel;
  try {
    channel = new BroadcastChannel(OAUTH_CALLBACK_CHANNEL);
  } catch {
    return () => {};
  }

  const receive = (event: MessageEvent<unknown>) => listener(event.data);
  channel.addEventListener("message", receive);
  return () => {
    channel.removeEventListener("message", receive);
    channel.close();
  };
}
