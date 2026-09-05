/**
 * Wallet-only runtime — the store-build replacement for trading-entry.ts.
 *
 * Ships wallet discovery (EIP-6963 via the page bridge), WalletConnect
 * pairing, and knoww.app session auth (personal_sign only) so the portfolio
 * sidepanel works without any trading capability. Order construction,
 * credential derivation, approvals, and deposits stay out of this chunk;
 * the trading surfaces that would call them are store-gated at their call
 * sites, so those runtime methods are inert no-ops here.
 */

import { createLogger } from "@knoww/logger";
import { sameAddress } from "@knoww/shared-types/bridge";
import { POLYGON_CHAIN_ID_HEX } from "@knoww/shared-types/polymarket";

import type {
  StreamBetHandle,
  TradingRuntime,
  WalletConnectRuntimeState,
} from "../trading-runtime-types";
import { WALLETCONNECT_WALLET_UUID } from "../walletconnect-constants";
import { WalletBridge } from "./bridge";
import { ExtensionSession } from "./extension-session";
import { renderWalletConnectQrSvg } from "./walletconnect-qr";

export type { TradingRuntime } from "../trading-runtime-types";

const log = createLogger("wallet-runtime");

const TRADING_UNAVAILABLE_ERROR =
  "Trading is not available in this version of the extension.";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = error as {
      message?: unknown;
      shortMessage?: unknown;
      code?: unknown;
    };
    const message =
      typeof candidate.message === "string"
        ? candidate.message
        : typeof candidate.shortMessage === "string"
          ? candidate.shortMessage
          : "";
    const code =
      typeof candidate.code === "string" || typeof candidate.code === "number"
        ? String(candidate.code)
        : "";
    return [message, code].filter(Boolean).join(" ");
  }
  return "";
}

function formatWalletPromptError(error: unknown): string {
  const message = getErrorMessage(error);
  if (
    /user rejected|request rejected|rejected the request|denied|4001/i.test(
      message
    )
  ) {
    return "Wallet prompt rejected.";
  }
  return message || "Wallet request failed.";
}

function sendAuthLogout(): Promise<void> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "auth:logout" }, () => {
        void chrome.runtime.lastError;
        resolve();
      });
    } catch {
      resolve();
    }
  });
}

interface WalletUiMessage {
  type?: string;
  address?: string;
  walletUuid?: string;
}

let activeRuntime: TradingRuntime | null = null;

function trackWallet(event: string, address: string): void {
  try {
    void Promise.resolve(
      window.KNOWW_ANALYTICS?.track(event, {
        wallet_address: address,
        build_flavor: "store",
        capability: "market_discovery",
      })
    ).catch(() => {});
  } catch {
    /* Analytics cannot interrupt connection or authentication. */
  }
}

export function createTradingRuntime(): TradingRuntime {
  if (activeRuntime) return activeRuntime;

  const disposeBridge = WalletBridge.init();
  let cachedAddress: string | null = null;
  let disposed = false;

  async function ensurePolygonChain(): Promise<void> {
    try {
      const chainId = await WalletBridge.getChainId();
      if (chainId !== POLYGON_CHAIN_ID_HEX) {
        await WalletBridge.switchChain(POLYGON_CHAIN_ID_HEX);
      }
    } catch (err) {
      log.warn("chain.switch_failed", { error: err });
    }
  }

  async function connectAndAuthorize(walletUuid?: string): Promise<string> {
    const accounts = await WalletBridge.connect(walletUuid);
    const address = accounts?.[0];
    if (!address) {
      throw new Error("Wallet connection was cancelled.");
    }
    cachedAddress = address;
    trackWallet("wallet_connected", address);
    await ensurePolygonChain();
    await ExtensionSession.ensureAuthorized(address);
    return address;
  }

  async function switchAndAuthorize(): Promise<string> {
    const previousAddress = cachedAddress;
    const accounts = await WalletBridge.switchWallet();
    const address = accounts?.[0];
    if (!address) {
      throw new Error("Wallet switch was cancelled.");
    }
    if (previousAddress && !sameAddress(previousAddress, address)) {
      await sendAuthLogout();
    }
    cachedAddress = address;
    trackWallet("wallet_switched", address);
    await ensurePolygonChain();
    await ExtensionSession.ensureAuthorized(address);
    return address;
  }

  async function getConnectedWalletAddress(): Promise<string | null> {
    const address = cachedAddress;
    if (!address) return null;
    const accounts = await WalletBridge.getSelectedAccounts();
    // An empty list means the wallet is locked or the provider dropped its
    // connection, not that the user removed the account — keep the session.
    // A genuine account switch/removal arrives as a non-empty list that
    // excludes the cached address.
    if (
      accounts.length > 0 &&
      !accounts.some((account) => sameAddress(account, address))
    ) {
      cachedAddress = null;
      WalletBridge.resetAfterDisconnect();
      await sendAuthLogout();
      return null;
    }
    return cachedAddress;
  }

  function getWalletConnectStateSync(): WalletConnectRuntimeState {
    const wcState = WalletBridge.getMobileConnectionState();
    let qrSvg: string | null = null;
    if (wcState.qrUri) {
      try {
        qrSvg = renderWalletConnectQrSvg(wcState.qrUri);
      } catch {
        qrSvg = null;
      }
    }
    return { status: wcState.status, error: wcState.error, qrSvg };
  }

  function cancelWalletConnect(): Promise<void> {
    return WalletBridge.cancelMobileConnect();
  }

  function handleWalletMessage(
    message: WalletUiMessage,
    sendResponse: (response: { success: boolean; data?: unknown }) => void
  ): boolean {
    if (message?.type === "KNOWW_GET_PORTFOLIO_WALLETS") {
      const waitForWallets = new Promise<void>((resolve) => {
        const existing = WalletBridge.getDiscoveredWallets();
        if (existing.length > 0) {
          resolve();
          return;
        }
        let unsubscribe = (): void => {};
        const finish = () => {
          unsubscribe();
          resolve();
        };
        const timeoutId = setTimeout(finish, 700);
        unsubscribe = WalletBridge.onWalletsChanged(() => {
          clearTimeout(timeoutId);
          finish();
        });
      });

      void waitForWallets.then(() => {
        sendResponse({
          success: true,
          data: { wallets: WalletBridge.getDiscoveredWallets() },
        });
      });
      return true;
    }

    if (message?.type === "KNOWW_GET_PORTFOLIO_CONNECTED_WALLET") {
      void (async () => {
        const hadCachedAddress = Boolean(cachedAddress);
        const address = await getConnectedWalletAddress();
        sendResponse({
          success: true,
          data: {
            address,
            status: address
              ? "connected"
              : hadCachedAddress
                ? "disconnected"
                : "unavailable",
          },
        });
      })();
      return true;
    }

    if (message?.type === "KNOWW_CONNECT_PORTFOLIO_WALLET") {
      if (message.walletUuid === WALLETCONNECT_WALLET_UUID) {
        sendResponse({ success: true, data: { status: "started" } });
        void (async () => {
          try {
            await connectAndAuthorize(message.walletUuid);
          } catch {
            // WalletConnect pairing errors are exposed through the polled
            // bridge state; installed-wallet failures are returned below.
          }
        })();
        return false;
      }

      void (async () => {
        try {
          const address = await connectAndAuthorize(message.walletUuid);
          sendResponse({ success: true, data: { address } });
        } catch (err) {
          sendResponse({
            success: false,
            data: { error: formatWalletPromptError(err) },
          });
        }
      })();
      return true;
    }

    if (message?.type === "KNOWW_SWITCH_PORTFOLIO_WALLET") {
      void (async () => {
        try {
          const address = await switchAndAuthorize();
          sendResponse({ success: true, data: { address } });
        } catch (err) {
          sendResponse({
            success: false,
            data: { error: formatWalletPromptError(err) },
          });
        }
      })();
      return true;
    }

    if (message?.type === "KNOWW_PORTFOLIO_REAUTH") {
      void (async () => {
        try {
          let address = cachedAddress;
          if (!address) {
            const accounts = await WalletBridge.connect();
            address = accounts?.[0] ?? null;
            if (address) {
              cachedAddress = address;
              trackWallet("wallet_connected", address);
              await ensurePolygonChain();
            }
          }
          if (!address) {
            throw new Error("Connect your wallet to continue.");
          }
          // Drop any stale token so ensureAuthorized always re-signs a fresh
          // challenge instead of short-circuiting on a present-but-dead token.
          await ExtensionSession.clear();
          await ExtensionSession.ensureAuthorized(address);
          sendResponse({ success: true, data: { address } });
        } catch (err) {
          sendResponse({
            success: false,
            data: {
              error:
                err instanceof Error ? err.message : "Re-authorization failed",
            },
          });
        }
      })();
      return true;
    }

    if (message?.type === "KNOWW_CANCEL_PORTFOLIO_WALLETCONNECT") {
      void cancelWalletConnect().catch(() => {});
      sendResponse({ success: true, data: { status: "cancelled" } });
      return false;
    }

    if (message?.type === "KNOWW_GET_PORTFOLIO_WALLETCONNECT_STATE") {
      sendResponse({ success: true, data: getWalletConnectStateSync() });
      return false;
    }

    if (message?.type === "KNOWW_ENABLE_PORTFOLIO_TRADING") {
      // The dispatcher already sent the sync "started" ack; there is no
      // credential derivation in this build, so nothing runs.
      return false;
    }

    if (message?.type === "KNOWW_APPROVE_PORTFOLIO_TRADING") {
      sendResponse({
        success: false,
        data: { error: TRADING_UNAVAILABLE_ERROR },
      });
      return true;
    }

    return false;
  }

  const runtime: TradingRuntime = {
    openTradingPanel(): void {},

    hideTradingPanel(): void {},

    hydrateStreamBet(): StreamBetHandle {
      return { dispose(): void {} };
    },

    handlePortfolioMessage(message, sendResponse): boolean {
      return handleWalletMessage(
        message as WalletUiMessage,
        sendResponse as (response: { success: boolean; data?: unknown }) => void
      );
    },

    handleSigningRequest(): boolean {
      return false;
    },

    getWalletConnectStateSync,
    cancelWalletConnect,

    cancelWalletConnectSync(): void {
      void cancelWalletConnect().catch(() => {});
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      cachedAddress = null;
      disposeBridge();
      if (activeRuntime === runtime) activeRuntime = null;
    },
  };

  activeRuntime = runtime;
  return runtime;
}
