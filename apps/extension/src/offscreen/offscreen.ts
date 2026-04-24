/**
 * Offscreen Document — lightweight dispatcher that lazy-loads either the
 * scoring runtime or the trading runtime on first use.
 */

import { logWarn } from "@knoww/logger";
import type { ScoreMarketsMessage } from "../types/chrome-messages";

type ScoringRuntimeModule = typeof import("./scoring-runtime");
type TradingRuntimeModule = typeof import("./trading-runtime");

let scoringRuntimePromise: Promise<ScoringRuntimeModule> | null = null;
let tradingRuntimePromise: Promise<TradingRuntimeModule> | null = null;

function loadScoringRuntime(): Promise<ScoringRuntimeModule> {
  if (!scoringRuntimePromise) {
    scoringRuntimePromise = import(
      /* webpackChunkName: "offscreen-scoring-runtime" */ "./scoring-runtime"
    ).catch((error) => {
      scoringRuntimePromise = null;
      throw error;
    });
  }
  return scoringRuntimePromise;
}

function loadTradingRuntime(): Promise<TradingRuntimeModule> {
  if (!tradingRuntimePromise) {
    tradingRuntimePromise = import(
      /* webpackChunkName: "offscreen-trading-runtime" */ "./trading-runtime"
    ).catch((error) => {
      tradingRuntimePromise = null;
      throw error;
    });
  }
  return tradingRuntimePromise;
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
      loadTradingRuntime()
        .then((runtime) =>
          runtime.handleTradingOffscreenMessage(
            payload as { type: string; [key: string]: unknown },
            tabId
          )
        )
        .then((result) => {
          sendResponse(result);
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

    if (msg.type === "offscreen:trading-prewarm") {
      loadTradingRuntime()
        .then((runtime) => runtime.prewarmTrading())
        .then(() => {
          sendResponse({ ok: true, data: null });
        })
        .catch((err) => {
          logWarn("offscreen.trading-prewarm-failed", {
            message: err instanceof Error ? err.message : String(err),
          });
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        });
      return true;
    }

    if (msg.type === "offscreen:scoring-prewarm") {
      loadScoringRuntime()
        .then((runtime) => runtime.prewarmScoring())
        .then(() => {
          sendResponse({ ok: true, data: null });
        })
        .catch((err) => {
          logWarn("offscreen.scoring-prewarm-failed", {
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
      if (!isScoreMarketsMessage(payload)) {
        sendResponse({ ok: false, error: "Invalid scoring payload type" });
        return false;
      }
      const request = payload;

      loadScoringRuntime()
        .then((runtime) => runtime.handleScoringMessage(request))
        .then((result) => {
          sendResponse(result);
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
