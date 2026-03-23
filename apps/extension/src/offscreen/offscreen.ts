/**
 * Offscreen Document — hosts the heavy trading bundle (ethers + ClobClient)
 * so the service worker stays lightweight.
 *
 * Receives "offscreen:trading" messages from the service worker, processes
 * them via handleTradingMessage, and sends the result back via sendResponse.
 *
 * Signing requests from BridgeSigner are relayed through the service worker
 * (which has chrome.tabs access) to the content script tab.
 */

import { initBridgeSigner } from "../background/signing-state";
import { handleTradingMessage } from "../background/trading-handler";

initBridgeSigner();

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse) => {
    const msg = message as {
      type?: string;
      payload?: { type: string; [key: string]: unknown };
      tabId?: number;
    };

    if (msg?.type !== "offscreen:trading") return false;

    const payload = msg.payload;
    const tabId = msg.tabId;
    if (!payload) {
      sendResponse({ ok: false, error: "Missing trading payload" });
      return false;
    }

    const fakeSender: chrome.runtime.MessageSender = {
      tab: tabId != null ? ({ id: tabId } as chrome.tabs.Tab) : undefined,
    };

    handleTradingMessage(payload, fakeSender)
      .then((result) => {
        sendResponse(
          result ?? { ok: false, error: "Unhandled trading message" }
        );
      })
      .catch((err) => {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return true;
  }
);
