import { getLoadedRuntime, loadTradingRuntime } from "../trading-loader";
import type { TradingRuntime } from "../trading-runtime-types";
import { WALLETCONNECT_WALLET_UUID } from "../walletconnect-constants";

/**
 * Exhaustive dispatcher contract:
 *
 * | Message | Return | Completion |
 * | KNOWW_GET_PORTFOLIO_WALLETS | true | async sendResponse |
 * | KNOWW_GET_PORTFOLIO_CONNECTED_WALLET | true | async sendResponse |
 * | KNOWW_CONNECT_PORTFOLIO_WALLET (installed) | true | async sendResponse |
 * | KNOWW_CONNECT_PORTFOLIO_WALLET (WalletConnect) | false | sync started ack + polled state |
 * | KNOWW_SWITCH_PORTFOLIO_WALLET | true | async sendResponse |
 * | KNOWW_PORTFOLIO_REAUTH | true | async sendResponse |
 * | KNOWW_ENABLE_PORTFOLIO_TRADING | false | sync started ack; errors swallowed |
 * | KNOWW_APPROVE_PORTFOLIO_TRADING | true | async sendResponse |
 * | KNOWW_GET_PORTFOLIO_WALLETCONNECT_STATE | false | sync core/runtime state; never loads |
 * | KNOWW_CANCEL_PORTFOLIO_WALLETCONNECT | false | sync cancelled ack; never loads |
 * | trading:signing-request | false | sync ok ack + correlated runtime response |
 *
 * Bundle failures for respond-on-completion rows use
 * `{ success: false, data: { error } }`. Signing failures use the existing
 * correlated `trading:signing-response` channel. WalletConnect transition
 * failures remain owned by the core record and are observed by GET_STATE.
 */

export interface WcTransitionRecord {
  generation: number;
  status: "loading" | "error" | "cancelled";
  error: string | null;
}

interface PortfolioMessage {
  type?: string;
  id?: unknown;
  walletUuid?: string;
  [key: string]: unknown;
}

type SendResponse = (response: unknown) => void;

export interface PortfolioMessageDispatcher {
  dispatch(message: unknown, sendResponse: SendResponse): boolean;
  /** Read-only diagnostic used by focused transition tests. */
  getTransitionRecord(): WcTransitionRecord | null;
}

interface DispatcherDependencies {
  loadTradingRuntime(): Promise<TradingRuntime>;
  getLoadedRuntime(): TradingRuntime | null;
  sendRuntimeMessage(message: unknown): unknown;
}

const RESPOND_ON_COMPLETION_TYPES = new Set([
  "KNOWW_GET_PORTFOLIO_WALLETS",
  "KNOWW_GET_PORTFOLIO_CONNECTED_WALLET",
  "KNOWW_SWITCH_PORTFOLIO_WALLET",
  "KNOWW_PORTFOLIO_REAUTH",
  "KNOWW_APPROVE_PORTFOLIO_TRADING",
]);

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Trading runtime failed to load.";
}

function defaultSendRuntimeMessage(message: unknown): unknown {
  return chrome.runtime.sendMessage(message);
}

export function createPortfolioMessageDispatcher(
  dependencies: Partial<DispatcherDependencies> = {}
): PortfolioMessageDispatcher {
  const loadRuntime = dependencies.loadTradingRuntime ?? loadTradingRuntime;
  const loadedRuntime = dependencies.getLoadedRuntime ?? getLoadedRuntime;
  const sendRuntimeMessage =
    dependencies.sendRuntimeMessage ?? defaultSendRuntimeMessage;
  let generation = 0;
  let transitionRecord: WcTransitionRecord | null = null;
  let pendingCancelCleanup: Promise<void> = Promise.resolve();

  function isCurrent(
    generationToCheck: number,
    status: WcTransitionRecord["status"]
  ): boolean {
    return (
      transitionRecord?.generation === generationToCheck &&
      transitionRecord.status === status
    );
  }

  function dispatchRespondOnCompletion(
    message: PortfolioMessage,
    sendResponse: SendResponse
  ): true {
    void loadRuntime()
      .then((runtime) => {
        runtime.handlePortfolioMessage(message, sendResponse);
      })
      .catch((error: unknown) => {
        sendResponse({
          success: false,
          data: { error: errorMessage(error) },
        });
      });
    return true;
  }

  function dispatchWalletConnect(
    message: PortfolioMessage,
    sendResponse: SendResponse
  ): false {
    generation += 1;
    const connectGeneration = generation;
    const cleanupBarrier = pendingCancelCleanup;
    transitionRecord = {
      generation: connectGeneration,
      status: "loading",
      error: null,
    };
    sendResponse({ success: true, data: { status: "started" } });

    void (async () => {
      try {
        const runtime = await loadRuntime();
        await cleanupBarrier;
        if (!isCurrent(connectGeneration, "loading")) return;
        runtime.handlePortfolioMessage(message, () => {});
        if (isCurrent(connectGeneration, "loading")) {
          transitionRecord = null;
        }
      } catch (error: unknown) {
        if (!isCurrent(connectGeneration, "loading")) return;
        transitionRecord = {
          generation: connectGeneration,
          status: "error",
          error: errorMessage(error),
        };
      }
    })();
    return false;
  }

  function dispatchCancel(sendResponse: SendResponse): false {
    generation += 1;
    const cancelGeneration = generation;
    transitionRecord = {
      generation: cancelGeneration,
      status: "cancelled",
      error: null,
    };
    sendResponse({ success: true, data: { status: "cancelled" } });

    const runtime = loadedRuntime();
    if (!runtime) return false;

    let cleanup: Promise<void>;
    try {
      cleanup = runtime.cancelWalletConnect();
    } catch (error: unknown) {
      cleanup = Promise.reject(error);
    }
    const currentCleanup = Promise.resolve(cleanup).then(
      () => true,
      () => false
    );
    const composedCleanup = Promise.all([
      pendingCancelCleanup,
      currentCleanup,
    ]).then(([, currentSucceeded]) => {
      if (currentSucceeded && isCurrent(cancelGeneration, "cancelled")) {
        transitionRecord = null;
      }
    });
    pendingCancelCleanup = composedCleanup;
    return false;
  }

  function dispatchGetState(sendResponse: SendResponse): false {
    if (transitionRecord) {
      const state =
        transitionRecord.status === "loading"
          ? { status: "initializing", error: null, qrSvg: null }
          : transitionRecord.status === "error"
            ? {
                status: "error",
                error: transitionRecord.error,
                qrSvg: null,
              }
            : { status: "idle", error: null, qrSvg: null };
      sendResponse({ success: true, data: state });
      return false;
    }

    const runtime = loadedRuntime();
    sendResponse({
      success: true,
      data: runtime?.getWalletConnectStateSync() ?? {
        status: "idle",
        error: null,
        qrSvg: null,
      },
    });
    return false;
  }

  function dispatchSigning(
    message: PortfolioMessage,
    sendResponse: SendResponse
  ): false {
    sendResponse({ ok: true });
    void loadRuntime()
      .then((runtime) => {
        runtime.handleSigningRequest(message);
      })
      .catch((error: unknown) => {
        void Promise.resolve(
          sendRuntimeMessage({
            type: "trading:signing-response",
            id: message.id,
            error: errorMessage(error),
          })
        ).catch(() => {});
      });
    return false;
  }

  return {
    dispatch(message: unknown, sendResponse: SendResponse): boolean {
      const portfolioMessage = message as PortfolioMessage | null;
      const type = portfolioMessage?.type;
      if (!type) return false;

      if (type === "trading:signing-request") {
        return dispatchSigning(portfolioMessage, sendResponse);
      }

      if (type === "KNOWW_GET_PORTFOLIO_WALLETCONNECT_STATE") {
        return dispatchGetState(sendResponse);
      }

      if (type === "KNOWW_CANCEL_PORTFOLIO_WALLETCONNECT") {
        return dispatchCancel(sendResponse);
      }

      if (
        type === "KNOWW_CONNECT_PORTFOLIO_WALLET" &&
        portfolioMessage.walletUuid === WALLETCONNECT_WALLET_UUID
      ) {
        return dispatchWalletConnect(portfolioMessage, sendResponse);
      }

      if (type === "KNOWW_ENABLE_PORTFOLIO_TRADING") {
        sendResponse({ success: true, data: { status: "started" } });
        void loadRuntime()
          .then((runtime) => {
            runtime.handlePortfolioMessage(portfolioMessage, () => {});
          })
          .catch(() => {});
        return false;
      }

      if (
        type === "KNOWW_CONNECT_PORTFOLIO_WALLET" ||
        RESPOND_ON_COMPLETION_TYPES.has(type)
      ) {
        return dispatchRespondOnCompletion(portfolioMessage, sendResponse);
      }

      return false;
    },

    getTransitionRecord(): WcTransitionRecord | null {
      return transitionRecord ? { ...transitionRecord } : null;
    },
  };
}
