// ============================================
// BACKGROUND SERVICE WORKER
// Thin message router — delegates trading to offscreen document,
// handles fetch proxying, and attaches extension auth headers.
// ============================================

import { logInfo, logWarn } from "@knoww/logger";
import type { QuoteResponse } from "@knoww/shared-types/bridge";
// NOTE: `@knoww/shared-types/clob` is NOT imported statically. Its functions
// dynamically import the unified Polymarket CLOB SDK (order placement, split /
// merge), so a static import would pull that SDK chunk into the store build.
// The order-book route below dynamic-imports it inside an `!__STORE_BUILD__`
// branch. See docs/chrome-prediction-market-ban-assessment.md.
import {
  POLYMARKET_API,
  RELAYER_API_HOST,
} from "@knoww/shared-types/polymarket";
import { getAddress } from "viem";
import {
  flushAnalyticsQueue,
  queueAnalyticsEvent,
  resetAnalyticsIdentity,
  submitSiteSupportRequest,
} from "./background/analytics";
import {
  clearClobCredentialDerivationsForTab,
  endClobCredentialDerivation,
  getClobCredentialDerivationStatus,
  resolveClobCredentialDerivationBegin,
} from "./background/clob-credential-derivation-lock";
import {
  hasClobCredentials,
  loadClobCredentials,
  storeClobCredentials,
} from "./background/clob-credentials-store";
// `./background/clob-open-orders` signs CLOB requests (order cancels), so it
// must not ship in the store build. Routes below import it eagerly inside
// `!__STORE_BUILD__` branches: DefinePlugin drops the module from the store
// bundle, while `webpackMode: "eager"` inlines it into background.js for the
// full build (classic MV3 service workers cannot load webpack script-tag
// chunks at runtime).
import type { PortfolioClobOpenOrder } from "./background/clob-open-orders";
import {
  checkAuthorizedSender,
  checkCredsKey,
  TRADING_CREDS_STORAGE_PREFIX,
} from "./background/creds-guards";
import {
  clearExtensionAccessToken,
  getExtensionAccessToken,
  getExtensionAuthorizationHeader,
  getExtensionSessionInfo,
  getKnowwAppUrl,
  isKnowwApiUrl,
  setExtensionAccessToken,
} from "./background/extension-session";
import { createPortfolioFundAttemptStore } from "./background/portfolio-fund-attempts";
import { createPortfolioFundIdempotencyCoordinator } from "./background/portfolio-fund-idempotency";
import { handleRelevanceAggregateMessage } from "./background/relevance-aggregate-messages";
import { createRelevanceAggregateStore } from "./background/relevance-aggregate-store";
// `./background/portfolio-funds` is the only on-chain money-movement module
// (it pulls in bridge-signer + relayer-client + viem wallet clients). It is
// NOT imported statically: the store-compliant build must not ship it. Every
// deposit/withdraw route dynamic-imports it inside an `if (!__STORE_BUILD__)`
// branch so webpack's DefinePlugin drops the module from the store build.
// Those imports use `webpackMode: "eager"` — the classic MV3 service worker
// cannot load webpack's script-tag async chunks at runtime, so the module is
// inlined into background.js for the full build instead of split out.
// See docs/chrome-prediction-market-ban-assessment.md.
import { initBridgeWallet } from "./background/signing-state";
import { handleStorePortfolioRead } from "./background/store-portfolio-reads";
import {
  extractDerivedCredentials,
  tradingOpNeedsCredentials,
} from "./background/trading-credential-mediation";
import {
  readSetupComplete,
  readSetupMilestones,
} from "./content/trading/setup-flow-storage";
import { TRADING_WARM_ELIGIBLE_STORAGE_KEY } from "./content/trading-warm-flag";
import { canUseProductionReranker } from "./context-promotion";
import {
  ONBOARDING_DEMO_STATE_KEY,
  ONBOARDING_DEMO_URL,
} from "./onboarding-state";
import {
  createSearchRequestScheduler,
  isCapacityManagedExtensionRequest,
  runSearchWithRetry,
  SearchQueueCapacityError,
  SearchQueueDeadlineError,
} from "./search-request-policy";
import {
  getUnsupportedSiteHostname,
  normalizeSiteSupportHostname,
  OPEN_SITE_SUPPORT_PROMPT_MESSAGE,
} from "./site-support";
import {
  getOnboardingWalletSetupMatchPatterns,
  SUPPORTED_MATCH_PATTERNS,
  UNSUPPORTED_SITE_SUPPORT_EXCLUDE_PATTERNS,
  UNSUPPORTED_SITE_SUPPORT_MATCH_PATTERNS,
} from "./supported-hosts";
import type {
  BackgroundResponse,
  FetchImageDataUrlMessage,
  FetchJsonMessage,
  FetchTextMessage,
  ScoreMarketsMessage,
  ScoreMarketsSuccessResponse,
  ScoringPrewarmMessage,
} from "./types/chrome-messages";
import {
  EXTENSION_AUTH_REQUIRED_ERROR,
  TRADING_CREDENTIALS_UPDATED_MESSAGE,
  TRADING_SESSION_DISCONNECTED_MESSAGE,
} from "./types/chrome-messages";
import {
  fingerprintPortfolioFundIntent,
  isPortfolioFundIdempotencyKey,
} from "./types/portfolio-fund-intent";
import {
  DEFAULT_USER_SETTINGS,
  mergeStoredUserSettings,
  type StoredUserSettings,
  type UserSettings,
} from "./types/settings";
import { isWebmailUrl, WEBMAIL_HOST_EXCLUDE_PATTERNS } from "./webmail";

// ── Programmatic content script registration ──
// Instead of declaring content_scripts in manifest.json (which would
// require <all_urls> and load on every site), we register them only
// for supported platforms via chrome.scripting.
const CONTENT_SCRIPT_ID = "knoww-content";
const ONBOARDING_WALLET_SETUP_SCRIPT_ID = "knoww-onboarding-wallet-setup";
const UNSUPPORTED_SITE_SUPPORT_SCRIPT_ID = "knoww-unsupported-site-support";
const MAX_IMAGE_PROXY_BYTES = 512 * 1024;
const SETTINGS_STORAGE_KEY = "knowwSettings";
const CONTENT_SCRIPT_REINJECT_SETTLE_MS = 500;
const SIDEPANEL_REQUESTED_VIEW_KEY = "knoww_sidepanel_requested_view";
const SEARCH_ATTEMPT_TIMEOUT_MS = 4_000;
const SEARCH_REQUEST_MAX_ELAPSED_MS = 5_000;
const searchRequestScheduler = createSearchRequestScheduler({
  maximumPending: 8,
  maximumQueueWaitMs: 5_000,
  minimumStartIntervalMs: 300,
});
const portfolioFundIdempotency = createPortfolioFundIdempotencyCoordinator(
  chrome.storage.local
);
const portfolioFundAttempts = createPortfolioFundAttemptStore(
  chrome.storage.local
);
const relevanceAggregateStore = createRelevanceAggregateStore(
  chrome.storage.local
);

type SidePanelView = "markets" | "portfolio";

type ChromeSidePanelApi = {
  open: (options: { tabId?: number; windowId?: number }) => Promise<void>;
  close?: (options: { tabId?: number; windowId?: number }) => Promise<void>;
  setPanelBehavior?: (behavior: {
    openPanelOnActionClick: boolean;
  }) => Promise<void>;
};

let lastSidePanelTabId: number | undefined;
let lastSidePanelWindowId: number | undefined;
let cachedNotificationPanelSurface:
  | UserSettings["notificationPanelSurface"]
  | undefined;
let lastFocusedWindowId: number | undefined;
const activeTabIdsByWindowId = new Map<number, number>();

interface OnboardingDemoState {
  tabId: number;
  windowId?: number;
  openedAt: string;
  injectedAt?: string;
  clickedAt?: string;
  marketId?: string;
}

let onboardingDemoStateTask: Promise<unknown> = Promise.resolve();

function getSidePanelApi(): ChromeSidePanelApi | undefined {
  return (chrome as typeof chrome & { sidePanel?: ChromeSidePanelApi })
    .sidePanel;
}

async function readUserSettings(): Promise<UserSettings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      { [SETTINGS_STORAGE_KEY]: DEFAULT_USER_SETTINGS },
      (result) => {
        resolve(
          mergeStoredUserSettings(
            result[SETTINGS_STORAGE_KEY] as StoredUserSettings | undefined,
            {
              forceDefaultKalshi: true,
              productionRerankerPromoted: canUseProductionReranker(),
            }
          )
        );
      }
    );
  });
}

async function persistNotificationPanelSurface(
  surface: UserSettings["notificationPanelSurface"]
): Promise<void> {
  const settings = await readUserSettings();
  if (settings.notificationPanelSurface === surface) return;
  await new Promise<void>((resolve) => {
    chrome.storage.sync.set(
      {
        [SETTINGS_STORAGE_KEY]: {
          ...settings,
          notificationPanelSurface: surface,
        },
      },
      () => {
        void chrome.runtime.lastError;
        resolve();
      }
    );
  });
}

function applySidePanelActionBehavior(
  _surface: UserSettings["notificationPanelSurface"]
): void {
  const sidePanel = getSidePanelApi();
  if (!sidePanel?.setPanelBehavior) return;

  sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {
    // Older Chrome versions can support sidePanel.open without this helper.
  });
}

async function refreshNotificationPanelSurfaceCache(): Promise<
  UserSettings["notificationPanelSurface"]
> {
  const settings = await readUserSettings();
  cachedNotificationPanelSurface = settings.notificationPanelSurface;
  applySidePanelActionBehavior(settings.notificationPanelSurface);
  return settings.notificationPanelSurface;
}

function updateNotificationPanelSurfaceFromSettings(
  settings: Partial<UserSettings> | undefined
): void {
  const merged = mergeStoredUserSettings(settings, {
    forceDefaultKalshi: true,
    productionRerankerPromoted: canUseProductionReranker(),
  });
  cachedNotificationPanelSurface = merged.notificationPanelSurface;
  applySidePanelActionBehavior(merged.notificationPanelSurface);
}

function resolveSidePanelContext(tab?: chrome.tabs.Tab): {
  tabId?: number;
  windowId?: number;
} {
  return {
    ...(typeof tab?.id === "number" ? { tabId: tab.id } : {}),
    ...(typeof tab?.windowId === "number" ? { windowId: tab.windowId } : {}),
  };
}

function rememberActiveTab(tabId?: number, windowId?: number): void {
  if (typeof windowId === "number") lastFocusedWindowId = windowId;
  if (typeof tabId === "number") lastSidePanelTabId = tabId;
  if (typeof tabId === "number" && typeof windowId === "number") {
    activeTabIdsByWindowId.set(windowId, tabId);
  }
}

async function openKnowwSidePanel(context: {
  tabId?: number;
  windowId?: number;
}): Promise<void> {
  const sidePanel = getSidePanelApi();
  if (!sidePanel) throw new Error("Chrome side panel API is unavailable.");

  if (typeof context.tabId === "number") {
    rememberActiveTab(context.tabId, context.windowId);
    await sidePanel.open({ tabId: context.tabId });
    return;
  }

  if (typeof context.windowId === "number") {
    lastSidePanelWindowId = context.windowId;
    await sidePanel.open({ windowId: context.windowId });
    return;
  }

  throw new Error("No active tab or window found for side panel.");
}

async function closeKnowwSidePanel(context: {
  tabId?: number;
  windowId?: number;
}): Promise<void> {
  const sidePanel = getSidePanelApi();
  if (!sidePanel?.close) {
    throw new Error("Closing side panels requires Chrome 141 or newer.");
  }

  const tabId = context.tabId ?? lastSidePanelTabId;
  const windowId = context.windowId ?? lastSidePanelWindowId;

  if (typeof tabId === "number") {
    await sidePanel.close({ tabId });
    return;
  }

  if (typeof windowId === "number") {
    await sidePanel.close({ windowId });
    return;
  }

  throw new Error("No side panel context is available to close.");
}

function setRequestedSidePanelView(view?: SidePanelView): Promise<void> {
  if (!view) return Promise.resolve();
  return new Promise((resolve) => {
    chrome.storage.session.set({ [SIDEPANEL_REQUESTED_VIEW_KEY]: view }, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function notifyRequestedSidePanelView(view?: SidePanelView): void {
  if (!view) return;
  chrome.runtime.sendMessage(
    { type: "KNOWW_SHOW_EXTENSION_SIDEPANEL_VIEW", view },
    () => {
      void chrome.runtime.lastError;
    }
  );
}

function isOnboardingPageSender(sender: chrome.runtime.MessageSender): boolean {
  return sender.url === chrome.runtime.getURL("onboarding.html");
}

function readOnboardingDemoState(): Promise<OnboardingDemoState | null> {
  return new Promise((resolve) => {
    chrome.storage.session.get(ONBOARDING_DEMO_STATE_KEY, (result) => {
      const stored = result[ONBOARDING_DEMO_STATE_KEY] as
        | Partial<OnboardingDemoState>
        | undefined;
      resolve(
        stored && typeof stored.tabId === "number"
          ? (stored as OnboardingDemoState)
          : null
      );
    });
  });
}

function clearOnboardingDemoState(): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.session.remove(ONBOARDING_DEMO_STATE_KEY, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function writeOnboardingDemoState(state: OnboardingDemoState): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.session.set({ [ONBOARDING_DEMO_STATE_KEY]: state }, () => {
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

function runOnboardingDemoStateTask<T>(task: () => Promise<T>): Promise<T> {
  const nextTask = onboardingDemoStateTask.then(task, task);
  onboardingDemoStateTask = nextTask.then(
    () => undefined,
    () => undefined
  );
  return nextTask;
}

function toOnboardingWalletAddress(address: string | null): string | undefined {
  if (!address) return undefined;
  try {
    return getAddress(address);
  } catch {
    return undefined;
  }
}

async function getOnboardingWalletAddress(): Promise<string | undefined> {
  const session = await getExtensionSessionInfo();
  return toOnboardingWalletAddress(session.address);
}

async function openOnboardingWalletSetup(
  windowId: number
): Promise<chrome.tabs.Tab> {
  const setupUrl = `${getKnowwAppUrl()}/extension/connect`;
  const tabs = await chrome.tabs.query({ windowId });
  const existing = tabs.find((tab) => tab.url === setupUrl);
  const tab =
    typeof existing?.id === "number"
      ? await chrome.tabs.update(existing.id, { active: true })
      : await chrome.tabs.create({
          url: setupUrl,
          active: true,
          windowId,
        });

  if (!tab || typeof tab.id !== "number") {
    throw new Error("Chrome did not return an onboarding wallet setup tab.");
  }
  rememberActiveTab(tab.id, tab.windowId);
  if (typeof tab.windowId === "number") {
    await chrome.windows
      .update(tab.windowId, { focused: true })
      .catch(() => {});
  }
  return tab;
}

async function openOnboardingDemo(windowId?: number): Promise<chrome.tabs.Tab> {
  const existing = await readOnboardingDemoState();
  let tab: chrome.tabs.Tab | undefined;

  if (existing) {
    try {
      const candidate = await chrome.tabs.get(existing.tabId);
      if (
        candidate.url?.startsWith("https://x.com/polymarket") &&
        (typeof windowId !== "number" || candidate.windowId === windowId)
      ) {
        tab = await chrome.tabs.update(existing.tabId, { active: true });
      }
    } catch {
      tab = undefined;
    }
  }

  if (!tab) {
    tab = await chrome.tabs.create({
      url: ONBOARDING_DEMO_URL,
      active: true,
      ...(typeof windowId === "number" ? { windowId } : {}),
    });
  }

  if (typeof tab.id !== "number") {
    throw new Error("Chrome did not return an onboarding demo tab.");
  }
  if (typeof tab.windowId === "number") {
    await chrome.windows
      .update(tab.windowId, { focused: true })
      .catch(() => {});
  }

  await writeOnboardingDemoState({
    ...(existing ?? {}),
    tabId: tab.id,
    ...(typeof tab.windowId === "number" ? { windowId: tab.windowId } : {}),
    openedAt: new Date().toISOString(),
  });

  const walletAddress = await getOnboardingWalletAddress();
  await queueAnalyticsEvent({
    event: "onboarding_demo_opened",
    properties: {
      destination: "x.com/polymarket",
      ...(walletAddress ? { wallet_address: walletAddress } : {}),
    },
  });

  return tab;
}

async function markOnboardingDemoMilestone(
  milestone: "injected" | "clicked",
  tabId: number,
  marketId?: string
): Promise<{ accepted: boolean; showGuide: boolean }> {
  return runOnboardingDemoStateTask(async () => {
    const state = await readOnboardingDemoState();
    if (!state || state.tabId !== tabId) {
      return { accepted: false, showGuide: false };
    }

    const timestampKey = milestone === "injected" ? "injectedAt" : "clickedAt";
    const showGuide =
      milestone === "injected" &&
      !state.clickedAt &&
      (!state.marketId || state.marketId === marketId);
    if (state[timestampKey]) {
      return { accepted: false, showGuide };
    }

    const nextState: OnboardingDemoState = {
      ...state,
      [timestampKey]: new Date().toISOString(),
      ...(marketId ? { marketId } : {}),
    };
    await writeOnboardingDemoState(nextState);

    const walletAddress = await getOnboardingWalletAddress();
    await queueAnalyticsEvent({
      event:
        milestone === "injected"
          ? "onboarding_demo_market_injected"
          : "onboarding_demo_market_clicked",
      properties: {
        destination: "x.com/polymarket",
        ...(marketId ? { market_id: marketId } : {}),
        ...(walletAddress ? { wallet_address: walletAddress } : {}),
      },
    });

    return { accepted: true, showGuide };
  });
}

function sendSiteSupportPromptMessage(
  tabId: number,
  reveal: boolean
): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tabId,
      { type: OPEN_SITE_SUPPORT_PROMPT_MESSAGE, reveal },
      (response?: { surface?: string }) => {
        const delivered =
          !chrome.runtime.lastError &&
          response?.surface === "unsupported-site-prompt";
        resolve(delivered);
      }
    );
  });
}

async function injectUnsupportedSiteSupportPrompt(
  tabId: number
): Promise<void> {
  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ["markets-panel-navbar.css", "unsupported-site-prompt.css"],
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["unsupported-site.js"],
  });
}

async function showUnsupportedSiteSupportPrompt(
  tabId: number,
  options: { reveal: boolean }
): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (isWebmailUrl(tab.url)) return;
    if (await sendSiteSupportPromptMessage(tabId, options.reveal)) return;
    await injectUnsupportedSiteSupportPrompt(tabId);
    if (options.reveal) {
      await sendSiteSupportPromptMessage(tabId, true);
    }
  } catch (error) {
    logWarn("site-support.prompt-injection-failed", {
      tabId,
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

async function refreshOpenUnsupportedSitePrompts(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({
      url: UNSUPPORTED_SITE_SUPPORT_MATCH_PATTERNS,
    });
    await Promise.all(
      tabs.map(async (tab) => {
        if (
          typeof tab.id !== "number" ||
          !getUnsupportedSiteHostname(tab.url)
        ) {
          return;
        }
        await showUnsupportedSiteSupportPrompt(tab.id, { reveal: false });
      })
    );
  } catch (error) {
    logWarn("site-support.open-tabs-refresh-failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

function sendOpenFloatingPanel(tabId: number): void {
  chrome.tabs.sendMessage(tabId, { type: "KNOWW_OPEN_EXTENSION" }, () => {
    void chrome.runtime.lastError;
  });
}

function queryTabsActiveTabId(windowId?: number): Promise<number | undefined> {
  return new Promise((resolve) => {
    try {
      const queryInfo =
        typeof windowId === "number"
          ? { active: true, windowId }
          : { active: true, currentWindow: true };
      chrome.tabs.query(queryInfo, (tabs) => {
        if (chrome.runtime.lastError) {
          resolve(undefined);
          return;
        }
        const activeTab = tabs.find((tab) => typeof tab.id === "number");
        rememberActiveTab(activeTab?.id, activeTab?.windowId);
        resolve(activeTab?.id);
      });
    } catch {
      resolve(undefined);
    }
  });
}

function queryLastFocusedActiveTabId(): Promise<number | undefined> {
  return new Promise((resolve) => {
    try {
      chrome.windows.getLastFocused({ populate: true }, (window) => {
        if (chrome.runtime.lastError || typeof window?.id !== "number") {
          resolve(undefined);
          return;
        }

        lastFocusedWindowId = window.id;
        const activeTab = window.tabs?.find(
          (tab) => tab.active && typeof tab.id === "number"
        );
        rememberActiveTab(activeTab?.id, window.id);
        resolve(activeTab?.id);
      });
    } catch {
      resolve(undefined);
    }
  });
}

async function queryActiveTabId(
  windowId?: number
): Promise<number | undefined> {
  if (typeof windowId === "number") {
    return (
      (await queryTabsActiveTabId(windowId)) ??
      activeTabIdsByWindowId.get(windowId)
    );
  }

  const focusedTabId = await queryLastFocusedActiveTabId();
  if (typeof focusedTabId === "number") return focusedTabId;

  const trackedWindowId = lastFocusedWindowId ?? lastSidePanelWindowId;
  if (typeof trackedWindowId === "number") {
    const trackedTabId =
      (await queryTabsActiveTabId(trackedWindowId)) ??
      activeTabIdsByWindowId.get(trackedWindowId);
    if (typeof trackedTabId === "number") return trackedTabId;
  }

  return await queryTabsActiveTabId();
}

async function resolveContentTargetTabId(
  msg: { tabId?: number },
  sender: chrome.runtime.MessageSender
): Promise<number | undefined> {
  if (typeof msg.tabId === "number") return msg.tabId;
  if (typeof sender.tab?.id === "number") return sender.tab.id;

  const activeTabId = await queryActiveTabId(
    sender.tab?.windowId ?? lastSidePanelWindowId
  );
  if (typeof activeTabId === "number") {
    lastSidePanelTabId = activeTabId;
    return activeTabId;
  }

  return lastSidePanelTabId;
}

// The tab the portfolio wallet connected on. It holds both the wallet session
// (selected provider / WalletConnect) AND the lazily-registered signing
// listener, so deposit/withdraw signatures must be relayed *there* — not to
// whatever tab happens to be active when the user hits Withdraw.
let portfolioSigningTabId: number | undefined;

async function tabIsAlive(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Tab to relay portfolio signing through: the remembered connect tab when it's
 * still open, otherwise the usual active-tab resolution.
 */
async function resolvePortfolioSigningTabId(
  msg: { tabId?: number },
  sender: chrome.runtime.MessageSender
): Promise<number | undefined> {
  if (
    typeof portfolioSigningTabId === "number" &&
    (await tabIsAlive(portfolioSigningTabId))
  ) {
    return portfolioSigningTabId;
  }
  portfolioSigningTabId = undefined;
  return resolveContentTargetTabId(msg, sender);
}

function isRecoverableContentScriptError(error?: string): boolean {
  return /Receiving end does not exist|Could not establish connection|Extension context invalidated/i.test(
    error || ""
  );
}

async function reinjectContentScript(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content.js"],
  });
  await new Promise((resolve) =>
    setTimeout(resolve, CONTENT_SCRIPT_REINJECT_SETTLE_MS)
  );
}

function sendMessageToContentTab(
  tabId: number,
  contentMessage: Record<string, unknown>,
  sendResponse: (response: BackgroundResponse) => void,
  recovered = false
): void {
  chrome.tabs.sendMessage(tabId, contentMessage, (response) => {
    const runtimeError = chrome.runtime.lastError?.message;
    if (runtimeError) {
      if (!recovered && isRecoverableContentScriptError(runtimeError)) {
        void reinjectContentScript(tabId)
          .then(() =>
            sendMessageToContentTab(tabId, contentMessage, sendResponse, true)
          )
          .catch((error) => {
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            } as BackgroundResponse);
          });
        return;
      }

      sendResponse({
        ok: false,
        error: runtimeError,
      } as BackgroundResponse);
      return;
    }
    sendResponse({ ok: true, data: response } as BackgroundResponse);
  });
}

function forwardToResolvedContentTab(
  msg: { tabId?: number },
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: BackgroundResponse) => void,
  contentMessage: Record<string, unknown>
): void {
  void resolveContentTargetTabId(msg, sender).then((tabId) => {
    if (typeof tabId !== "number") {
      sendResponse({
        ok: false,
        error: "No active content tab is available.",
      } as BackgroundResponse);
      return;
    }

    sendMessageToContentTab(tabId, contentMessage, sendResponse);
  });
}

/**
 * Like forwardToResolvedContentTab, but for wallet-signing messages: they must
 * reach the tab holding the wallet session (portfolioSigningTabId), not
 * whatever tab happens to be active — otherwise the signature prompt lands on
 * a tab with no connected wallet context.
 */
function forwardToPortfolioSigningTab(
  msg: { tabId?: number },
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: BackgroundResponse) => void,
  contentMessage: Record<string, unknown>
): void {
  void resolvePortfolioSigningTabId(msg, sender).then((tabId) => {
    if (typeof tabId !== "number") {
      sendResponse({
        ok: false,
        error: "No active content tab is available.",
      } as BackgroundResponse);
      return;
    }

    portfolioSigningTabId = tabId;
    sendMessageToContentTab(tabId, contentMessage, sendResponse);
  });
}

async function registerContentScripts(): Promise<void> {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({
      ids: [
        CONTENT_SCRIPT_ID,
        ONBOARDING_WALLET_SETUP_SCRIPT_ID,
        UNSUPPORTED_SITE_SUPPORT_SCRIPT_ID,
      ],
    });
    const existingIds = new Set(existing.map((script) => script.id));
    const registrations: chrome.scripting.RegisteredContentScript[] = [
      {
        id: CONTENT_SCRIPT_ID,
        matches: SUPPORTED_MATCH_PATTERNS,
        excludeMatches: WEBMAIL_HOST_EXCLUDE_PATTERNS,
        js: ["content.js"],
        css: ["markets-panel-navbar.css"],
        runAt: "document_end",
      },
      {
        id: ONBOARDING_WALLET_SETUP_SCRIPT_ID,
        matches: getOnboardingWalletSetupMatchPatterns(__DEV_MODE__),
        js: ["content.js"],
        runAt: "document_end",
      },
      {
        id: UNSUPPORTED_SITE_SUPPORT_SCRIPT_ID,
        matches: UNSUPPORTED_SITE_SUPPORT_MATCH_PATTERNS,
        excludeMatches: [
          ...UNSUPPORTED_SITE_SUPPORT_EXCLUDE_PATTERNS,
          ...WEBMAIL_HOST_EXCLUDE_PATTERNS,
        ],
        js: ["unsupported-site.js"],
        css: ["markets-panel-navbar.css", "unsupported-site-prompt.css"],
        runAt: "document_idle",
      },
    ];
    const updates = registrations.filter((script) =>
      existingIds.has(script.id)
    );
    const additions = registrations.filter(
      (script) => !existingIds.has(script.id)
    );
    if (updates.length > 0) {
      await chrome.scripting.updateContentScripts(updates);
    }
    if (additions.length > 0) {
      await chrome.scripting.registerContentScripts(additions);
    }
  } catch (error) {
    logWarn("background.content-script-registration-failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

registerContentScripts();
void flushAnalyticsQueue();
// Resolve signing responses for requests initiated *in the worker* (portfolio
// deposit/withdraw). Without this the worker's pending-request map is never
// drained and every signature times out. The offscreen doc registers its own
// copy for trading; the two are keyed by request id so they don't collide.
initBridgeWallet();
chrome.tabs.onRemoved.addListener((tabId) => {
  clearClobCredentialDerivationsForTab(tabId);
});

// ── Build mode (injected by webpack DefinePlugin, typed in env.d.ts) ──

// Response returned by trading / money-movement message routes in the
// store-compliant build, where that capability is stripped from the bundle.
const STORE_TRADING_DISABLED_MESSAGE = "Trading is unavailable in this build.";
const STORE_TRADING_DISABLED_RESPONSE: BackgroundResponse = {
  ok: false,
  error: STORE_TRADING_DISABLED_MESSAGE,
};

// ── Session storage stays TRUSTED_CONTEXTS only (default).
// Content scripts access credentials via message passing below. ──

// ── Security: URL Allowlist ──
const ALLOWED_DOMAINS = [
  "gamma-api.polymarket.com",
  "api.elections.kalshi.com",
  "knoww.app",
  "polymarket.com",
  "polymarket-upload.s3.us-east-2.amazonaws.com",
  "t.co",
  "clob.polymarket.com",
  "data-api.polymarket.com",
  "polygon-bor-rpc.publicnode.com",
  RELAYER_API_HOST,
  ...(__DEV_MODE__ ? ["localhost"] : []),
] as const;

function isAllowedUrl(urlString: string): { valid: boolean; error?: string } {
  try {
    const url = new URL(urlString);
    const isLocalDev = __DEV_MODE__ && url.hostname === "localhost";
    if (url.protocol !== "https:" && !isLocalDev) {
      return {
        valid: false,
        error: `Security: Only HTTPS URLs are allowed. Got: ${url.protocol}`,
      };
    }
    const hostname = url.hostname.toLowerCase();
    const isAllowed = ALLOWED_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
    );
    if (!isAllowed) {
      return {
        valid: false,
        error: `Security: Domain not in allowlist: ${hostname}`,
      };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: `Invalid URL format: ${urlString}` };
  }
}

function isAllowedRedirect(
  originalUrlString: string,
  responseUrlString: string
): boolean {
  try {
    const originalUrl = new URL(originalUrlString);
    if (originalUrl.hostname.toLowerCase() !== "t.co") return true;

    const responseUrl = new URL(responseUrlString);
    const hostname = responseUrl.hostname.toLowerCase();
    return (
      hostname === "polymarket.com" || hostname.endsWith(".polymarket.com")
    );
  } catch {
    return false;
  }
}

function isFetchTextMessage(message: unknown): message is FetchTextMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as FetchTextMessage).type === "fetch-text" &&
    typeof (message as FetchTextMessage).url === "string"
  );
}

async function clearCachedTradingCredentials(): Promise<void> {
  const sessionEntries = await new Promise<Record<string, unknown>>(
    (resolve) => {
      chrome.storage.session.get(null, (items) => {
        resolve(items as Record<string, unknown>);
      });
    }
  );

  const credentialKeys = Object.keys(sessionEntries).filter((key) =>
    key.startsWith(TRADING_CREDS_STORAGE_PREFIX)
  );

  if (credentialKeys.length === 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    chrome.storage.session.remove(credentialKeys, () => resolve());
  });
}

async function broadcastTradingSessionDisconnected(): Promise<void> {
  const tabs = await chrome.tabs.query({});

  await Promise.all(
    tabs.map(
      (tab) =>
        new Promise<void>((resolve) => {
          if (typeof tab.id !== "number") {
            resolve();
            return;
          }

          chrome.tabs.sendMessage(
            tab.id,
            { type: TRADING_SESSION_DISCONNECTED_MESSAGE },
            () => {
              void chrome.runtime.lastError;
              resolve();
            }
          );
        })
    )
  );

  chrome.runtime.sendMessage(
    { type: TRADING_SESSION_DISCONNECTED_MESSAGE },
    () => {
      void chrome.runtime.lastError;
    }
  );
}

function isFetchJsonMessage(message: unknown): message is FetchJsonMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as FetchJsonMessage).type === "fetch-json" &&
    typeof (message as FetchJsonMessage).url === "string"
  );
}

interface FetchJsonAttemptResult {
  data?: unknown;
  error?: string;
  ok: boolean;
  responseUrl?: string;
  retryAfterMs?: number;
  retryable?: boolean;
  status?: number;
}

function getRetryAfterMs(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);

  const retryAt = Date.parse(value);
  return Number.isNaN(retryAt) ? undefined : Math.max(0, retryAt - Date.now());
}

async function performFetchJson(
  message: FetchJsonMessage,
  timeoutMs: number
): Promise<FetchJsonAttemptResult> {
  const urlValidation = isAllowedUrl(message.url);
  if (!urlValidation.valid) {
    return {
      ok: false,
      error: urlValidation.error || "URL not allowed",
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const bodyStr = message.body
      ? typeof message.body === "string"
        ? message.body
        : JSON.stringify(message.body)
      : "";

    const isGet = (message.method || "POST").toUpperCase() === "GET";
    const headers: Record<string, string> = {
      ...(isGet ? {} : { "Content-Type": "application/json" }),
      Accept: "application/json",
      ...message.headers,
    };

    const hasAuthorizationHeader =
      typeof headers.Authorization === "string" ||
      typeof headers.authorization === "string";
    if (!hasAuthorizationHeader && isKnowwApiUrl(message.url)) {
      const authorization = await getExtensionAuthorizationHeader();
      if (authorization) headers.Authorization = authorization;
    }

    const options: RequestInit = {
      method: message.method || "POST",
      headers,
      signal: controller.signal,
    };
    if (bodyStr) options.body = bodyStr;

    const response = await fetch(message.url, options);
    if (!isAllowedRedirect(message.url, response.url)) {
      return {
        ok: false,
        status: response.status,
        error: "Security: t.co redirect target is not allowed",
      };
    }
    if (response.status === 401 && isKnowwApiUrl(message.url)) {
      await clearExtensionAccessToken();
    }

    const text = await response.text();
    try {
      return {
        ok: true,
        status: response.status,
        data: JSON.parse(text),
        responseUrl: response.url,
        retryAfterMs: getRetryAfterMs(response),
      };
    } catch {
      return {
        ok: false,
        status: response.status,
        error: `Invalid JSON response: ${text.substring(0, 100)}`,
      };
    }
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      retryable: errorName === "AbortError" || error instanceof TypeError,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function toBackgroundResponse(
  result: FetchJsonAttemptResult
): BackgroundResponse {
  const {
    retryAfterMs: _retryAfterMs,
    retryable: _retryable,
    ...response
  } = result;
  return response as BackgroundResponse;
}

function isFetchImageDataUrlMessage(
  message: unknown
): message is FetchImageDataUrlMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as FetchImageDataUrlMessage).type === "fetch-image-data-url" &&
    typeof (message as FetchImageDataUrlMessage).url === "string"
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

function isScoreMarketsMessage(
  message: unknown
): message is ScoreMarketsMessage {
  if (typeof message !== "object" || message === null) return false;
  const msg = message as Record<string, unknown>;
  return (
    msg.type === "score-markets" &&
    typeof msg.postText === "string" &&
    Array.isArray(msg.marketTexts) &&
    msg.marketTexts.every((t: unknown) => typeof t === "string")
  );
}

function isScoringPrewarmMessage(
  message: unknown
): message is ScoringPrewarmMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as ScoringPrewarmMessage).type === "scoring:prewarm-offscreen"
  );
}

function isScoreMarketsSuccessResponse(
  response: BackgroundResponse | { ok: false; error?: string }
): response is ScoreMarketsSuccessResponse {
  return (
    response.ok === true &&
    "similarities" in response &&
    "bm25Scores" in response &&
    "contextGateResults" in response &&
    "usedEmbeddings" in response
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPortfolioWithdrawQuoteResponse(
  value: unknown
): value is QuoteResponse {
  if (!isRecord(value)) return false;
  const fee = value.estFeeBreakdown;
  if (!isRecord(fee)) return false;

  return (
    typeof value.quoteId === "string" &&
    typeof value.estToTokenBaseUnit === "string" &&
    isFiniteNumber(value.estCheckoutTimeMs) &&
    isFiniteNumber(value.estInputUsd) &&
    isFiniteNumber(value.estOutputUsd) &&
    typeof fee.appFeeLabel === "string" &&
    isFiniteNumber(fee.appFeePercent) &&
    isFiniteNumber(fee.appFeeUsd) &&
    isFiniteNumber(fee.fillCostPercent) &&
    isFiniteNumber(fee.fillCostUsd) &&
    isFiniteNumber(fee.gasUsd) &&
    isFiniteNumber(fee.maxSlippage) &&
    isFiniteNumber(fee.minReceived) &&
    isFiniteNumber(fee.swapImpact) &&
    isFiniteNumber(fee.swapImpactUsd) &&
    isFiniteNumber(fee.totalImpact) &&
    isFiniteNumber(fee.totalImpactUsd)
  );
}

// Broadcast-only "trading:" types are consumed directly by extension pages
// (side panel / content) — forwarding them would spin up the heavy offscreen
// document just to get back "Unknown trading message type".
const TRADING_BROADCAST_TYPES = new Set<string>([
  "trading:signing-response",
  "trading:session-disconnected",
  "trading:credentials-updated",
  "trading:wallet-connected",
]);

function isTradingMessage(message: unknown): boolean {
  return (
    typeof message === "object" &&
    message !== null &&
    typeof (message as { type: string }).type === "string" &&
    (message as { type: string }).type.startsWith("trading:") &&
    !TRADING_BROADCAST_TYPES.has((message as { type: string }).type)
  );
}

// ── Offscreen Document Management ──

const OFFSCREEN_URL = "offscreen.html";
let offscreenCreating: Promise<void> | null = null;
const OFFSCREEN_SEND_RETRY_DELAY_MS = 150;
const OFFSCREEN_SEND_MAX_ATTEMPTS = 3;

async function ensureOffscreen(): Promise<void> {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT" as chrome.runtime.ContextType],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  if (existingContexts.length > 0) return;

  if (offscreenCreating) {
    await offscreenCreating;
    return;
  }

  const creation = chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["WORKERS" as chrome.offscreen.Reason],
    justification: "Trading operations require viem and ClobClient",
  });
  offscreenCreating = creation;
  try {
    await creation;
  } finally {
    if (offscreenCreating === creation) {
      offscreenCreating = null;
    }
  }
}

function broadcastTradingCredentialsUpdated(address: string): void {
  chrome.runtime.sendMessage(
    { type: TRADING_CREDENTIALS_UPDATED_MESSAGE, address },
    () => {
      void chrome.runtime.lastError;
    }
  );
}

// Reconcile recorded orders without loading trading code in the store build.
if (!__STORE_BUILD__) {
  const poll = () => {
    void import(/* webpackMode: "eager" */ "./background/order-analytics")
      .then((module) => module.pollConfirmedOrders())
      .catch(() => {});
  };
  void chrome.alarms.create("knoww-confirmed-orders", { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "knoww-confirmed-orders") poll();
  });
  poll();
}

/**
 * Mediate credentials between content, trusted session storage, and offscreen.
 * Content receives only the derivation result, never raw credentials.
 */
function forwardToOffscreen(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: BackgroundResponse) => void
): void {
  const tabId = sender.tab?.id;
  const msg = message as { type?: string; address?: string };

  void (async () => {
    try {
      await ensureOffscreen();

      let payload: unknown = message;
      if (
        typeof msg.type === "string" &&
        tradingOpNeedsCredentials(msg.type) &&
        typeof msg.address === "string"
      ) {
        const credentials = await loadClobCredentials(msg.address);
        payload = {
          ...(message as object),
          credentials: credentials ?? undefined,
        };
      }

      const result = await sendOffscreenMessage(
        "offscreen:trading",
        payload,
        tabId
      );

      if (
        !__STORE_BUILD__ &&
        msg.type === "trading:place-order" &&
        msg.address &&
        result?.ok &&
        "data" in result
      ) {
        const order = message as {
          side?: string;
          orderType?: string;
          tokenId?: string;
          size?: number;
          amount?: number;
        };
        try {
          const observer = await import(
            /* webpackMode: "eager" */ "./background/order-analytics"
          );
          void observer
            .rememberAcceptedOrder(result.data, msg.address, {
              surface: "trading_service",
              side: order.side,
              token_id: order.tokenId,
              clob_order_type: order.orderType,
              order_type:
                order.orderType === "GTC" || order.orderType === "GTD"
                  ? "LIMIT"
                  : "MARKET",
              requested_shares: order.size,
              requested_amount: order.amount,
            })
            .then(() => observer.pollConfirmedOrders())
            .catch(() => {});
        } catch {
          /* Telemetry cannot change the order response. */
        }
      }

      if (
        msg.type === "trading:derive-credentials" &&
        typeof msg.address === "string"
      ) {
        const extracted = extractDerivedCredentials(result);
        if (extracted) {
          await storeClobCredentials(msg.address, extracted.credentials);
          await chrome.storage.local
            .set({ [TRADING_WARM_ELIGIBLE_STORAGE_KEY]: true })
            .catch(() => {});
          broadcastTradingCredentialsUpdated(msg.address);
          sendResponse(extracted.response);
          return;
        }
      }

      sendResponse(
        result ?? { ok: false, error: "No response from offscreen" }
      );
    } catch (err) {
      sendResponse({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "knoww-notification-stack") return;

  rememberActiveTab(port.sender?.tab?.id, port.sender?.tab?.windowId);
  port.onMessage.addListener((message: unknown) => {
    const msg = message as { type?: string };
    if (msg?.type === "KNOWW_NOTIFICATION_STACK_ALIVE") {
      rememberActiveTab(port.sender?.tab?.id, port.sender?.tab?.windowId);
    }
  });
});

async function sendOffscreenMessage(
  offscreenType:
    | "offscreen:trading"
    | "offscreen:trading-prewarm"
    | "offscreen:scoring"
    | "offscreen:scoring-prewarm",
  payload: unknown,
  tabId: number | undefined,
  attempt = 1
): Promise<BackgroundResponse> {
  try {
    return (await chrome.runtime.sendMessage({
      type: offscreenType,
      payload,
      tabId,
    })) as BackgroundResponse;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "");
    const isRetryable =
      message.includes("Receiving end does not exist") &&
      attempt < OFFSCREEN_SEND_MAX_ATTEMPTS;

    if (!isRetryable) {
      throw error;
    }

    await new Promise((resolve) =>
      setTimeout(resolve, OFFSCREEN_SEND_RETRY_DELAY_MS)
    );
    return sendOffscreenMessage(offscreenType, payload, tabId, attempt + 1);
  }
}

// ── Message handler ──
chrome.runtime.onMessage.addListener(
  (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: BackgroundResponse) => void
  ): boolean => {
    const msg = message as {
      type?: string;
      tabId?: number;
      id?: string;
      event?: string;
      url?: string;
      method?: string;
      params?: unknown[];
      properties?: Record<string, string | number | boolean | null | undefined>;
      result?: unknown;
      error?: string;
      key?: string;
      value?: unknown;
      token?: string;
      tokenId?: string;
      proxyAddress?: string;
      conditionId?: string;
      outcomeIndex?: number;
      size?: number;
      negRisk?: boolean;
      marketId?: string;
      query?: string;
      hostname?: string;
      walletUuid?: string;
      trendingLimit?: number;
      visible?: boolean;
      address?: string;
      orderId?: string;
      walletMode?: string;
      amount?: string;
      destination?: string;
      chainId?: string;
      tokenSymbol?: string;
      tokenAddress?: string;
      tokenDecimals?: number;
      chainKey?: string;
      bridgeAddress?: string;
      quote?: unknown;
      idempotencyKey?: string;
      surface?: "sidebar" | "floating";
      view?: SidePanelView;
      action?: string;
      attemptId?: string;
      outcome?: string;
    };

    const relevanceAggregateResponse = handleRelevanceAggregateMessage(
      message,
      sender.id,
      chrome.runtime.id,
      relevanceAggregateStore
    );
    if (relevanceAggregateResponse) {
      void relevanceAggregateResponse
        .then((response) => {
          sendResponse(response as BackgroundResponse);
        })
        .catch((error) => {
          logWarn("relevance_aggregate.message_failed", {
            errorName: error instanceof Error ? error.name : "UnknownError",
          });
          sendResponse({
            ok: false,
            error: "Failed to process relevance aggregate telemetry",
          } as BackgroundResponse);
        });
      return true;
    }

    // Relay signing responses from content script → offscreen document.
    // Content script's chrome.runtime.sendMessage only reliably reaches the
    // service worker; the offscreen doc may not receive it directly.
    if (msg?.type === "trading:signing-response" && sender.tab) {
      chrome.runtime.sendMessage(message).catch(() => {});
      return false;
    }

    if (msg?.type === "KNOWW_START_ONBOARDING_SETUP") {
      const senderReject = checkAuthorizedSender(sender.id, chrome.runtime.id);
      const windowId = sender.tab?.windowId;
      if (
        senderReject ||
        !isOnboardingPageSender(sender) ||
        typeof windowId !== "number"
      ) {
        sendResponse({
          ok: false,
          error: "Setup must be started from the Knoww onboarding page.",
        } as BackgroundResponse);
        return true;
      }

      const openPromise = openKnowwSidePanel({ windowId });
      const setupTabPromise = openOnboardingWalletSetup(windowId);
      void persistNotificationPanelSurface("sidebar");
      const requestedViewPromise = setRequestedSidePanelView("portfolio");
      const clearDemoStatePromise = clearOnboardingDemoState();
      void Promise.all([
        openPromise,
        setupTabPromise,
        requestedViewPromise,
        clearDemoStatePromise,
      ])
        .then(([, setupTab]) => {
          portfolioSigningTabId = setupTab.id;
          notifyRequestedSidePanelView("portfolio");
          sendResponse({
            ok: true,
            data: { setupTabId: setupTab.id },
          } as BackgroundResponse);
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          } as BackgroundResponse);
        });
      return true;
    }

    if (msg?.type === "KNOWW_OPEN_ONBOARDING_DEMO") {
      const senderReject = checkAuthorizedSender(sender.id, chrome.runtime.id);
      if (senderReject || !isOnboardingPageSender(sender)) {
        sendResponse(
          (senderReject ?? {
            ok: false,
            error: "This action must come from the Knoww onboarding page.",
          }) as BackgroundResponse
        );
        return true;
      }

      void openOnboardingDemo(sender.tab?.windowId)
        .then((tab) => {
          sendResponse({
            ok: true,
            data: { demoTabId: tab.id },
          } as BackgroundResponse);
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          } as BackgroundResponse);
        });
      return true;
    }

    if (msg?.type === "KNOWW_GET_EXTENSION_ONBOARDING_STATUS") {
      const senderReject = checkAuthorizedSender(sender.id, chrome.runtime.id);
      if (senderReject || !isOnboardingPageSender(sender)) {
        sendResponse(
          (senderReject ?? {
            ok: false,
            error: "This request must come from the Knoww onboarding page.",
          }) as BackgroundResponse
        );
        return true;
      }

      void (async () => {
        const session = await getExtensionSessionInfo();
        const walletAddress = toOnboardingWalletAddress(session.address);
        const [hasCredentials, setupComplete, milestones] =
          !__STORE_BUILD__ && walletAddress
            ? await Promise.all([
                hasClobCredentials(walletAddress),
                readSetupComplete(walletAddress),
                readSetupMilestones(walletAddress),
              ])
            : [
                false,
                false,
                {
                  tradingWalletDeployed: false,
                  hasCredentials: false,
                  hasApproval: false,
                },
              ];
        const tradingWalletDeployed =
          setupComplete || milestones.tradingWalletDeployed;
        const hasApproval = setupComplete || milestones.hasApproval;
        sendResponse({
          ok: true,
          data: {
            loggedIn: session.loggedIn,
            address: walletAddress ?? null,
            hasCredentials,
            tradingWalletDeployed,
            hasApproval,
            tradingReady:
              hasCredentials && tradingWalletDeployed && hasApproval,
            storeBuild: __STORE_BUILD__,
          },
        } as BackgroundResponse);
      })().catch(() => {
        sendResponse({
          ok: false,
          error: "Failed to read onboarding status.",
        } as BackgroundResponse);
      });
      return true;
    }

    if (
      (msg?.type === "KNOWW_ONBOARDING_DEMO_MARKET_INJECTED" ||
        msg?.type === "KNOWW_ONBOARDING_DEMO_MARKET_CLICKED") &&
      typeof sender.tab?.id === "number"
    ) {
      const milestone = msg.type.endsWith("INJECTED") ? "injected" : "clicked";
      void markOnboardingDemoMilestone(
        milestone,
        sender.tab.id,
        typeof msg.marketId === "string" ? msg.marketId : undefined
      )
        .then((result) => {
          sendResponse({ ok: true, data: result } as BackgroundResponse);
        })
        .catch(() => {
          sendResponse({
            ok: false,
            error: "Failed to record onboarding demo progress.",
          } as BackgroundResponse);
        });
      return true;
    }

    if (msg?.type === "KNOWW_OPEN_EXTENSION_SETTINGS") {
      chrome.runtime.openOptionsPage();
      sendResponse({ ok: true, data: null } as BackgroundResponse);
      return true;
    }

    if (msg?.type === "KNOWW_OPEN_EXTENSION_SIDEPANEL") {
      const requestedView =
        msg.view === "markets" || msg.view === "portfolio"
          ? msg.view
          : undefined;
      const openPromise = openKnowwSidePanel({
        ...(typeof sender.tab?.id === "number" ? { tabId: sender.tab.id } : {}),
        ...(typeof sender.tab?.windowId === "number"
          ? { windowId: sender.tab.windowId }
          : {}),
      });

      // `chrome.sidePanel.open()` must be the first awaited side-effect in this
      // user-gesture path. Async storage writes before it can consume Chrome's
      // activation token and trigger "may only be called in response to a user
      // gesture" even though the click came from our floating panel.
      void persistNotificationPanelSurface("sidebar");
      void setRequestedSidePanelView(requestedView);
      void openPromise
        .then(() => {
          notifyRequestedSidePanelView(requestedView);
          if (typeof sender.tab?.id === "number") {
            chrome.tabs.sendMessage(
              sender.tab.id,
              {
                type: "KNOWW_SET_NOTIFICATION_STACK_VISIBILITY",
                visible: false,
              },
              () => {
                void chrome.runtime.lastError;
              }
            );
          }
          sendResponse({ ok: true, data: null } as BackgroundResponse);
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          } as BackgroundResponse);
        });
      return true;
    }

    if (msg?.type === "KNOWW_CLOSE_EXTENSION_SIDEPANEL") {
      void closeKnowwSidePanel({
        ...(typeof msg.tabId === "number" ? { tabId: msg.tabId } : {}),
        ...(typeof sender.tab?.windowId === "number"
          ? { windowId: sender.tab.windowId }
          : {}),
      })
        .then(() =>
          sendResponse({ ok: true, data: null } as BackgroundResponse)
        )
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          } as BackgroundResponse);
        });
      return true;
    }

    if (
      msg?.type === "KNOWW_SET_NOTIFICATION_PANEL_SURFACE" &&
      (msg.surface === "sidebar" || msg.surface === "floating")
    ) {
      void persistNotificationPanelSurface(msg.surface)
        .then(() =>
          sendResponse({ ok: true, data: null } as BackgroundResponse)
        )
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          } as BackgroundResponse);
        });
      return true;
    }

    if (msg?.type === "KNOWW_SET_NOTIFICATION_STACK_VISIBILITY") {
      forwardToResolvedContentTab(msg, sender, sendResponse, {
        type: "KNOWW_SET_NOTIFICATION_STACK_VISIBILITY",
        visible: msg.visible,
      });
      return true;
    }

    if (msg?.type === "KNOWW_GET_NOTIFICATION_STACK_SNAPSHOT") {
      forwardToResolvedContentTab(msg, sender, sendResponse, {
        type: "KNOWW_GET_NOTIFICATION_STACK_SNAPSHOT",
        trendingLimit: msg.trendingLimit,
      });
      return true;
    }

    if (msg?.type === "KNOWW_FOCUS_NOTIFICATION_MARKET") {
      forwardToResolvedContentTab(msg, sender, sendResponse, {
        type: "KNOWW_FOCUS_NOTIFICATION_MARKET",
        marketId: msg.marketId,
      });
      return true;
    }

    if (msg?.type === "KNOWW_SEARCH_NOTIFICATION_MARKETS") {
      forwardToResolvedContentTab(msg, sender, sendResponse, {
        type: "KNOWW_SEARCH_NOTIFICATION_MARKETS",
        query: msg.query,
      });
      return true;
    }

    if (msg?.type === "KNOWW_GET_PORTFOLIO_WALLETS") {
      forwardToResolvedContentTab(msg, sender, sendResponse, {
        type: "KNOWW_GET_PORTFOLIO_WALLETS",
      });
      return true;
    }

    if (msg?.type === "KNOWW_GET_PORTFOLIO_CONNECTED_WALLET") {
      // The wallet session lives in the tab it was connected on — prefer the
      // remembered signing tab (with active-tab fallback in the resolver), or
      // the lookup asks a session-less tab and the side panel renders
      // "Connect a wallet" next to a connected trading card.
      void resolvePortfolioSigningTabId(msg, sender).then((tabId) => {
        if (typeof tabId !== "number") {
          sendResponse({
            ok: false,
            error: "No active content tab is available.",
          } as BackgroundResponse);
          return;
        }

        sendMessageToContentTab(
          tabId,
          { type: "KNOWW_GET_PORTFOLIO_CONNECTED_WALLET" },
          (response) => {
            const envelope = response as { ok?: boolean; data?: unknown };
            const content = envelope.data as
              | { success?: boolean; data?: { address?: unknown } }
              | undefined;
            const address = content?.data?.address;
            if (content?.success === true && typeof address === "string") {
              portfolioSigningTabId = tabId;
            }
            sendResponse(response);
          }
        );
      });
      return true;
    }

    if (msg?.type === "KNOWW_CONNECT_PORTFOLIO_WALLET") {
      void resolveContentTargetTabId(msg, sender).then((tabId) => {
        if (typeof tabId !== "number") {
          sendResponse({
            ok: false,
            error: "No active content tab is available.",
          } as BackgroundResponse);
          return;
        }
        // Remember the tab so later deposit/withdraw signatures relay here.
        portfolioSigningTabId = tabId;
        sendMessageToContentTab(
          tabId,
          {
            type: "KNOWW_CONNECT_PORTFOLIO_WALLET",
            walletUuid: msg.walletUuid,
          },
          sendResponse
        );
      });
      return true;
    }

    if (msg?.type === "KNOWW_SWITCH_PORTFOLIO_WALLET") {
      void resolveContentTargetTabId(msg, sender).then((tabId) => {
        if (typeof tabId !== "number") {
          sendResponse({
            ok: false,
            error: "No active content tab is available.",
          } as BackgroundResponse);
          return;
        }
        portfolioSigningTabId = tabId;
        sendMessageToContentTab(
          tabId,
          { type: "KNOWW_SWITCH_PORTFOLIO_WALLET" },
          sendResponse
        );
      });
      return true;
    }

    if (msg?.type === "KNOWW_GET_PORTFOLIO_WALLETCONNECT_STATE") {
      void resolvePortfolioSigningTabId(msg, sender).then((tabId) => {
        if (typeof tabId !== "number") {
          sendResponse({
            ok: false,
            error: "No active content tab is available.",
          } as BackgroundResponse);
          return;
        }
        sendMessageToContentTab(
          tabId,
          {
            type: "KNOWW_GET_PORTFOLIO_WALLETCONNECT_STATE",
          },
          sendResponse
        );
      });
      return true;
    }

    if (msg?.type === "KNOWW_CANCEL_PORTFOLIO_WALLETCONNECT") {
      void resolvePortfolioSigningTabId(msg, sender).then((tabId) => {
        if (typeof tabId !== "number") {
          sendResponse({
            ok: false,
            error: "No active content tab is available.",
          } as BackgroundResponse);
          return;
        }
        sendMessageToContentTab(
          tabId,
          {
            type: "KNOWW_CANCEL_PORTFOLIO_WALLETCONNECT",
          },
          sendResponse
        );
      });
      return true;
    }

    if (msg?.type === "KNOWW_PORTFOLIO_REAUTH") {
      void resolvePortfolioSigningTabId(msg, sender).then((tabId) => {
        if (typeof tabId !== "number") {
          sendResponse({
            ok: false,
            error: "NO_CONTENT_TAB",
          } as BackgroundResponse);
          return;
        }
        portfolioSigningTabId = tabId;
        sendMessageToContentTab(
          tabId,
          { type: "KNOWW_PORTFOLIO_REAUTH", address: msg.address },
          sendResponse
        );
      });
      return true;
    }

    if (
      msg?.type === "KNOWW_GET_PORTFOLIO_TRADING_STATUS" &&
      typeof msg.address === "string"
    ) {
      void hasClobCredentials(msg.address)
        .then((hasCredentials) => {
          sendResponse({
            ok: true,
            data: { hasCredentials },
          } as BackgroundResponse);
        })
        .catch(() => {
          sendResponse({
            ok: true,
            data: { hasCredentials: false },
          } as BackgroundResponse);
        });
      return true;
    }

    if (
      msg?.type === "KNOWW_ENABLE_PORTFOLIO_TRADING" &&
      typeof msg.address === "string"
    ) {
      if (__STORE_BUILD__) {
        sendResponse(STORE_TRADING_DISABLED_RESPONSE);
        return true;
      }
      forwardToPortfolioSigningTab(msg, sender, sendResponse, {
        type: "KNOWW_ENABLE_PORTFOLIO_TRADING",
        address: msg.address,
      });
      return true;
    }

    if (
      msg?.type === "KNOWW_APPROVE_PORTFOLIO_TRADING" &&
      typeof msg.address === "string"
    ) {
      if (__STORE_BUILD__) {
        sendResponse(STORE_TRADING_DISABLED_RESPONSE);
        return true;
      }
      const approvalAmount = (msg as { approvalAmount?: unknown })
        .approvalAmount;
      forwardToPortfolioSigningTab(msg, sender, sendResponse, {
        type: "KNOWW_APPROVE_PORTFOLIO_TRADING",
        address: msg.address,
        approvalAmount:
          typeof approvalAmount === "string" ? approvalAmount : undefined,
      });
      return true;
    }

    if (
      msg?.type === "KNOWW_GET_PORTFOLIO_OPEN_ORDERS" &&
      typeof msg.address === "string"
    ) {
      if (__STORE_BUILD__) {
        // Open orders are fetched with signed CLOB requests the store build
        // cannot make (module and host permission are both stripped); an empty
        // list keeps the read-only portfolio rendering cleanly.
        sendResponse({
          ok: true,
          data: { orders: [], count: 0 },
        } as BackgroundResponse);
        return true;
      }
      const address = msg.address;
      void (async () => {
        const credentials = await loadClobCredentials(address);
        if (!credentials) {
          sendResponse({
            ok: true,
            data: { orders: [], count: 0 },
          } as BackgroundResponse);
          return;
        }

        const { fetchPortfolioOpenOrders } = await import(
          /* webpackMode: "eager" */ "./background/clob-open-orders"
        );
        const orders: PortfolioClobOpenOrder[] = await fetchPortfolioOpenOrders(
          {
            address,
            credentials,
            limit: 5,
          }
        );
        sendResponse({
          ok: true,
          data: { orders, count: orders.length },
        } as BackgroundResponse);
      })().catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        } as BackgroundResponse);
      });
      return true;
    }

    if (msg?.type === "KNOWW_SELL_PORTFOLIO_POSITION") {
      if (__STORE_BUILD__) {
        sendResponse(STORE_TRADING_DISABLED_RESPONSE);
        return true;
      }
      if (
        typeof msg.address !== "string" ||
        typeof msg.proxyAddress !== "string" ||
        typeof msg.tokenId !== "string" ||
        typeof msg.conditionId !== "string" ||
        typeof msg.outcomeIndex !== "number" ||
        typeof msg.size !== "number" ||
        !Number.isFinite(msg.size) ||
        msg.size <= 0
      ) {
        sendResponse({
          ok: false,
          error: "Invalid sell position request.",
        } as BackgroundResponse);
        return true;
      }

      void resolvePortfolioSigningTabId(msg, sender).then((tabId) => {
        if (typeof tabId !== "number") {
          sendResponse({
            ok: false,
            error: "NO_CONTENT_TAB",
          } as BackgroundResponse);
          return;
        }

        forwardToOffscreen(
          {
            type: "trading:place-order",
            tokenId: msg.tokenId,
            conditionId: msg.conditionId,
            outcomeIndex: msg.outcomeIndex,
            side: "SELL",
            price: 0,
            size: msg.size,
            amount: msg.size,
            orderType: "FAK",
            negRisk: msg.negRisk === true,
            address: msg.address,
            proxyAddress: msg.proxyAddress,
            walletMode: msg.walletMode,
          },
          { ...sender, tab: { id: tabId } as chrome.tabs.Tab },
          sendResponse
        );
      });
      return true;
    }

    if (
      msg?.type === "KNOWW_CANCEL_PORTFOLIO_OPEN_ORDER" &&
      typeof msg.address === "string" &&
      typeof msg.orderId === "string"
    ) {
      if (__STORE_BUILD__) {
        sendResponse(STORE_TRADING_DISABLED_RESPONSE);
        return true;
      }
      const address = msg.address;
      const orderId = msg.orderId;
      void (async () => {
        const credentials = await loadClobCredentials(address);
        if (!credentials) {
          sendResponse({
            ok: false,
            error: "Trading is not enabled for this wallet.",
          } as BackgroundResponse);
          return;
        }

        const { cancelClobOrder } = await import(
          /* webpackMode: "eager" */ "./background/clob-open-orders"
        );
        await cancelClobOrder({ address, credentials, orderId });
        sendResponse({ ok: true, data: { orderId } } as BackgroundResponse);
      })().catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        } as BackgroundResponse);
      });
      return true;
    }

    if (msg?.type === "KNOWW_PORTFOLIO_BRIDGE_ASSETS") {
      if (!__STORE_BUILD__) {
        void import(/* webpackMode: "eager" */ "./background/portfolio-funds")
          .then(({ getPortfolioBridgeAssets }) => getPortfolioBridgeAssets())
          .then((assets) =>
            sendResponse({ ok: true, data: { assets } } as BackgroundResponse)
          )
          .catch((error) => {
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            } as BackgroundResponse);
          });
        return true;
      }
      sendResponse(STORE_TRADING_DISABLED_RESPONSE);
      return true;
    }

    if (
      msg?.type === "KNOWW_PORTFOLIO_WALLET_TOKENS" &&
      typeof msg.address === "string"
    ) {
      if (!__STORE_BUILD__) {
        const walletAddress = msg.address;
        void import(/* webpackMode: "eager" */ "./background/portfolio-funds")
          .then(({ getPortfolioWalletTokens }) =>
            getPortfolioWalletTokens(walletAddress)
          )
          .then((data) =>
            sendResponse({ ok: true, data } as BackgroundResponse)
          )
          .catch((error) => {
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            } as BackgroundResponse);
          });
        return true;
      }
      sendResponse(STORE_TRADING_DISABLED_RESPONSE);
      return true;
    }

    if (
      msg?.type === "KNOWW_PORTFOLIO_GET_DEPOSIT_MAX" &&
      typeof msg.address === "string"
    ) {
      const eoaAddress = msg.address;
      if (!__STORE_BUILD__) {
        void import(/* webpackMode: "eager" */ "./background/portfolio-funds")
          .then(({ getPortfolioDepositMax }) =>
            getPortfolioDepositMax(eoaAddress)
          )
          .then((data) =>
            sendResponse({ ok: true, data } as BackgroundResponse)
          )
          .catch((error) => {
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            } as BackgroundResponse);
          });
        return true;
      }
      sendResponse(STORE_TRADING_DISABLED_RESPONSE);
      return true;
    }

    if (
      msg?.type === "KNOWW_PORTFOLIO_WITHDRAW_QUOTE" &&
      typeof msg.amount === "string" &&
      typeof msg.destination === "string"
    ) {
      if (!__STORE_BUILD__) {
        logInfo("portfolio.withdraw.message.quote", {
          amount: msg.amount,
          recipientAddress: msg.destination,
          chainKey: msg.chainKey,
          tokenId: msg.tokenId,
        });
        const quoteRequest = {
          amount: msg.amount,
          destination: msg.destination,
          chainKey: msg.chainKey,
          tokenId: msg.tokenId,
        };
        void import(/* webpackMode: "eager" */ "./background/portfolio-funds")
          .then(({ getPortfolioWithdrawQuote }) =>
            getPortfolioWithdrawQuote(quoteRequest)
          )
          .then((data) =>
            sendResponse({ ok: true, data } as BackgroundResponse)
          )
          .catch((error) => {
            logWarn("portfolio.withdraw.message.quote_failed", {
              error,
              amount: quoteRequest.amount,
              recipientAddress: quoteRequest.destination,
              chainKey: quoteRequest.chainKey,
              tokenId: quoteRequest.tokenId,
            });
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            } as BackgroundResponse);
          });
        return true;
      }
      sendResponse(STORE_TRADING_DISABLED_RESPONSE);
      return true;
    }

    if (
      msg?.type === "KNOWW_PORTFOLIO_WITHDRAW_STATUS" &&
      typeof msg.bridgeAddress === "string"
    ) {
      if (!__STORE_BUILD__) {
        const bridgeAddress = msg.bridgeAddress;
        void import(/* webpackMode: "eager" */ "./background/portfolio-funds")
          .then(({ getPortfolioWithdrawStatus }) =>
            getPortfolioWithdrawStatus(bridgeAddress)
          )
          .then((data) =>
            sendResponse({ ok: true, data } as BackgroundResponse)
          )
          .catch((error) => {
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            } as BackgroundResponse);
          });
        return true;
      }
      sendResponse(STORE_TRADING_DISABLED_RESPONSE);
      return true;
    }

    if (msg?.type === "KNOWW_PORTFOLIO_FUND_BEGIN_ATTEMPT") {
      if (__STORE_BUILD__) {
        sendResponse(STORE_TRADING_DISABLED_RESPONSE);
        return true;
      }
      if (
        (msg.action !== "deposit" && msg.action !== "withdraw") ||
        typeof msg.address !== "string" ||
        typeof msg.amount !== "string" ||
        (msg.walletMode !== undefined && typeof msg.walletMode !== "string") ||
        (msg.destination !== undefined &&
          typeof msg.destination !== "string") ||
        (msg.chainId !== undefined && typeof msg.chainId !== "string") ||
        (msg.tokenSymbol !== undefined &&
          typeof msg.tokenSymbol !== "string") ||
        (msg.tokenAddress !== undefined &&
          typeof msg.tokenAddress !== "string") ||
        (msg.tokenDecimals !== undefined &&
          typeof msg.tokenDecimals !== "number") ||
        (msg.chainKey !== undefined && typeof msg.chainKey !== "string") ||
        (msg.tokenId !== undefined && typeof msg.tokenId !== "string")
      ) {
        sendResponse({
          ok: false,
          error: "Invalid portfolio fund attempt request.",
        } as BackgroundResponse);
        return true;
      }
      void portfolioFundAttempts
        .begin({
          action: msg.action,
          address: msg.address,
          walletMode: msg.walletMode,
          amount: msg.amount,
          destination: msg.destination,
          chainId: msg.chainId,
          tokenSymbol: msg.tokenSymbol,
          tokenAddress: msg.tokenAddress,
          tokenDecimals: msg.tokenDecimals,
          chainKey: msg.chainKey,
          tokenId: msg.tokenId,
        })
        .then((data) => sendResponse({ ok: true, data } as BackgroundResponse))
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          } as BackgroundResponse);
        });
      return true;
    }

    if (msg?.type === "KNOWW_PORTFOLIO_FUND_COMPLETE_ATTEMPT") {
      if (__STORE_BUILD__) {
        sendResponse(STORE_TRADING_DISABLED_RESPONSE);
        return true;
      }
      if (
        typeof msg.attemptId !== "string" ||
        !isPortfolioFundIdempotencyKey(msg.idempotencyKey) ||
        (msg.outcome !== "credited" && msg.outcome !== "reverted")
      ) {
        sendResponse({
          ok: false,
          error: "Invalid portfolio fund attempt completion request.",
        } as BackgroundResponse);
        return true;
      }
      void portfolioFundAttempts
        .complete(msg.attemptId, msg.outcome, msg.idempotencyKey)
        .then(() =>
          sendResponse({ ok: true, data: null } as BackgroundResponse)
        )
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          } as BackgroundResponse);
        });
      return true;
    }

    if (
      msg?.type === "KNOWW_PORTFOLIO_DEPOSIT" ||
      msg?.type === "KNOWW_PORTFOLIO_WITHDRAW"
    ) {
      if (__STORE_BUILD__) {
        sendResponse(STORE_TRADING_DISABLED_RESPONSE);
        return true;
      }
      if (
        typeof msg.address !== "string" ||
        typeof msg.amount !== "string" ||
        !isPortfolioFundIdempotencyKey(msg.idempotencyKey)
      ) {
        sendResponse({
          ok: false,
          error: "Invalid portfolio transaction request.",
        } as BackgroundResponse);
        return true;
      }
      const isWithdraw = msg.type === "KNOWW_PORTFOLIO_WITHDRAW";
      const eoaAddress = msg.address;
      const amount = msg.amount;
      const idempotencyKey = msg.idempotencyKey;
      const walletMode = msg.walletMode;
      const destination = msg.destination;
      const chainId = msg.chainId;
      const tokenSymbol = msg.tokenSymbol;
      const tokenAddress = msg.tokenAddress;
      const tokenDecimals = msg.tokenDecimals;
      const chainKey = msg.chainKey;
      const tokenId = msg.tokenId;
      const attemptId = msg.attemptId;
      const withdrawQuote =
        isWithdraw && isPortfolioWithdrawQuoteResponse(msg.quote)
          ? msg.quote
          : undefined;
      let fingerprint: string;
      try {
        fingerprint = fingerprintPortfolioFundIntent({
          action: isWithdraw ? "withdraw" : "deposit",
          address: eoaAddress,
          walletMode,
          amount,
          destination,
          chainId,
          tokenSymbol,
          tokenAddress,
          tokenDecimals,
          chainKey,
          tokenId,
        });
      } catch {
        sendResponse({
          ok: false,
          error: "Invalid portfolio transaction request.",
        } as BackgroundResponse);
        return true;
      }
      if (isWithdraw) {
        logInfo("portfolio.withdraw.message.execute", {
          ownerAddress: eoaAddress,
          walletMode,
          amount,
          recipientAddress: destination,
          chainKey,
          tokenId,
        });
      }
      void resolvePortfolioSigningTabId(msg, sender).then((tabId) => {
        if (typeof tabId !== "number") {
          // No supported content tab to sign through — the side panel falls
          // back to the knoww.app funds page when it sees NO_CONTENT_TAB.
          sendResponse({
            ok: false,
            error: "NO_CONTENT_TAB",
          } as BackgroundResponse);
          return;
        }
        const run = portfolioFundIdempotency.run({
          idempotencyKey,
          fingerprint,
          isSafeToRetryError: (error) =>
            error instanceof Error &&
            error.message === EXTENSION_AUTH_REQUIRED_ERROR,
          execute: async ({ markMoneyMovementStarted }) => {
            // The dynamic import stays inside this `!__STORE_BUILD__` branch so
            // webpack drops portfolio-funds (and its bridge-signer /
            // relayer-client / viem chain) from the store-compliant build.
            if (!__STORE_BUILD__) {
              const { executePortfolioDeposit, executePortfolioWithdraw } =
                await import(
                  /* webpackMode: "eager" */ "./background/portfolio-funds"
                );
              if (isWithdraw) {
                return executePortfolioWithdraw({
                  eoaAddress,
                  walletMode,
                  amount,
                  destination: destination ?? "",
                  chainKey,
                  tokenId,
                  quote: withdrawQuote,
                  tabId,
                  onBeforeMoneyMovement: markMoneyMovementStarted,
                });
              }
              return executePortfolioDeposit({
                eoaAddress,
                walletMode,
                amount,
                chainId,
                tokenSymbol,
                tokenAddress,
                tokenDecimals,
                tabId,
                onBeforeMoneyMovement: markMoneyMovementStarted,
              });
            }
            throw new Error(STORE_TRADING_DISABLED_MESSAGE);
          },
        });
        run
          .then(async (data) => {
            if (typeof attemptId === "string") {
              try {
                // attempt.txHash stores the status-polling handle: on-chain
                // hash for deposits, bridge address (or the sidepanel
                // gateway's "direct" sentinel for a direct-route withdraw
                // with no bridge address) for withdraws. Deposits keep the
                // real on-chain hash since waitForTxReceipt needs it; a
                // withdraw resumed from this record must poll with the same
                // handle `executeWithdraw` returned in-session, or
                // KNOWW_PORTFOLIO_WITHDRAW_STATUS never matches and RETRY
                // spins forever.
                const recordedTxHash = isWithdraw
                  ? ((data as { bridgeAddress?: string }).bridgeAddress ??
                    "direct")
                  : data.txHash;
                await portfolioFundAttempts.recordExecution(
                  attemptId,
                  recordedTxHash,
                  idempotencyKey
                );
              } catch (error) {
                // A recording failure must not turn a successful on-chain
                // execution into an error response — the money already
                // moved. Log and proceed; the attempt simply won't resume
                // from this txHash if the caller retries.
                logWarn("portfolio.fund.attempt.record_execution_failed", {
                  error,
                  attemptId,
                });
              }
            }
            sendResponse({ ok: true, data } as BackgroundResponse);
          })
          .catch((error) => {
            if (isWithdraw) {
              logWarn("portfolio.withdraw.message.execute_failed", {
                error,
                ownerAddress: eoaAddress,
                walletMode,
                amount,
                recipientAddress: destination,
                chainKey,
                tokenId,
              });
            }
            sendResponse({
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            } as BackgroundResponse);
          });
      });
      return true;
    }

    // Offscreen doc requests: forward signing to content script tab
    if (msg?.type === "offscreen:forward-signing") {
      if (msg.tabId && msg.id && msg.method) {
        chrome.tabs.sendMessage(
          msg.tabId,
          {
            type: "trading:signing-request",
            id: msg.id,
            method: msg.method,
            params: msg.params,
          },
          () => {
            if (chrome.runtime.lastError) {
              sendResponse({
                ok: false,
                error: chrome.runtime.lastError.message,
              } as BackgroundResponse);
            } else {
              sendResponse({ ok: true, data: null } as BackgroundResponse);
            }
          }
        );
      }
      return true;
    }

    // Credential storage — keep creds in session storage behind the SW boundary.
    //
    // Defense-in-depth on this handler family:
    //   1. `sender.id !== chrome.runtime.id` reject — guards against future
    //      regressions that add `externally_connectable` and would otherwise
    //      expose credentials to web pages.
    //   2. `creds:*` keys are locked to the TRADING_CREDS_STORAGE_PREFIX
    //      namespace so a compromised content script cannot use this generic
    //      key/value channel to read or overwrite unrelated entries (most
    //      importantly the extension bearer at `knoww_extension_access_token`).
    // `creds:has` returns ONLY a boolean presence flag, never the raw
    // credential object. CLOB credentials are written by the background worker
    // itself (on derive) and read only inside the worker for signing/placing
    // orders, so the apiKey/apiSecret/apiPassphrase never cross to content.
    if (msg?.type === "creds:has" && typeof msg.key === "string") {
      const senderReject = checkAuthorizedSender(sender.id, chrome.runtime.id);
      if (senderReject) {
        sendResponse(senderReject as BackgroundResponse);
        return true;
      }
      const keyReject = checkCredsKey(msg.key);
      if (keyReject) {
        sendResponse(keyReject as BackgroundResponse);
        return true;
      }
      const address = msg.key.slice(TRADING_CREDS_STORAGE_PREFIX.length);
      void hasClobCredentials(address)
        .then((hasCredentials) => {
          sendResponse({
            ok: true,
            data: { hasCredentials },
          } as BackgroundResponse);
        })
        .catch(() => {
          sendResponse({
            ok: true,
            data: { hasCredentials: false },
          } as BackgroundResponse);
        });
      return true;
    }
    if (msg?.type === "creds:derive-begin" && typeof msg.key === "string") {
      const senderReject = checkAuthorizedSender(sender.id, chrome.runtime.id);
      if (senderReject) {
        sendResponse(senderReject as BackgroundResponse);
        return true;
      }
      const keyReject = checkCredsKey(msg.key);
      if (keyReject) {
        sendResponse(keyReject as BackgroundResponse);
        return true;
      }
      const address = msg.key.slice(TRADING_CREDS_STORAGE_PREFIX.length);
      void resolveClobCredentialDerivationBegin(address, {
        hasCredentials: () => hasClobCredentials(address),
        ownerTabId: sender.tab?.id,
      })
        .then((data) => {
          sendResponse({
            ok: true,
            data,
          } as BackgroundResponse);
        })
        .catch(() => {
          sendResponse({
            ok: false,
            error: "Failed to check credential state",
          } as BackgroundResponse);
        });
      return true;
    }
    if (msg?.type === "creds:derive-status" && typeof msg.key === "string") {
      const senderReject = checkAuthorizedSender(sender.id, chrome.runtime.id);
      if (senderReject) {
        sendResponse(senderReject as BackgroundResponse);
        return true;
      }
      const keyReject = checkCredsKey(msg.key);
      if (keyReject) {
        sendResponse(keyReject as BackgroundResponse);
        return true;
      }
      const address = msg.key.slice(TRADING_CREDS_STORAGE_PREFIX.length);
      void hasClobCredentials(address)
        .then((hasCredentials) => {
          sendResponse({
            ok: true,
            data: hasCredentials
              ? { status: "present" }
              : getClobCredentialDerivationStatus(address),
          } as BackgroundResponse);
        })
        .catch(() => {
          sendResponse({
            ok: true,
            data: getClobCredentialDerivationStatus(address),
          } as BackgroundResponse);
        });
      return true;
    }
    if (
      msg?.type === "creds:derive-end" &&
      typeof msg.key === "string" &&
      typeof msg.token === "string"
    ) {
      const senderReject = checkAuthorizedSender(sender.id, chrome.runtime.id);
      if (senderReject) {
        sendResponse(senderReject as BackgroundResponse);
        return true;
      }
      const keyReject = checkCredsKey(msg.key);
      if (keyReject) {
        sendResponse(keyReject as BackgroundResponse);
        return true;
      }
      const address = msg.key.slice(TRADING_CREDS_STORAGE_PREFIX.length);
      sendResponse({
        ok: true,
        data: {
          released: endClobCredentialDerivation(address, msg.token),
        },
      } as BackgroundResponse);
      return true;
    }
    if (msg?.type === "creds:remove" && typeof msg.key === "string") {
      const senderReject = checkAuthorizedSender(sender.id, chrome.runtime.id);
      if (senderReject) {
        sendResponse(senderReject as BackgroundResponse);
        return true;
      }
      const keyReject = checkCredsKey(msg.key);
      if (keyReject) {
        sendResponse(keyReject as BackgroundResponse);
        return true;
      }
      chrome.storage.session.remove(msg.key, () => {
        sendResponse({ ok: true, data: null } as BackgroundResponse);
      });
      return true;
    }
    // Return ONLY derived session facts ({ loggedIn, address }), never the raw
    // bearer token. The token stays in the worker; authed fetches go through the
    // fetch-json proxy, which attaches it internally for knoww.app/api URLs.
    if (msg?.type === "auth:get-session-info") {
      const senderReject = checkAuthorizedSender(sender.id, chrome.runtime.id);
      if (senderReject) {
        sendResponse(senderReject as BackgroundResponse);
        return true;
      }
      getExtensionSessionInfo().then((info) => {
        sendResponse({ ok: true, data: info } as BackgroundResponse);
      });
      return true;
    }
    if (msg?.type === "auth:set-token" && typeof msg.token === "string") {
      setExtensionAccessToken(msg.token).then(() => {
        sendResponse({ ok: true, data: null } as BackgroundResponse);
      });
      return true;
    }
    if (msg?.type === "auth:clear-token") {
      clearExtensionAccessToken().then(() => {
        sendResponse({ ok: true, data: null } as BackgroundResponse);
      });
      return true;
    }
    if (msg?.type === "auth:logout") {
      (async () => {
        const token = await getExtensionAccessToken();

        try {
          if (token) {
            await fetch(`${getKnowwAppUrl()}/api/extension/session/logout`, {
              method: "POST",
              headers: {
                Accept: "application/json",
                Authorization: `Bearer ${token}`,
              },
            });
          }
        } finally {
          await clearCachedTradingCredentials();
          await clearExtensionAccessToken();
          await resetAnalyticsIdentity();
          await chrome.storage.local
            .remove(TRADING_WARM_ELIGIBLE_STORAGE_KEY)
            .catch(() => {});
          await broadcastTradingSessionDisconnected();
          sendResponse({ ok: true, data: null } as BackgroundResponse);
        }
      })();
      return true;
    }

    if (msg?.type === "analytics:track" && typeof msg.event === "string") {
      queueAnalyticsEvent({
        event: msg.event,
        properties:
          typeof msg.properties === "object" && msg.properties !== null
            ? (msg.properties as Record<
                string,
                string | number | boolean | null | undefined
              >)
            : undefined,
      })
        .then(() => {
          sendResponse({ ok: true, data: null } as BackgroundResponse);
        })
        .catch((error) => {
          logWarn("analytics.queue_failed", error);
          sendResponse({
            ok: false,
            error: "Failed to queue analytics event",
          } as BackgroundResponse);
        });
      return true;
    }

    if (msg?.type === "site-support:request") {
      const senderReject = checkAuthorizedSender(sender.id, chrome.runtime.id);
      const expectedSenderUrl = chrome.runtime.getURL("sidepanel.html");
      const hostname = normalizeSiteSupportHostname(
        typeof msg.hostname === "string" ? msg.hostname : ""
      );
      if (!hostname || hostname !== msg.hostname) {
        sendResponse({
          ok: false,
          error: "Invalid website hostname",
        } as BackgroundResponse);
        return true;
      }

      const senderHostname = getUnsupportedSiteHostname(
        sender.tab?.url ?? sender.url
      );
      const authorizedSurface =
        sender.url === expectedSenderUrl || senderHostname === hostname;
      if (senderReject || !authorizedSurface) {
        sendResponse({
          ok: false,
          error: "This request must come from a Knoww support prompt",
        } as BackgroundResponse);
        return true;
      }

      void submitSiteSupportRequest(hostname)
        .then((submitted) => {
          sendResponse(
            submitted
              ? ({ ok: true, data: null } as BackgroundResponse)
              : ({
                  ok: false,
                  error: "Unable to send the website support request",
                } as BackgroundResponse)
          );
        })
        .catch((error) => {
          logWarn("site_support.request_failed", {
            errorName: error instanceof Error ? error.name : "UnknownError",
          });
          sendResponse({
            ok: false,
            error: "Unable to send the website support request",
          } as BackgroundResponse);
        });
      return true;
    }

    // Orderbook fetch — lightweight public API call, no crypto needed.
    // Handle directly in the service worker to avoid offscreen boot latency.
    if (
      msg?.type === "trading:get-orderbook" &&
      typeof msg.tokenId === "string"
    ) {
      const { tokenId } = msg;
      // The order book is only used by the in-page trading panel, which the
      // store build does not ship. Keeping the `@knoww/shared-types/clob`
      // import inside this dead-in-store branch prevents the unified CLOB SDK
      // chunk from being emitted into the store bundle.
      if (!__STORE_BUILD__) {
        (async () => {
          try {
            const { fetchClobOrderBook } = await import(
              /* webpackMode: "eager" */ "@knoww/shared-types/clob"
            );
            const data = await fetchClobOrderBook(tokenId, {
              host: POLYMARKET_API.CLOB.BASE,
            });
            sendResponse({ ok: true, data } as BackgroundResponse);
          } catch (e) {
            sendResponse({
              ok: false,
              error: e instanceof Error ? e.message : String(e),
            } as BackgroundResponse);
          }
        })();
        return true;
      }
      sendResponse(STORE_TRADING_DISABLED_RESPONSE);
      return true;
    }

    // Pre-warm offscreen document so it's ready when the user places a trade
    if (msg?.type === "trading:prewarm-offscreen") {
      if (__STORE_BUILD__) {
        // Nothing to warm: the store build ships no offscreen trading runtime.
        // Prewarm is fire-and-forget, so answer ok like the full build does.
        sendResponse({ ok: true, data: null } as BackgroundResponse);
        return true;
      }
      void ensureOffscreen()
        .then(() =>
          sendOffscreenMessage(
            "offscreen:trading-prewarm",
            message,
            sender.tab?.id
          )
        )
        .then(() =>
          sendResponse({ ok: true, data: null } as BackgroundResponse)
        )
        .catch(() =>
          sendResponse({ ok: true, data: null } as BackgroundResponse)
        );
      return true;
    }

    if (isScoringPrewarmMessage(message)) {
      void ensureOffscreen()
        .then(() =>
          sendOffscreenMessage(
            "offscreen:scoring-prewarm",
            message,
            sender.tab?.id
          )
        )
        .then(() =>
          sendResponse({ ok: true, data: null } as BackgroundResponse)
        )
        .catch(() =>
          sendResponse({ ok: true, data: null } as BackgroundResponse)
        );
      return true;
    }

    // A card-side wallet connect is broadcast (not forwarded to offscreen);
    // it is also the only signal telling the SW which tab holds the wallet
    // session when the user never touched a side-panel flow — latch it so
    // signing forwards and the connected-wallet lookup target that tab.
    if (
      (message as { type?: unknown })?.type === "trading:wallet-connected" &&
      typeof sender.tab?.id === "number"
    ) {
      portfolioSigningTabId = sender.tab.id;
      return false;
    }

    // Trading messages — forward to offscreen document
    if (isTradingMessage(message)) {
      if (__STORE_BUILD__) {
        // The store offscreen document has no trading handler; forwarding
        // would hang the sender's response callback. The two read-only
        // messages the portfolio sidepanel needs (proxy-address derivation
        // and the cash-balance read) are answered inline in the SW; every
        // other trading message fails fast, and its caller treats the error
        // response as an empty value.
        if (handleStorePortfolioRead(message, sendResponse)) {
          return true;
        }
        sendResponse(STORE_TRADING_DISABLED_RESPONSE);
        return true;
      }
      forwardToOffscreen(message, sender, sendResponse);
      return true;
    }

    // Fetch text (GET)
    if (isFetchTextMessage(message)) {
      (async () => {
        const urlValidation = isAllowedUrl(message.url);
        if (!urlValidation.valid) {
          sendResponse({
            ok: false,
            error: urlValidation.error || "URL not allowed",
          });
          return;
        }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        try {
          const res = await fetch(message.url, {
            cache: "no-cache",
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          if (!isAllowedRedirect(message.url, res.url)) {
            sendResponse({
              ok: false,
              status: res.status,
              error: "Security: t.co redirect target is not allowed",
            });
            return;
          }
          const text = await res.text();
          sendResponse({
            ok: true,
            status: res.status,
            text,
            responseUrl: res.url,
          });
        } catch (e) {
          clearTimeout(timeoutId);
          sendResponse({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      })();
      return true;
    }

    // Unified scoring endpoint (single RPC path)
    if (isScoreMarketsMessage(message)) {
      const payload = message as ScoreMarketsMessage;
      void ensureOffscreen()
        .then(() =>
          sendOffscreenMessage("offscreen:scoring", payload, sender.tab?.id)
        )
        .then((response) => {
          if (!response?.ok) {
            sendResponse({
              ok: false,
              error: response?.error ?? "Scoring request failed",
            });
            return;
          }

          if (!isScoreMarketsSuccessResponse(response)) {
            logWarn("background.scoring-invalid-response", {
              type: payload.type,
              includeEmbeddings: payload.includeEmbeddings,
              includeBm25: payload.includeBm25,
              includeContextGate: payload.includeContextGate,
            });
            sendResponse({
              ok: false,
              error: "Scoring response missing fields",
            });
            return;
          }
          sendResponse(response);
        })
        .catch((error) => {
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      return true;
    }

    // Fetch image bytes and return a data URL for pages whose CSP blocks
    // direct Polymarket image origins in injected DOM.
    if (isFetchImageDataUrlMessage(message)) {
      (async () => {
        const urlValidation = isAllowedUrl(message.url);
        if (!urlValidation.valid) {
          sendResponse({
            ok: false,
            error: urlValidation.error || "URL not allowed",
          });
          return;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        try {
          const res = await fetch(message.url, {
            cache: "force-cache",
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          if (!isAllowedRedirect(message.url, res.url)) {
            sendResponse({
              ok: false,
              status: res.status,
              error: "Security: image redirect target is not allowed",
            });
            return;
          }

          if (!res.ok) {
            sendResponse({
              ok: false,
              status: res.status,
              error: `Image request failed with status ${res.status}`,
            });
            return;
          }

          const contentType =
            res.headers.get("content-type")?.split(";")[0].toLowerCase() || "";
          if (!contentType.startsWith("image/")) {
            sendResponse({
              ok: false,
              status: res.status,
              error: "Response is not an image",
            });
            return;
          }

          const contentLength = Number(res.headers.get("content-length") || 0);
          if (contentLength > MAX_IMAGE_PROXY_BYTES) {
            sendResponse({
              ok: false,
              status: res.status,
              error: "Image is too large",
            });
            return;
          }

          const buffer = await res.arrayBuffer();
          if (buffer.byteLength > MAX_IMAGE_PROXY_BYTES) {
            sendResponse({
              ok: false,
              status: res.status,
              error: "Image is too large",
            });
            return;
          }

          sendResponse({
            ok: true,
            status: res.status,
            contentType,
            dataUrl: `data:${contentType};base64,${arrayBufferToBase64(buffer)}`,
            responseUrl: res.url,
          });
        } catch (e) {
          clearTimeout(timeoutId);
          sendResponse({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      })();
      return true;
    }

    // Fetch JSON (POST)
    if (isFetchJsonMessage(message)) {
      void (async () => {
        try {
          const result = isCapacityManagedExtensionRequest(
            message,
            isKnowwApiUrl
          )
            ? await searchRequestScheduler.enqueue(() =>
                runSearchWithRetry(
                  ({ timeoutMs }) =>
                    performFetchJson(
                      message,
                      Math.min(timeoutMs, SEARCH_ATTEMPT_TIMEOUT_MS)
                    ),
                  {
                    maximumAttempts: 2,
                    maximumElapsedMs: SEARCH_REQUEST_MAX_ELAPSED_MS,
                  }
                )
              )
            : await performFetchJson(message, 30_000);
          sendResponse(toBackgroundResponse(result));
        } catch (error) {
          const queueWaitMs =
            error instanceof SearchQueueCapacityError ||
            error instanceof SearchQueueDeadlineError
              ? error.queueWaitMs
              : undefined;
          logWarn("background.search-request-skipped", {
            reason:
              error instanceof SearchQueueCapacityError
                ? "capacity"
                : error instanceof SearchQueueDeadlineError
                  ? "deadline"
                  : "unexpected",
            queueWaitMs,
          });
          sendResponse({
            ok: false,
            error: "Search request could not be completed",
          });
        }
      })();
      return true;
    }

    return false;
  }
);

void refreshNotificationPanelSurfaceCache();

chrome.tabs.onActivated.addListener((activeInfo) => {
  rememberActiveTab(activeInfo.tabId, activeInfo.windowId);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  lastFocusedWindowId = windowId;
  void queryActiveTabId(windowId);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync") return;

  const settingsChange = changes[SETTINGS_STORAGE_KEY];
  if (!settingsChange) return;

  updateNotificationPanelSurfaceFromSettings(
    settingsChange.newValue as Partial<UserSettings> | undefined
  );
});

chrome.action.onClicked.addListener((tab) => {
  if (typeof tab.id !== "number") return;
  if (isWebmailUrl(tab.url)) return;

  const unsupportedHostname = getUnsupportedSiteHostname(tab.url);
  if (unsupportedHostname) {
    void showUnsupportedSiteSupportPrompt(tab.id, { reveal: true });
    return;
  }

  const openFloatingPanel = () => sendOpenFloatingPanel(tab.id as number);
  const openSidePanel = () => {
    void openKnowwSidePanel(resolveSidePanelContext(tab)).catch(() => {
      openFloatingPanel();
    });
  };

  if (cachedNotificationPanelSurface === "sidebar") {
    openSidePanel();
    return;
  }

  if (cachedNotificationPanelSurface === "floating") {
    openFloatingPanel();
    return;
  }

  void refreshNotificationPanelSurfaceCache()
    .then((surface) => {
      if (surface === "sidebar") {
        openSidePanel();
        return;
      }
      openFloatingPanel();
    })
    .catch(() => {
      openFloatingPanel();
    });
});

chrome.runtime.onInstalled.addListener((details) => {
  void registerContentScripts().then(() => refreshOpenUnsupportedSitePrompts());
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    void queueAnalyticsEvent({
      event: "extension_installed",
      properties: {
        reason: details.reason,
      },
    });
    void chrome.tabs.create({
      url: chrome.runtime.getURL("onboarding.html"),
    });
    return;
  }

  void queueAnalyticsEvent({
    event: "extension_updated",
    properties: {
      reason: details.reason,
      previousVersion: details.previousVersion || null,
    },
  });

  if (
    details.reason === chrome.runtime.OnInstalledReason.UPDATE &&
    __DEV_MODE__
  ) {
    void chrome.tabs.create({
      url: chrome.runtime.getURL("onboarding.html"),
    });
  }
});
