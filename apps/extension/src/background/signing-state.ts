/**
 * Signing State — lightweight module that manages the pending signing
 * request map and the bridge signer response listener.
 *
 * Extracted from bridge-signer.ts so background.ts can statically import
 * the listener setup without pulling in ethers (~180 KiB).
 *
 * The BridgeSigner class (in bridge-signer.ts) imports sendSigningRequest
 * from here, sharing the same pendingRequests Map instance.
 */

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

const pendingRequests = new Map<string, PendingRequest>();

let currentTabId: number | null = null;

export function initBridgeSigner(): void {
  chrome.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse) => {
      const msg = message as {
        type?: string;
        id?: string;
        result?: unknown;
        error?: string;
      };
      if (msg?.type !== "trading:signing-response") return false;

      const pending = pendingRequests.get(msg.id!);
      if (!pending) return false;

      pendingRequests.delete(msg.id!);
      if (msg.error) {
        pending.reject(new Error(msg.error));
      } else {
        pending.resolve(msg.result);
      }

      sendResponse({ ok: true });
      return false;
    }
  );
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function sendSigningRequest(
  tabId: number,
  method: string,
  params: unknown[]
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = generateId();
    pendingRequests.set(id, { resolve, reject });

    const signingMsg = { type: "trading:signing-request", id, method, params };

    const onError = () => {
      if (chrome.runtime.lastError) {
        pendingRequests.delete(id);
        reject(
          new Error(`Signing bridge error: ${chrome.runtime.lastError.message}`)
        );
      }
    };

    if (typeof chrome.tabs?.sendMessage === "function") {
      chrome.tabs.sendMessage(tabId, signingMsg, onError);
    } else {
      // Offscreen doc context — relay through the service worker
      chrome.runtime.sendMessage(
        { type: "offscreen:forward-signing", tabId, id, method, params },
        onError
      );
    }

    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error("Signing request timed out (120s)"));
      }
    }, 120_000);
  });
}

export function setActiveTab(tabId: number): void {
  currentTabId = tabId;
}

export function getActiveTab(): number | null {
  return currentTabId;
}
