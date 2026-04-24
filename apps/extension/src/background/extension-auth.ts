/**
 * Shared extension auth helpers used by background-side network requests.
 *
 * Currently exposes getAccessTokenViaMessage(), which the offscreen document
 * uses to retrieve the signed extension session token from chrome.storage.session
 * via message-pass to the service worker (offscreen docs cannot read session
 * storage directly).
 */

export async function getAccessTokenViaMessage(): Promise<string | null> {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "auth:get-token",
    });
    if (
      response?.ok &&
      typeof response.data === "string" &&
      response.data.length > 0
    ) {
      return response.data;
    }
    return null;
  } catch {
    return null;
  }
}
