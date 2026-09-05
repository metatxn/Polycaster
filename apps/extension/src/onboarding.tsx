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
  tradingWalletDeployed: boolean;
  hasCredentials: boolean;
  hasApproval: boolean;
  tradingReady: boolean;
}

interface OnboardingSnapshot {
  stage: OnboardingStage;
  address: string | null;
  tradingWalletDeployed: boolean;
  hasCredentials: boolean;
  hasApproval: boolean;
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
    tradingWalletDeployed: stage === "trading" || stage === "ready",
    hasCredentials: stage === "ready",
    hasApproval: stage === "ready",
  };
}

function StepIcon({ index }: { index: number }) {
  if (index === 0) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m4 12 5 5L20 6" />
      </svg>
    );
  }
  if (index === 1) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="2.5" y="6" width="19" height="13" rx="2" />
        <path d="M2.5 10h19M17 14.5h1.5" />
      </svg>
    );
  }
  if (index === 2) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="8" cy="8" r="4.5" />
        <path d="m11.5 11.5 8.5 8.5M16 19l2-2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="2.5" />
      <circle cx="12" cy="12" r="7" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
    </svg>
  );
}

function ProgressRail({ stage }: { stage: OnboardingStage }) {
  const activeIndex = STAGE_INDEX[stage];
  const progressLabel =
    activeIndex === 0 ? "0 of 4 complete" : `${activeIndex} of 4 complete`;

  return (
    <>
      <div className="progress-summary">
        <span>Progress</span>
        <span>{progressLabel}</span>
      </div>
      <div className="progress-track" aria-hidden="true">
        <span className={`progress-fill progress-fill--${activeIndex}`} />
      </div>
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
              aria-current={status === "active" ? "step" : undefined}
            >
              <span className="progress-marker">
                <StepIcon index={index} />
              </span>
              <span className="progress-copy">
                <strong>
                  <span className="progress-index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {step.label}
                </strong>
                <small>{step.detail}</small>
              </span>
              <span className="progress-check" aria-hidden="true">
                ✓
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}

function FeatureIcon({ kind }: { kind: "radar" | "trade" | "portfolio" }) {
  if (kind === "radar") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="4" />
        <path d="m12 12 6-4" />
      </svg>
    );
  }
  if (kind === "trade") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M13 3 5 14h6l-1 7 8-11h-6l1-7Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 19h18M6 19V9M11 19V5M16 19v-7" />
    </svg>
  );
}

function FeatureList() {
  const features = __STORE_BUILD__
    ? [
        {
          kind: "radar" as const,
          label: "Radar",
          detail:
            "Live markets matched to the post or article in front of you.",
        },
        {
          kind: "portfolio" as const,
          label: "Portfolio",
          detail: "Read-only positions and P&L in the same panel.",
        },
      ]
    : [
        {
          kind: "radar" as const,
          label: "Radar",
          detail:
            "Live markets matched to the post, article, or box score in front of you.",
        },
        {
          kind: "trade" as const,
          label: "One-click trade",
          detail: "Take Yes or No straight from the inline panel.",
        },
        {
          kind: "portfolio" as const,
          label: "Portfolio",
          detail: "Open positions, resting orders, and P&L in the same panel.",
        },
      ];

  return (
    <ul className="feature-list">
      {features.map((feature) => (
        <li key={feature.label}>
          <span className="feature-icon">
            <FeatureIcon kind={feature.kind} />
          </span>
          <strong>{feature.label}</strong>
          <span>{feature.detail}</span>
        </li>
      ))}
    </ul>
  );
}

function SetupChecklist({ snapshot }: { snapshot: OnboardingSnapshot }) {
  const milestones = [
    {
      label: "Trading account",
      complete: snapshot.tradingWalletDeployed,
    },
    { label: "API keys", complete: snapshot.hasCredentials },
    { label: "Token approval", complete: snapshot.hasApproval },
  ];

  return (
    <ul className="setup-checklist" aria-label="Trading setup checklist">
      {milestones.map((milestone) => (
        <li
          className={milestone.complete ? "is-complete" : undefined}
          key={milestone.label}
        >
          <span className="check">{milestone.complete ? "✓" : "·"}</span>
          <span>{milestone.label}</span>
          <small>{milestone.complete ? "Complete" : "Complete in panel"}</small>
        </li>
      ))}
    </ul>
  );
}

function WalletOptions() {
  return (
    <div className="wallet-options">
      <div className="wallet-option">
        <span className="wallet-option-mark" aria-hidden="true">
          B
        </span>
        <span>
          <strong>Browser wallets</strong>
          <small>MetaMask, Coinbase Wallet, Rabby</small>
        </span>
        <span className="wallet-option-kind">Extension</span>
      </div>
      <div className="wallet-option">
        <span className="wallet-option-mark" aria-hidden="true">
          W
        </span>
        <span>
          <strong>Mobile wallet</strong>
          <small>Scan from any WalletConnect wallet</small>
        </span>
        <span className="wallet-option-kind">QR</span>
      </div>
    </div>
  );
}

function SetupFacts() {
  return (
    <dl className="setup-facts">
      <div>
        <dt>Network</dt>
        <dd>Polygon · 137</dd>
      </div>
      <div>
        <dt>Signature</dt>
        <dd>Read-only · no gas</dd>
      </div>
    </dl>
  );
}

function LivePreview() {
  return (
    <div className="live-preview">
      <div className="live-preview-bar">
        <span className="live-preview-label">
          <span className="status-pulse" /> Live preview
        </span>
        <span className="live-preview-sites">
          x.com · reddit · bsky · bloomberg
        </span>
      </div>
      <div className="preview-post">
        <div className="preview-post-meta">
          <span className="preview-avatar">K</span>
          <span>
            <strong>Knoww market</strong>
            <small>Matched to what you are reading</small>
          </span>
        </div>
        <h3>Will the Fed cut rates at its next meeting?</h3>
        <div className="preview-outcomes" aria-hidden="true">
          <span className="preview-outcome">
            Yes <strong>60¢</strong>
          </span>
          <span className="preview-outcome preview-outcome--no">
            No <strong>40¢</strong>
          </span>
        </div>
      </div>
    </div>
  );
}

function StageNotice({
  notice,
  error,
  fallback,
}: {
  notice: string;
  error: boolean;
  fallback: string;
}) {
  return (
    <p
      className={`action-notice${error ? " action-notice--error" : ""}`}
      aria-live="polite"
    >
      {!error && <span className="status-pulse" aria-hidden="true" />}
      {notice || fallback}
    </p>
  );
}

function OnboardingApp() {
  const [snapshot, setSnapshot] = React.useState<OnboardingSnapshot>(() =>
    hasExtensionRuntime()
      ? {
          stage: "welcome",
          address: null,
          tradingWalletDeployed: false,
          hasCredentials: false,
          hasApproval: false,
        }
      : getPreviewSnapshot()
  );
  const [loading, setLoading] = React.useState(hasExtensionRuntime());
  const [actionState, setActionState] = React.useState<ActionState>("idle");
  const [notice, setNotice] = React.useState("");
  const progressRef = React.useRef<OnboardingProgress>({});
  const refreshInFlightRef = React.useRef(false);
  const analyticsStateRef = React.useRef("");

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
      const tradingWalletDeployed = status?.tradingWalletDeployed === true;
      const hasCredentials = status?.hasCredentials === true;
      const hasApproval = status?.hasApproval === true;
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

      if (statusResponse.ok === true) {
        const observedState = {
          ...(address ? { wallet_address: address } : {}),
          wallet_connected: loggedIn,
          account_ready: tradingWalletDeployed,
          api_keys_ready: hasCredentials,
          approval_ready: hasApproval,
          setup_complete: __STORE_BUILD__ ? stage === "ready" : tradingReady,
          stage,
          capability: __STORE_BUILD__ ? "market_discovery" : "trading",
        };
        const signature = JSON.stringify(observedState);
        if (analyticsStateRef.current !== signature) {
          analyticsStateRef.current = signature;
          await trackEvent("trading_setup_state", observedState);
        }
      }

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

      setSnapshot({
        stage,
        address,
        tradingWalletDeployed,
        hasCredentials,
        hasApproval,
      });
      setActionState("idle");
      setNotice("");
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
        stage:
          current.stage === "welcome"
            ? "wallet"
            : current.stage === "wallet"
              ? "trading"
              : "ready",
      }));
      return;
    }

    setActionState("opening");
    setNotice("Opening wallet setup…");
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
        "Connect your wallet in the Knoww panel. Return here when it is connected."
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

  const closeOnboarding = () => {
    if (!hasExtensionRuntime()) {
      window.close();
      return;
    }
    chrome.tabs.getCurrent((tab) => {
      if (typeof tab?.id === "number") void chrome.tabs.remove(tab.id);
    });
  };

  const activeIndex = STAGE_INDEX[snapshot.stage];
  const activeStep = PROGRESS_STEPS[activeIndex];
  const extensionVersion = hasExtensionRuntime()
    ? chrome.runtime.getManifest().version
    : "preview";

  return (
    <main className="onboarding-shell">
      <header className="brand-bar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span>Knoww</span>
        </div>
        <div className="build-meta">
          <span className="build-label">
            <span className="build-dot" /> Market discovery extension
          </span>
          <span className="version-label">v{extensionVersion}</span>
        </div>
      </header>

      <div className="onboarding-layout">
        <aside className="progress-panel">
          <p className="progress-kicker">
            <span className="status-pulse" /> Setup
            <span>· from installed to useful</span>
          </p>
          <h2>Four short steps. No guessing.</h2>
          <p className="progress-intro">
            Wire up your wallet and trading account once. After that, Knoww
            surfaces live markets on whatever you are reading.
          </p>
          <ProgressRail stage={snapshot.stage} />
          <p className="privacy-note">
            Knoww uses your public wallet address to identify your account and
            tailor your experience. It never receives your private key.
          </p>
        </aside>

        <section
          className="stage-panel"
          aria-busy={loading}
          aria-label={loading ? "Knoww onboarding" : undefined}
          aria-labelledby={loading ? undefined : "onboarding-stage-title"}
        >
          <div className="stage-progress" aria-hidden="true">
            <span
              className={`stage-progress-fill stage-progress-fill--${activeIndex}`}
            />
          </div>
          <div className="stage-panel-inner">
            <div className="stage-meta">
              <span>Step {String(activeIndex + 1).padStart(2, "0")} / 04</span>
              <span className="stage-phase">
                <span className="status-pulse" /> {activeStep.label}
              </span>
            </div>

            {loading ? (
              <div className="loading-state" role="status">
                <span className="loading-dot" /> Checking your setup…
              </div>
            ) : (
              <div className="stage-content">
                {snapshot.stage === "welcome" && (
                  <>
                    <div className="stage-intro">
                      <h1 id="onboarding-stage-title">
                        Knoww is installed. Here is what it does.
                      </h1>
                      <p>
                        {__STORE_BUILD__
                          ? "Knoww reads the page you are on and surfaces the prediction markets that price what is being discussed."
                          : "Knoww reads the page you are on, finds the prediction markets that price what is being discussed, and lets you trade without leaving the tab."}
                      </p>
                    </div>
                    <FeatureList />
                    <div className="actions">
                      <button
                        className="primary-action"
                        type="button"
                        onClick={startSetup}
                        disabled={actionState === "opening"}
                      >
                        Start setup <span aria-hidden="true">→</span>
                      </button>
                      <span className="duration-note">About 2 minutes</span>
                    </div>
                    {notice && (
                      <StageNotice
                        notice={notice}
                        error={actionState === "error"}
                        fallback=""
                      />
                    )}
                  </>
                )}

                {snapshot.stage === "wallet" && (
                  <>
                    <div className="stage-intro">
                      <h1 id="onboarding-stage-title">
                        Connect your wallet to Knoww.
                      </h1>
                      <p>
                        Your wallet is your Knoww login. Continue with a
                        supported browser wallet or WalletConnect.
                      </p>
                    </div>
                    <WalletOptions />
                    <div className="actions">
                      <button
                        className="primary-action"
                        type="button"
                        onClick={startSetup}
                        disabled={actionState === "opening"}
                      >
                        Continue with a wallet <span aria-hidden="true">→</span>
                      </button>
                      <button
                        className="secondary-action"
                        type="button"
                        onClick={installMetaMask}
                      >
                        Install MetaMask <span aria-hidden="true">↗</span>
                      </button>
                    </div>
                    <SetupFacts />
                    <p className="support-note">
                      Already have a wallet? Continue and select it in the Knoww
                      panel. If not, install MetaMask and return to this tab.
                      Setup resumes where you left off.
                    </p>
                    <StageNotice
                      notice={notice}
                      error={actionState === "error"}
                      fallback="Awaiting connection in the Knoww panel"
                    />
                  </>
                )}

                {snapshot.stage === "trading" && (
                  <>
                    <div className="stage-intro">
                      <h1 id="onboarding-stage-title">
                        Finish your trading setup.
                      </h1>
                      <p>
                        Knoww creates your Polymarket trading account and API
                        keys, then asks you to set a USDC allowance. Complete
                        each prompt in the panel.
                      </p>
                    </div>
                    {snapshot.address && (
                      <div className="wallet-chip">
                        <span className="wallet-status-dot" />
                        <span>Wallet connected</span>
                        <code>{formatAddress(snapshot.address)}</code>
                      </div>
                    )}
                    <SetupChecklist snapshot={snapshot} />
                    <div className="actions">
                      <button
                        className="primary-action"
                        type="button"
                        onClick={startSetup}
                        disabled={actionState === "opening"}
                      >
                        Continue in Knoww panel{" "}
                        <span aria-hidden="true">→</span>
                      </button>
                    </div>
                    <p className="support-note">
                      Your wallet signs only the account setup and allowance
                      requests. Knoww never receives your private key.
                    </p>
                    <StageNotice
                      notice={notice}
                      error={actionState === "error"}
                      fallback="Waiting for trading setup in the Knoww panel"
                    />
                  </>
                )}

                {snapshot.stage === "ready" && (
                  <>
                    <div className="stage-intro">
                      <h1 id="onboarding-stage-title">
                        Try it on a live post.
                      </h1>
                      <p>
                        {__STORE_BUILD__
                          ? "Open a post about news, sports, or crypto. Knoww matches it to a relevant market and adds it to the page."
                          : "Open a post about news, sports, or crypto. Knoww matches it to a market and adds the trading panel inline."}
                      </p>
                    </div>
                    {snapshot.address && (
                      <div className="wallet-chip">
                        <span className="wallet-status-dot" />
                        <span>Setup complete</span>
                        <code>{formatAddress(snapshot.address)}</code>
                      </div>
                    )}
                    <LivePreview />
                    <div className="actions">
                      <button
                        className="primary-action"
                        type="button"
                        onClick={openDemo}
                      >
                        Open x.com and try it <span aria-hidden="true">↗</span>
                      </button>
                    </div>
                    <StageNotice
                      notice={notice}
                      error={actionState === "error"}
                      fallback="Radar active · scanning open tabs"
                    />
                  </>
                )}
              </div>
            )}

            <div className="stage-footer">
              <button
                className="text-action"
                type="button"
                onClick={openSettings}
              >
                Extension settings <span aria-hidden="true">↗</span>
              </button>
              {snapshot.stage !== "ready" && (
                <button
                  className="text-action"
                  type="button"
                  onClick={closeOnboarding}
                >
                  Skip for now
                </button>
              )}
            </div>
          </div>
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
