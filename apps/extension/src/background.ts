// ============================================
// BACKGROUND SERVICE WORKER
// Thin message router — delegates trading to offscreen document,
// handles fetch proxying, and attaches extension auth headers.
// ============================================

import { logWarn } from "@knoww/logger";
import { POLYMARKET_API } from "@knoww/shared-types/polymarket";
import {
  flushAnalyticsQueue,
  queueAnalyticsEvent,
} from "./background/analytics";
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
  FetchJsonMessage,
  FetchTextMessage,
  ScoreMarketsMessage,
  ScoreMarketsSuccessResponse,
  ScoringPrewarmMessage,
} from "./types/chrome-messages";
import { TRADING_SESSION_DISCONNECTED_MESSAGE } from "./types/chrome-messages";

// ── Programmatic content script registration ──
// Instead of declaring content_scripts in manifest.json (which would
// require <all_urls> and load on every site), we register them only
// for supported platforms via chrome.scripting.
const CONTENT_SCRIPT_ID = "knoww-content";
const TRADING_CREDS_STORAGE_PREFIX = "knoww_clob_creds_";

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
  "clob.polymarket.com",
  "data-api.polymarket.com",
  "polygon-bor-rpc.publicnode.com",
  "relayer-v2.polymarket.com",
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
}

function isFetchJsonMessage(message: unknown): message is FetchJsonMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as FetchJsonMessage).type === "fetch-json" &&
    typeof (message as FetchJsonMessage).url === "string"
  );
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
    justification: "Trading operations require ethers.js and ClobClient",
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
    };

    // Relay signing responses from content script → offscreen document.
    // Content script's chrome.runtime.sendMessage only reliably reaches the
    // service worker; the offscreen doc may not receive it directly.
    if (msg?.type === "trading:signing-response" && sender.tab) {
      chrome.runtime.sendMessage(message).catch(() => {});
      return false;
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

    // Credential storage — keep creds in session storage behind the SW boundary
    if (msg?.type === "creds:get" && typeof msg.key === "string") {
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
      chrome.storage.session.set({ [msg.key]: msg.value }, () => {
        sendResponse({ ok: true, data: null } as BackgroundResponse);
      });
      return true;
    }
    if (msg?.type === "creds:remove" && typeof msg.key === "string") {
      chrome.storage.session.remove(msg.key, () => {
        sendResponse({ ok: true, data: null } as BackgroundResponse);
      });
      return true;
    }
    if (msg?.type === "auth:get-token") {
      getExtensionAccessToken().then((token) => {
        sendResponse({ ok: true, data: token } as BackgroundResponse);
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
      (async () => {
        try {
          const res = await fetch(
            `${POLYMARKET_API.CLOB.BASE}/book?token_id=${msg.tokenId}`
          );
          if (!res.ok) {
            sendResponse({
              ok: false,
              error: `Failed to fetch order book: ${res.statusText}`,
            } as BackgroundResponse);
            return;
          }
          const data = await res.json();
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
          const text = await res.text();
          sendResponse({ ok: true, status: res.status, text });
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
          if (res.status === 401 && isKnowwApiUrl(message.url)) {
            await clearExtensionAccessToken();
          }
          const text = await res.text();
          try {
            const data = JSON.parse(text);
            sendResponse({ ok: true, status: res.status, data });
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

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
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
