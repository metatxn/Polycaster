import { getLoadedRuntime, loadTradingRuntime } from "../trading-loader";
import {
  buildKalshiUrl,
  buildKnowwUrl,
  buildKnowwUrlForOutcome,
  buildMarketUrl,
  configureCardTradingRuntimePort,
  createInlineMarketCard,
  getMarketEmoji,
  SOURCE_CONFIG,
} from "./cards";
import {
  cancelTrendingFetchTimer,
  configureStreamTradingRuntimePort,
  createNotificationItem,
  createNotificationStack,
  fetchAndCacheTrending,
  handleNotificationMessage,
  initNotificationStack,
  type NotificationUiMessage,
  scrollToMarket,
  setStreamMarkets,
  showScrollToast,
  updateNotificationStack,
  updateNotificationStackTheme,
} from "./notifications";
import { createPortfolioMessageDispatcher } from "./portfolio-message-dispatcher";

// The store-compliant build ships no in-page trading panel: leaving the
// runtime ports unconfigured means the content script never imports the lazy
// `content-trading.js` chunk (which is not emitted in that build). Outcome
// clicks deep-link to knoww.app instead (see cards.ts openTradingPanel).
if (!__STORE_BUILD__) {
  configureCardTradingRuntimePort({
    load: loadTradingRuntime,
    getLoaded: getLoadedRuntime,
    showError: showScrollToast,
  });
  configureStreamTradingRuntimePort({ load: loadTradingRuntime });
}
const portfolioMessageDispatcher = createPortfolioMessageDispatcher();

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(
    (
      message: NotificationUiMessage,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response: unknown) => void
    ) => {
      const notificationResult = handleNotificationMessage(
        message,
        sendResponse
      );
      if (notificationResult !== null) return notificationResult;
      return portfolioMessageDispatcher.dispatch(message, sendResponse);
    }
  );
}

export const KNOWW_UI = {
  createInlineMarketCard,
  getMarketEmoji,
  buildMarketUrl,
  buildKnowwUrl,
  buildKnowwUrlForOutcome,
  buildKalshiUrl,
  createNotificationStack,
  createNotificationItem,
  updateNotificationStack,
  setStreamMarkets,
  updateNotificationStackTheme,
  scrollToMarket,
  initNotificationStack,
  fetchAndCacheTrending,
  cancelTrendingFetchTimer,
  SOURCE_CONFIG,
};

window.KNOWW_UI = KNOWW_UI;
