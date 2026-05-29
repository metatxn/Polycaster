// ============================================
// BACKGROUND SERVICE WORKER
// Thin message router — delegates trading to offscreen document,
// handles fetch proxying, and attaches extension auth headers.
// ============================================

import { logWarn } from "@knoww/logger";
import { fetchClobOrderBook } from "@knoww/shared-types/clob";
import {
  POLYMARKET_API,
  RELAYER_API_HOST,
} from "@knoww/shared-types/polymarket";
import {
  flushAnalyticsQueue,
  queueAnalyticsEvent,
} from "./background/analytics";
import {
  fetchPortfolioOpenOrders,
  type PortfolioClobOpenOrder,
} from "./background/clob-open-orders";
import {
  checkAuthorizedSender,
  checkCredsKey,
  TRADING_CREDS_STORAGE_PREFIX,
} from "./background/creds-guards";
import {
  clearExtensionAccessToken,
  getExtensionAccessToken,
  getExtensionAuthorizationHeader,
  getKnowwAppUrl,
  isKnowwApiUrl,
  setExtensionAccessToken,
} from "./background/extension-session";
import { SUPPORTED_MATCH_PATTERNS } from "./supported-hosts";
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
  TRADING_CREDENTIALS_UPDATED_MESSAGE,
  TRADING_SESSION_DISCONNECTED_MESSAGE,
} from "./types/chrome-messages";
import { DEFAULT_USER_SETTINGS, type UserSettings } from "./types/settings";

// ── Programmatic content script registration ──
// Instead of declaring content_scripts in manifest.json (which would
// require <all_urls> and load on every site), we register them only
// for supported platforms via chrome.scripting.
const CONTENT_SCRIPT_ID = "knoww-content";
const MAX_IMAGE_PROXY_BYTES = 512 * 1024;
const SETTINGS_STORAGE_KEY = "knowwSettings";
const CONTENT_SCRIPT_REINJECT_SETTLE_MS = 500;

type ChromeSidePanelApi = {
  open: (options: { tabId?: number; windowId?: number }) => Promise<void>;
  close?: (options: { tabId?: number; windowId?: number }) => Promise<void>;
  setPanelBehavior?: (behavior: {
    openPanelOnActionClick: boolean;
  }) => Promise<void>;
};

type StoredClobCredentials = {
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
};

let lastSidePanelTabId: number | undefined;
let lastSidePanelWindowId: number | undefined;
let cachedNotificationPanelSurface:
  | UserSettings["notificationPanelSurface"]
  | undefined;
let lastFocusedWindowId: number | undefined;
const activeTabIdsByWindowId = new Map<number, number>();

function getSidePanelApi(): ChromeSidePanelApi | undefined {
  return (chrome as typeof chrome & { sidePanel?: ChromeSidePanelApi })
    .sidePanel;
}

function mergeUserSettings(stored?: Partial<UserSettings>): UserSettings {
  return {
    ...DEFAULT_USER_SETTINGS,
    ...(stored || {}),
    platforms: {
      ...DEFAULT_USER_SETTINGS.platforms,
      ...(stored?.platforms || {}),
    },
    sources: {
      ...DEFAULT_USER_SETTINGS.sources,
      ...(stored?.sources || {}),
      kalshi: DEFAULT_USER_SETTINGS.sources.kalshi,
    },
  };
}

async function readUserSettings(): Promise<UserSettings> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      { [SETTINGS_STORAGE_KEY]: DEFAULT_USER_SETTINGS },
      (result) => {
        resolve(
          mergeUserSettings(
            result[SETTINGS_STORAGE_KEY] as Partial<UserSettings> | undefined
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
  surface: UserSettings["notificationPanelSurface"]
): void {
  const sidePanel = getSidePanelApi();
  if (!sidePanel?.setPanelBehavior) return;

  sidePanel
    .setPanelBehavior({ openPanelOnActionClick: surface === "sidebar" })
    .catch(() => {
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
  const merged = mergeUserSettings(settings);
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

async function registerContentScripts(): Promise<void> {
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({
      ids: [CONTENT_SCRIPT_ID],
    });
    if (existing.length > 0) {
      await chrome.scripting.updateContentScripts([
        {
          id: CONTENT_SCRIPT_ID,
          matches: SUPPORTED_MATCH_PATTERNS,
          js: ["content.js"],
          runAt: "document_end",
        },
      ]);
    } else {
      await chrome.scripting.registerContentScripts([
        {
          id: CONTENT_SCRIPT_ID,
          matches: SUPPORTED_MATCH_PATTERNS,
          js: ["content.js"],
          runAt: "document_end",
        },
      ]);
    }
  } catch {
    // Fallback: script may already be registered from a previous SW lifecycle
  }
}

registerContentScripts();
void flushAnalyticsQueue();

// ── Build mode (injected by webpack DefinePlugin, typed in env.d.ts) ──

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

function getTradingCredentialsStorageKey(address: string): string {
  return `${TRADING_CREDS_STORAGE_PREFIX}${address.toLowerCase()}`;
}

function isStoredClobCredentials(
  value: unknown
): value is StoredClobCredentials {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as StoredClobCredentials).apiKey === "string" &&
    typeof (value as StoredClobCredentials).apiSecret === "string" &&
    typeof (value as StoredClobCredentials).apiPassphrase === "string"
  );
}

async function getCachedTradingCredentials(
  address: string
): Promise<StoredClobCredentials | null> {
  const key = getTradingCredentialsStorageKey(address);
  const value = await new Promise<unknown>((resolve) => {
    chrome.storage.session.get(key, (result) => {
      resolve(result[key]);
    });
  });
  return isStoredClobCredentials(value) ? value : null;
}

async function hasCachedTradingCredentials(address: string): Promise<boolean> {
  return (await getCachedTradingCredentials(address)) !== null;
}

function broadcastTradingCredentialsUpdated(address: string): void {
  chrome.runtime.sendMessage(
    { type: TRADING_CREDENTIALS_UPDATED_MESSAGE, address },
    () => {
      void chrome.runtime.lastError;
    }
  );
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

function isTradingMessage(message: unknown): boolean {
  return (
    typeof message === "object" &&
    message !== null &&
    typeof (message as { type: string }).type === "string" &&
    (message as { type: string }).type.startsWith("trading:") &&
    (message as { type: string }).type !== "trading:signing-response"
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

function forwardToOffscreen(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: BackgroundResponse) => void
): void {
  const tabId = sender.tab?.id;

  ensureOffscreen()
    .then(() => sendOffscreenMessage("offscreen:trading", message, tabId))
    .then((result) => {
      sendResponse(
        result ?? { ok: false, error: "No response from offscreen" }
      );
    })
    .catch((err) => {
      sendResponse({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    });
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
      marketId?: string;
      query?: string;
      walletUuid?: string;
      trendingLimit?: number;
      visible?: boolean;
      address?: string;
      surface?: "sidebar" | "floating";
    };

    // Relay signing responses from content script → offscreen document.
    // Content script's chrome.runtime.sendMessage only reliably reaches the
    // service worker; the offscreen doc may not receive it directly.
    if (msg?.type === "trading:signing-response" && sender.tab) {
      chrome.runtime.sendMessage(message).catch(() => {});
      return false;
    }

    if (msg?.type === "KNOWW_OPEN_EXTENSION_SETTINGS") {
      chrome.runtime.openOptionsPage();
      sendResponse({ ok: true, data: null } as BackgroundResponse);
      return true;
    }

    if (msg?.type === "KNOWW_OPEN_EXTENSION_SIDEPANEL") {
      void persistNotificationPanelSurface("sidebar");
      void openKnowwSidePanel({
        ...(typeof sender.tab?.id === "number" ? { tabId: sender.tab.id } : {}),
        ...(typeof sender.tab?.windowId === "number"
          ? { windowId: sender.tab.windowId }
          : {}),
      })
        .then(() => {
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

    if (msg?.type === "KNOWW_CONNECT_PORTFOLIO_WALLET") {
      forwardToResolvedContentTab(msg, sender, sendResponse, {
        type: "KNOWW_CONNECT_PORTFOLIO_WALLET",
        walletUuid: msg.walletUuid,
      });
      return true;
    }

    if (
      msg?.type === "KNOWW_GET_PORTFOLIO_TRADING_STATUS" &&
      typeof msg.address === "string"
    ) {
      void hasCachedTradingCredentials(msg.address)
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
      forwardToResolvedContentTab(msg, sender, sendResponse, {
        type: "KNOWW_ENABLE_PORTFOLIO_TRADING",
        address: msg.address,
      });
      return true;
    }

    if (
      msg?.type === "KNOWW_GET_PORTFOLIO_OPEN_ORDERS" &&
      typeof msg.address === "string"
    ) {
      const address = msg.address;
      void (async () => {
        const credentials = await getCachedTradingCredentials(address);
        if (!credentials) {
          sendResponse({
            ok: true,
            data: { orders: [], count: 0 },
          } as BackgroundResponse);
          return;
        }

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
    if (msg?.type === "creds:get" && typeof msg.key === "string") {
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
      const k = msg.key;
      chrome.storage.session.get(k, (result) => {
        sendResponse({
          ok: true,
          data: result[k] ?? null,
        } as BackgroundResponse);
      });
      return true;
    }
    if (msg?.type === "creds:set" && typeof msg.key === "string") {
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
      const key = msg.key;
      chrome.storage.session.set({ [key]: msg.value }, () => {
        broadcastTradingCredentialsUpdated(
          key.slice(TRADING_CREDS_STORAGE_PREFIX.length)
        );
        sendResponse({ ok: true, data: null } as BackgroundResponse);
      });
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
    if (msg?.type === "auth:get-token") {
      const senderReject = checkAuthorizedSender(sender.id, chrome.runtime.id);
      if (senderReject) {
        sendResponse(senderReject as BackgroundResponse);
        return true;
      }
      getExtensionAccessToken().then((token) => {
        sendResponse({ ok: true, data: token } as BackgroundResponse);
      });
      return true;
    }
    if (msg?.type === "KNOWW_GET_PORTFOLIO_SESSION") {
      const senderReject = checkAuthorizedSender(sender.id, chrome.runtime.id);
      if (senderReject) {
        sendResponse(senderReject as BackgroundResponse);
        return true;
      }
      getExtensionAccessToken().then((token) => {
        sendResponse({ ok: true, data: { token } } as BackgroundResponse);
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

    // Orderbook fetch — lightweight public API call, no crypto needed.
    // Handle directly in the service worker to avoid offscreen boot latency.
    if (
      msg?.type === "trading:get-orderbook" &&
      typeof msg.tokenId === "string"
    ) {
      const { tokenId } = msg;
      (async () => {
        try {
          const data = await fetchClobOrderBook(tokenId, {
            host: POLYMARKET_API.CLOB.BASE,
            // TODO: Move this back to the SDK path once unified SDK public reads
            // support extension order-book fetching reliably.
            useUnifiedSdk: false,
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

    // Pre-warm offscreen document so it's ready when the user places a trade
    if (msg?.type === "trading:prewarm-offscreen") {
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

    // Trading messages — forward to offscreen document
    if (isTradingMessage(message)) {
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
            if (authorization) {
              headers.Authorization = authorization;
            }
          }

          const options: RequestInit = {
            method: message.method || "POST",
            headers,
            signal: controller.signal,
          };
          if (bodyStr) options.body = bodyStr;

          const res = await fetch(message.url, options);
          clearTimeout(timeoutId);
          if (!isAllowedRedirect(message.url, res.url)) {
            sendResponse({
              ok: false,
              status: res.status,
              error: "Security: t.co redirect target is not allowed",
            });
            return;
          }
          if (res.status === 401 && isKnowwApiUrl(message.url)) {
            await clearExtensionAccessToken();
          }
          const text = await res.text();
          try {
            const data = JSON.parse(text);
            sendResponse({
              ok: true,
              status: res.status,
              data,
              responseUrl: res.url,
            });
          } catch {
            sendResponse({
              ok: false,
              error: `Invalid JSON response: ${text.substring(0, 100)}`,
            });
          }
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
  registerContentScripts();
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    void queueAnalyticsEvent({
      event: "extension_installed",
      properties: {
        reason: details.reason,
      },
    });
    chrome.runtime.openOptionsPage();
    return;
  }

  void queueAnalyticsEvent({
    event: "extension_updated",
    properties: {
      reason: details.reason,
      previousVersion: details.previousVersion || null,
    },
  });
});
