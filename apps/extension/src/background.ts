// ============================================
// BACKGROUND SERVICE WORKER
// Thin message router — delegates trading to offscreen document,
// handles fetch proxying and HMAC signing directly.
// ============================================

import { computeHmacHex } from "@knoww/shared-types/crypto";
import type {
  BackgroundResponse,
  FetchJsonMessage,
  FetchTextMessage,
} from "./types/chrome-messages";

// ── Build mode (injected by webpack DefinePlugin) ──
declare const __DEV_MODE__: boolean;

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
  ...(__DEV_MODE__ ? ["localhost"] : []),
] as const;

// ── HMAC Request Signing ──
declare const __KNOWW_EXTENSION_SECRET__: string;
const KNOWW_API_SECRET: string = __KNOWW_EXTENSION_SECRET__;

function isKnowwAiEndpoint(url: string): boolean {
  try {
    const parsed = new URL(url);
    const isKnowwHost =
      parsed.hostname === "knoww.app" ||
      (__DEV_MODE__ && parsed.hostname === "localhost");
    return isKnowwHost && parsed.pathname.startsWith("/api/ai/");
  } catch {
    return false;
  }
}

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

function isFetchJsonMessage(message: unknown): message is FetchJsonMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as FetchJsonMessage).type === "fetch-json" &&
    typeof (message as FetchJsonMessage).url === "string"
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

  offscreenCreating = chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["WORKERS" as chrome.offscreen.Reason],
    justification: "Trading operations require ethers.js and ClobClient",
  });

  await offscreenCreating;
  offscreenCreating = null;
}

function forwardToOffscreen(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: BackgroundResponse) => void
): void {
  const tabId = sender.tab?.id;

  ensureOffscreen()
    .then(() =>
      chrome.runtime.sendMessage({
        type: "offscreen:trading",
        payload: message,
        tabId,
      })
    )
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
      method?: string;
      params?: unknown[];
      result?: unknown;
      error?: string;
      key?: string;
      value?: unknown;
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

          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...message.headers,
          };

          if (isKnowwAiEndpoint(message.url) && KNOWW_API_SECRET) {
            const timestamp = Date.now().toString();
            const hmac = await computeHmacHex(
              KNOWW_API_SECRET,
              `${timestamp}:${bodyStr}`
            );
            headers["X-Knoww-Signature"] = hmac;
            headers["X-Knoww-Timestamp"] = timestamp;
          }

          const options: RequestInit = {
            method: message.method || "POST",
            headers,
            signal: controller.signal,
          };
          if (bodyStr) options.body = bodyStr;

          const res = await fetch(message.url, options);
          clearTimeout(timeoutId);
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
