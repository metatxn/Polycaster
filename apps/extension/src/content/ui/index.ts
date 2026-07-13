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

configureCardTradingRuntimePort({
  load: loadTradingRuntime,
  getLoaded: getLoadedRuntime,
  showError: showScrollToast,
});
configureStreamTradingRuntimePort({ load: loadTradingRuntime });
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
