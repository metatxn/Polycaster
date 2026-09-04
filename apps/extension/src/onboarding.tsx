import * as React from "react";
import { createRoot } from "react-dom/client";
import { getAddress } from "viem";
import {
  ONBOARDING_DEMO_URL,
  ONBOARDING_METAMASK_INSTALL_URL,
  ONBOARDING_STORAGE_KEY,
  ONBOARDING_VERSION,
  type OnboardingProgress,
  type OnboardingStage,
  parseOnboardingProgress,
  resolveOnboardingStage,
} from "./onboarding-state";

const REFRESH_INTERVAL_MS = 2500;

interface RuntimeResponse<T = unknown> {
  ok?: boolean;
  data?: T;
  error?: string;
}

interface OnboardingStatus {
  loggedIn: boolean;
  address: string | null;
  hasCredentials: boolean;
  tradingReady: boolean;
  storeBuild: boolean;
}

interface OnboardingSnapshot {
  stage: OnboardingStage;
  address: string | null;
  hasCredentials: boolean;
}

type ActionState = "idle" | "opening" | "error";

const STAGE_INDEX: Record<OnboardingStage, number> = {
  welcome: 0,
  wallet: 1,
  trading: 2,
  ready: 3,
};

const PROGRESS_STEPS = __STORE_BUILD__
  ? [
      { label: "Welcome", detail: "Knoww is installed" },
      { label: "Wallet", detail: "Your Knoww login" },
      { label: "Portfolio", detail: "Read-only positions" },
      { label: "Try Knoww", detail: "See a market on X" },
    ]
  : [
      { label: "Welcome", detail: "Knoww is installed" },
      { label: "Wallet", detail: "Your Knoww login" },
      { label: "Trading setup", detail: "Account, API keys, approval" },
      { label: "Try Knoww", detail: "See a market on X" },
    ];

function hasExtensionRuntime(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
}

function sendRuntimeMessage<T>(message: object): Promise<RuntimeResponse<T>> {
  if (!hasExtensionRuntime()) {
    return Promise.resolve({ ok: false, error: "Preview mode" });
  }

  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: RuntimeResponse<T>) => {
      const error = chrome.runtime.lastError?.message;
      resolve(error ? { ok: false, error } : (response ?? { ok: false }));
    });
  });
}

function readProgress(): Promise<OnboardingProgress> {
  if (!hasExtensionRuntime()) return Promise.resolve({});

  return new Promise((resolve) => {
    chrome.storage.local.get(ONBOARDING_STORAGE_KEY, (result) => {
      resolve(parseOnboardingProgress(result[ONBOARDING_STORAGE_KEY]));
    });
  });
}

function writeProgress(progress: OnboardingProgress): Promise<void> {
  if (!hasExtensionRuntime()) return Promise.resolve();

  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [ONBOARDING_STORAGE_KEY]: progress }, () => {
      const error = chrome.runtime.lastError?.message;
      if (error) {
        reject(new Error(error));
        return;
      }
      resolve();
    });
  });
}

async function trackEvent(
  event: string,
  properties: Record<string, string | number | boolean | null> = {}
): Promise<void> {
  await sendRuntimeMessage({
    type: "analytics:track",
    event,
    properties: {
      onboarding_version: ONBOARDING_VERSION,
      surface: "extension_onboarding",
      build_flavor: __STORE_BUILD__ ? "store" : "full",
      ...properties,
    },
  });
}

function toAnalyticsAddress(address: string | null): string | undefined {
  if (!address) return undefined;
  try {
    return getAddress(address);
  } catch {
    return undefined;
  }
}

function formatAddress(address: string): string {
  return address.length > 13
    ? `${address.slice(0, 7)}…${address.slice(-5)}`
    : address;
}

function getPreviewSnapshot(): OnboardingSnapshot {
  const preview = new URLSearchParams(window.location.search).get("preview");
  const stage: OnboardingStage =
    preview === "wallet" || preview === "trading" || preview === "ready"
      ? preview
      : "welcome";
  return {
    stage,
    address:
      stage === "trading" || stage === "ready"
        ? "0x71C7656EC7ab88b098defB751B7401B5f6d8976F"
        : null,
    hasCredentials: stage === "ready",
  };
}

function ProgressRail({ stage }: { stage: OnboardingStage }) {
  const activeIndex = STAGE_INDEX[stage];

  return (
    <ol className="progress-rail" aria-label="Setup progress">
      {PROGRESS_STEPS.map((step, index) => {
        const status =
          index < activeIndex
            ? "complete"
            : index === activeIndex
              ? "active"
              : "upcoming";
        return (
          <li
            className={`progress-step progress-step--${status}`}
            key={step.label}
          >
            <span className="progress-marker" aria-hidden="true">
              {status === "complete" ? "✓" : index + 1}
            </span>
            <span>
              <strong>{step.label}</strong>
              <small>{step.detail}</small>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function SetupChecklist({ complete }: { complete: boolean }) {
  return (
    <ul className="setup-checklist" aria-label="Trading setup checklist">
      {["Trading account", "API keys", "Token approval"].map((item) => (
        <li key={item}>
          <span className={complete ? "check check--complete" : "check"}>
            {complete ? "✓" : "·"}
          </span>
          {item}
        </li>
      ))}
    </ul>
  );
}

function OnboardingApp() {
  const [snapshot, setSnapshot] = React.useState<OnboardingSnapshot>(() =>
    hasExtensionRuntime()
      ? { stage: "welcome", address: null, hasCredentials: false }
      : getPreviewSnapshot()
  );
  const [loading, setLoading] = React.useState(hasExtensionRuntime());
  const [actionState, setActionState] = React.useState<ActionState>("idle");
  const [notice, setNotice] = React.useState("");
  const progressRef = React.useRef<OnboardingProgress>({});
  const refreshInFlightRef = React.useRef(false);

  const persistProgress = React.useCallback(
    async (patch: Partial<OnboardingProgress>) => {
      const nextProgress = { ...progressRef.current, ...patch };
      progressRef.current = nextProgress;
      await writeProgress(nextProgress);
      return nextProgress;
    },
    []
  );

  const refreshStatus = React.useCallback(async () => {
    if (!hasExtensionRuntime() || refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;

    try {
      const statusResponse = await sendRuntimeMessage<OnboardingStatus>({
        type: "KNOWW_GET_EXTENSION_ONBOARDING_STATUS",
      });
      const status = statusResponse.data;
      const address = toAnalyticsAddress(status?.address ?? null) ?? null;
      const loggedIn =
        statusResponse.ok === true &&
        status?.loggedIn === true &&
        address !== null;
      const hasCredentials = status?.hasCredentials === true;
      const tradingReady = status?.tradingReady === true;

      const walletCheckResult = loggedIn ? "connected" : "not_connected";
      if (progressRef.current.walletCheckResult !== walletCheckResult) {
        await persistProgress({ walletCheckResult });
        await trackEvent("wallet_provider_check_completed", {
          result: walletCheckResult,
          check_scope: "knoww_wallet_session",
          ...(address ? { wallet_address: address } : {}),
        });
      }

      const stage = resolveOnboardingStage({
        welcomeCompleted: Boolean(progressRef.current.welcomeCompletedAt),
        loggedIn,
        hasCredentials: tradingReady,
        storeBuild: __STORE_BUILD__,
      });

      if (stage === "trading" && !progressRef.current.tradingStartedAt) {
        await persistProgress({ tradingStartedAt: new Date().toISOString() });
        await trackEvent("trading_onboarding_started", {
          ...(address ? { wallet_address: address } : {}),
        });
      }

      if (stage === "ready" && !progressRef.current.completedAt) {
        await persistProgress({ completedAt: new Date().toISOString() });
        if (!__STORE_BUILD__) {
          await trackEvent("trading_onboarding_completed", {
            ...(address ? { wallet_address: address } : {}),
          });
        }
        await trackEvent("extension_install_onboarding_completed", {
          capability: __STORE_BUILD__ ? "market_discovery" : "trading",
          ...(address ? { wallet_address: address } : {}),
        });
      }

      setSnapshot({ stage, address, hasCredentials });
      setActionState("idle");
      setLoading(false);
    } catch {
      setActionState("error");
      setNotice("We couldn't check your setup. Try again.");
      setLoading(false);
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [persistProgress]);

  React.useEffect(() => {
    if (!hasExtensionRuntime()) return;
    let active = true;

    void (async () => {
      const storedProgress = await readProgress();
      if (!active) return;
      progressRef.current = storedProgress;
      if (!storedProgress.startedAt) {
        await persistProgress({ startedAt: new Date().toISOString() });
        await trackEvent("extension_onboarding_started");
      }
      if (active) await refreshStatus();
    })();

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshStatus();
    }, REFRESH_INTERVAL_MS);
    const handleFocus = () => void refreshStatus();
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }, [persistProgress, refreshStatus]);

  const startSetup = async () => {
    if (!hasExtensionRuntime()) {
      setSnapshot((current) => ({
        ...current,
        stage: current.stage === "welcome" ? "wallet" : "trading",
      }));
      return;
    }

    setActionState("opening");
    setNotice("Opening Knoww beside X…");
    try {
      if (!progressRef.current.welcomeCompletedAt) {
        await persistProgress({
          welcomeCompletedAt: new Date().toISOString(),
        });
      }
      const response = await sendRuntimeMessage({
        type: "KNOWW_START_ONBOARDING_SETUP",
      });
      if (response.ok !== true) {
        throw new Error(response.error || "Setup could not be opened");
      }
      setNotice(
        __STORE_BUILD__
          ? "Connect your wallet in the Knoww panel."
          : "Continue through account, API-key, and approval setup in the Knoww panel."
      );
      await refreshStatus();
    } catch {
      setActionState("error");
      setNotice("Knoww couldn't open the setup panel. Try again.");
    }
  };

  const installMetaMask = async () => {
    try {
      const clickedAt = new Date().toISOString();
      await persistProgress({ walletInstallClickedAt: clickedAt });
      await trackEvent("wallet_install_clicked", { provider: "metamask" });
      if (hasExtensionRuntime()) {
        await chrome.tabs.create({ url: ONBOARDING_METAMASK_INSTALL_URL });
      } else {
        window.open(
          ONBOARDING_METAMASK_INSTALL_URL,
          "_blank",
          "noopener,noreferrer"
        );
      }
      setNotice("After installing MetaMask, return here and continue setup.");
    } catch {
      setActionState("error");
      setNotice("Knoww couldn't open the MetaMask install page. Try again.");
    }
  };

  const openDemo = async () => {
    if (hasExtensionRuntime()) {
      const response = await sendRuntimeMessage({
        type: "KNOWW_OPEN_ONBOARDING_DEMO",
      });
      if (response.ok !== true) {
        setActionState("error");
        setNotice("Knoww couldn't open X. Try again.");
      }
      return;
    }
    window.open(ONBOARDING_DEMO_URL, "_blank", "noopener,noreferrer");
  };

  const openSettings = () => {
    if (hasExtensionRuntime()) void chrome.runtime.openOptionsPage();
  };

  const content = {
    welcome: {
      eyebrow: "Installed",
      title: "Bring live markets into what you read.",
      body: "Connect your wallet to activate Knoww. Then we'll guide you through the remaining setup and show your first injected Polymarket market on X.",
    },
    wallet: {
      eyebrow: "Wallet check",
      title: "Connect your wallet to Knoww.",
      body: "Your wallet is your Knoww login. Continue with MetaMask, another supported EOA wallet, or WalletConnect.",
    },
    trading: {
      eyebrow: "Wallet connected",
      title: "Finish your trading setup.",
      body: "The Knoww panel will create your Polymarket trading account, prepare API keys, and request token approval. Follow each prompt in your wallet.",
    },
    ready: {
      eyebrow: "Setup complete",
      title: __STORE_BUILD__ ? "Knoww is ready." : "You're ready to trade.",
      body: __STORE_BUILD__
        ? "Browse normally and Knoww will surface relevant markets when available. Your Chrome Web Store build includes market discovery and a read-only portfolio."
        : "Your wallet and Polymarket trading setup are ready. Open the demo page and Knoww will point out an injected market.",
    },
  }[snapshot.stage];

  return (
    <main className="onboarding-shell">
      <header className="brand-bar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span>Knoww</span>
        </div>
        <span className="build-label">
          {__STORE_BUILD__ ? "Market discovery" : "Trading extension"}
        </span>
      </header>

      <div className="onboarding-layout">
        <aside className="progress-panel">
          <p className="progress-kicker">From installed to useful</p>
          <h2>Four short steps. No guessing.</h2>
          <ProgressRail stage={snapshot.stage} />
          <p className="privacy-note">
            Knoww uses your public wallet address to identify your account and
            tailor your experience. It never receives your private key.
          </p>
        </aside>

        <section className="stage-panel" aria-busy={loading}>
          <div className="stage-count">
            Step {Math.min(STAGE_INDEX[snapshot.stage] + 1, 4)} of 4
          </div>
          {loading ? (
            <div className="loading-state" role="status">
              <span className="loading-dot" /> Checking your setup…
            </div>
          ) : (
            <>
              <p className="eyebrow">{content.eyebrow}</p>
              <h1>{content.title}</h1>
              <p className="stage-copy">{content.body}</p>

              {snapshot.address && (
                <div className="wallet-chip">
                  <span className="wallet-status-dot" />
                  <span>Connected</span>
                  <code>{formatAddress(snapshot.address)}</code>
                </div>
              )}

              {snapshot.stage === "trading" && (
                <SetupChecklist complete={false} />
              )}
              {snapshot.stage === "ready" && !__STORE_BUILD__ && (
                <SetupChecklist complete={snapshot.hasCredentials} />
              )}

              <div className="actions">
                {snapshot.stage === "ready" ? (
                  <button
                    className="primary-action"
                    type="button"
                    onClick={openDemo}
                  >
                    See Knoww on X <span aria-hidden="true">↗</span>
                  </button>
                ) : (
                  <button
                    className="primary-action"
                    type="button"
                    onClick={startSetup}
                    disabled={actionState === "opening"}
                  >
                    {snapshot.stage === "welcome"
                      ? "Connect wallet"
                      : snapshot.stage === "wallet"
                        ? "Continue with a wallet"
                        : "Finish trading setup"}
                    <span aria-hidden="true">→</span>
                  </button>
                )}

                {snapshot.stage === "wallet" && (
                  <button
                    className="secondary-action"
                    type="button"
                    onClick={installMetaMask}
                  >
                    Install MetaMask <span aria-hidden="true">↗</span>
                  </button>
                )}

                {snapshot.stage === "ready" && (
                  <button
                    className="text-action"
                    type="button"
                    onClick={openSettings}
                  >
                    Extension settings
                  </button>
                )}
              </div>

              {snapshot.stage === "wallet" && (
                <p className="support-note">
                  Already have a wallet? Continue and select it in the Knoww
                  panel. If not, install MetaMask, then return here.
                </p>
              )}
              {notice && (
                <p
                  className={`action-notice${actionState === "error" ? " action-notice--error" : ""}`}
                  aria-live="polite"
                >
                  {notice}
                </p>
              )}
            </>
          )}
        </section>
      </div>

      <footer>
        <span>
          Knoww only asks your wallet to sign when the action requires it.
        </span>
        <a href="https://knoww.app/privacy">Privacy</a>
      </footer>
    </main>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("Onboarding root element was not found.");
createRoot(container).render(<OnboardingApp />);
