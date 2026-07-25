/**
 * Offscreen Document — lightweight dispatcher. Scoring stays lazy-loaded
 * because it is large.
 *
 * Trading is also lazy-loaded, but gated behind `__STORE_BUILD__`: the
 * dynamic `import("./trading-runtime")` lives inside an `if (!__STORE_BUILD__)`
 * branch so webpack's DefinePlugin removes the import — and its
 * trading-handler / bridge-signer / relayer-client / CLOB chunk — entirely
 * from the Chrome Web Store–compliant build. See
 * docs/chrome-prediction-market-ban-assessment.md.
 */

import { logWarn } from "@knoww/logger";
import type { ScoreMarketsMessage } from "../types/chrome-messages";

type ScoringRuntimeModule = typeof import("./scoring-runtime");

let scoringRuntimePromise: Promise<ScoringRuntimeModule> | null = null;

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

    if (!__STORE_BUILD__) {
      // Trading runtime (order placement, split/merge, CLOB signing). The
      // `import()` is inside this dead-in-store-build branch so webpack drops
      // the whole trading-handler chunk from the compliant build.
      const loadTradingRuntime = (): Promise<
        typeof import("./trading-runtime")
      > =>
        import(
          /* webpackChunkName: "offscreen-trading-runtime" */ "./trading-runtime"
        );

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
