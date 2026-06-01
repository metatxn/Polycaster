/**
 * Shared extension auth helpers used by background-side network requests.
 *
 * The offscreen document cannot read chrome.storage.session directly, so it
 * message-passes to the service worker. It only ever needs to know whether a
 * session exists (and the wallet address) — the raw bearer token stays in the
 * worker and is attached to outbound knoww.app/api requests by the fetch-json
 * proxy.
 */

export interface ExtensionSessionInfo {
  loggedIn: boolean;
  address: string | null;
}

export async function getExtensionSessionInfoViaMessage(): Promise<ExtensionSessionInfo> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "auth:get-session-info",
    });
    if (response?.ok && response.data && typeof response.data === "object") {
      const data = response.data as { loggedIn?: unknown; address?: unknown };
      return {
        loggedIn: data.loggedIn === true,
        address: typeof data.address === "string" ? data.address : null,
      };
    }
    return { loggedIn: false, address: null };
  } catch {
    return { loggedIn: false, address: null };
  }
}
