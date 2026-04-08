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

import { warmUp } from "../background/embeddings";
import { logWarn } from "../background/logger";
import { scoreMarkets } from "../background/scoring";
import { initBridgeSigner } from "../background/signing-state";
import { handleTradingMessage } from "../background/trading-handler";
import type { ScoreMarketsMessage } from "../types/chrome-messages";

initBridgeSigner();

let scoringWarmedUp = false;

function ensureScoringWarm(): void {
  if (scoringWarmedUp) return;
  scoringWarmedUp = true;
  warmUp();
}

function isScoreMarketsMessage(
  payload: unknown
): payload is ScoreMarketsMessage {
  if (typeof payload !== "object" || payload === null) return false;
  const msg = payload as Record<string, unknown>;
  const marketTexts = msg.marketTexts;
  return (
    msg.type === "score-markets" &&
    typeof msg.postText === "string" &&
    Array.isArray(marketTexts) &&
    marketTexts.every((item) => typeof item === "string")
  );
}

chrome.runtime.onMessage.addListener(
  (message: unknown, _sender, sendResponse) => {
    const msg = message as {
      type?: string;
      payload?: { type: string; [key: string]: unknown };
      tabId?: number;
    };

    if (
      !msg?.type ||
      typeof msg.type !== "string" ||
      !msg.type.startsWith("offscreen:")
    ) {
      return false;
    }

    const payload = msg.payload;
    const tabId = msg.tabId;
    if (!payload) {
      sendResponse({ ok: false, error: "Missing offscreen payload" });
      return false;
    }

    if (msg.type === "offscreen:trading") {
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
          logWarn("offscreen.trading-failed", {
            message: err instanceof Error ? err.message : String(err),
          });
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      return true;
    }

    if (msg.type === "offscreen:scoring") {
      ensureScoringWarm();
      if (!isScoreMarketsMessage(payload)) {
        sendResponse({ ok: false, error: "Invalid scoring payload type" });
        return false;
      }
      const request = payload;

      scoreMarkets(request)
        .then((result) => {
          sendResponse({
            ok: true,
            similarities: result.similarities,
            bm25Scores: result.bm25Scores,
            contextGateResults: result.contextGateResults,
            usedEmbeddings: result.usedEmbeddings,
          });
        })
        .catch((err) => {
          logWarn("offscreen.scoring-failed", {
            message: err instanceof Error ? err.message : String(err),
          });
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      return true;
    }

    return false;
  }
);
