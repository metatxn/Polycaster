import {
  TRADING_CREDENTIALS_UPDATED_MESSAGE,
  TRADING_SESSION_DISCONNECTED_MESSAGE,
  TRADING_WALLET_CONNECTED_MESSAGE,
} from "../types/chrome-messages";
import {
  normalizePortfolioWalletMode,
  type SidePanelView,
  type TradingWalletMode,
} from "./shared";

export type RuntimeResponse = {
  ok?: boolean;
  error?: string;
  data?: unknown;
};

export const WALLET_MODE_STORAGE_KEY = "knoww_trading_wallet_mode";
export const SIDEPANEL_REQUESTED_VIEW_KEY = "knoww_sidepanel_requested_view";

type RuntimePort = Pick<typeof chrome.runtime, "lastError" | "sendMessage">;
type LocalStoragePort = Pick<typeof chrome.storage.local, "get" | "set">;
type SessionStoragePort = Pick<typeof chrome.storage.session, "get" | "remove">;

export function sendRuntimeMessage(
  message: Record<string, unknown>,
  runtime: RuntimePort = chrome.runtime
): Promise<RuntimeResponse> {
  return new Promise((resolve) => {
    runtime.sendMessage(message, (response: RuntimeResponse | undefined) => {
      if (runtime.lastError) {
        resolve({ ok: false, error: runtime.lastError.message });
        return;
      }
      resolve(response || { ok: true });
    });
  });
}

export function getFetchJsonPayload<T>(response: RuntimeResponse): T | null {
  if (response.ok === false) return null;
  const payload = response as RuntimeResponse & { status?: number; data?: T };
  if (
    typeof payload.status === "number" &&
    (payload.status < 200 || payload.status >= 300)
  ) {
    return null;
  }
  return payload.data ?? null;
}

export async function fetchKnowwJson<T>(
  path: string,
  appUrl: string,
  send: typeof sendRuntimeMessage = sendRuntimeMessage
): Promise<T | null> {
  return getFetchJsonPayload<T>(
    await send({ type: "fetch-json", url: `${appUrl}${path}`, method: "GET" })
  );
}

export function getWalletModeStorageKey(address: string): string {
  return `${WALLET_MODE_STORAGE_KEY}_${address.toLowerCase()}`;
}

export function readStoredWalletMode(
  address: string,
  storage: LocalStoragePort = chrome.storage.local,
  runtime: Pick<typeof chrome.runtime, "lastError"> = chrome.runtime
): Promise<TradingWalletMode> {
  return new Promise((resolve) => {
    storage.get(getWalletModeStorageKey(address), (result) => {
      if (runtime.lastError) {
        resolve("deposit");
        return;
      }
      resolve(
        normalizePortfolioWalletMode(result[getWalletModeStorageKey(address)])
      );
    });
  });
}

export function writeStoredWalletMode(
  address: string,
  walletMode: TradingWalletMode,
  storage: LocalStoragePort = chrome.storage.local
): Promise<void> {
  return new Promise((resolve) => {
    storage.set(
      {
        [getWalletModeStorageKey(address)]:
          normalizePortfolioWalletMode(walletMode),
      },
      () => resolve()
    );
  });
}

export function consumeRequestedSidePanelView(
  storage: SessionStoragePort = chrome.storage.session
): Promise<SidePanelView | null> {
  return new Promise((resolve) => {
    storage.get(SIDEPANEL_REQUESTED_VIEW_KEY, (result) => {
      const value = result[SIDEPANEL_REQUESTED_VIEW_KEY];
      storage.remove(SIDEPANEL_REQUESTED_VIEW_KEY, () => {
        void chrome.runtime.lastError;
      });
      resolve(value === "markets" || value === "portfolio" ? value : null);
    });
  });
}

export interface SidepanelMessageHandlers {
  onSessionDisconnected(): void;
  onWalletConnected(): void;
  onShowView(view: SidePanelView): void;
  onCredentialsUpdated(): void;
}

interface MessageRuntimePort {
  lastError?: { message?: string };
  onMessage: {
    addListener(
      callback: (message: { type?: unknown; view?: unknown }) => boolean
    ): void;
    removeListener(
      callback: (message: { type?: unknown; view?: unknown }) => boolean
    ): void;
  };
}

interface MessageSessionStoragePort {
  remove(key: string, callback: () => void): void;
}

export function installSidepanelMessageListener(
  handlers: SidepanelMessageHandlers,
  ports: {
    runtime?: MessageRuntimePort;
    sessionStorage?: MessageSessionStoragePort;
  } = {}
): () => void {
  const runtime = ports.runtime ?? chrome.runtime;
  const sessionStorage = ports.sessionStorage ?? chrome.storage.session;
  const listener = (message: { type?: unknown; view?: unknown }): boolean => {
    if (message?.type === TRADING_SESSION_DISCONNECTED_MESSAGE) {
      handlers.onSessionDisconnected();
      return false;
    }
    if (message?.type === TRADING_WALLET_CONNECTED_MESSAGE) {
      handlers.onWalletConnected();
      return false;
    }
    if (message?.type === "KNOWW_SHOW_EXTENSION_SIDEPANEL_VIEW") {
      sessionStorage.remove(SIDEPANEL_REQUESTED_VIEW_KEY, () => {
        void runtime.lastError;
      });
      if (message.view === "markets" || message.view === "portfolio") {
        handlers.onShowView(message.view);
      }
      return false;
    }
    if (message?.type === TRADING_CREDENTIALS_UPDATED_MESSAGE) {
      handlers.onCredentialsUpdated();
      return false;
    }
    return false;
  };
  runtime.onMessage.addListener(listener);
  return () => runtime.onMessage.removeListener(listener);
}
