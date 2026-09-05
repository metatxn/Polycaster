import { resolvePreferredTradingWalletMode } from "@knoww/shared-types/polymarket";
import { getAddress } from "viem";
import {
  pollUntil,
  resolvePortfolioApprovalPollAddress,
  waitForPortfolioTradingWalletDeployment,
} from "../content/trading/portfolio-approval";
import {
  renderSetupBanner,
  renderSetupFocused,
  renderSetupWizard,
} from "../content/trading/portfolio-setup-view";
import {
  deriveSetupFlow,
  fetchTradingSetupApprovalStatus,
  isSetupCompletionUnknownFromDegradedRead,
  isWithinDegradedSetupTrustWindow,
  resolveSetupSurfaceMode,
  SETUP_APPROVAL_DEFAULT,
  type SetupFlowState,
  type SetupSurfaceMode,
  type TradingSetupAllowanceReadStatus,
} from "../content/trading/setup-flow";
import {
  markSetupComplete,
  readSetupComplete,
  readSetupDismissed,
  writeSetupComplete,
  writeSetupDismissed,
  writeSetupMilestones,
} from "../content/trading/setup-flow-storage";
import {
  type LoadingMessageInput,
  startLoadingMessageSequence,
} from "../loading-messages";
import { ONBOARDING_METAMASK_INSTALL_URL } from "../onboarding-state";
import {
  readStoredWalletMode,
  sendRuntimeMessage,
  writeStoredWalletMode,
} from "./messaging";
import { escapeHtml, type TradingWalletMode } from "./shared";

function getAnalyticsWalletAddress(address: string): string | undefined {
  try {
    return getAddress(address);
  } catch {
    return undefined;
  }
}

export const SETUP_STYLES = `
      /* ---- Wallets / sign-in ---- */
      .knoww-portfolio-wallets {
        display: grid;
        width: min(280px, 100%);
        gap: 8px;
      }

      .knoww-portfolio-wallet {
        display: grid;
        grid-template-columns: 28px minmax(0, 1fr);
        align-items: center;
        gap: 10px;
        min-height: 44px;
        border: 1px solid var(--pf-line-2);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.04);
        color: rgba(255, 255, 255, 0.9);
        cursor: pointer;
        padding: 7px 12px;
        text-align: left;
        transition: border-color 0.15s ease, background 0.15s ease;
      }

      .knoww-portfolio-wallet:hover {
        border-color: rgba(52, 211, 153, 0.45);
        background: rgba(52, 211, 153, 0.1);
      }

      .knoww-portfolio-wallet img,
      .knoww-portfolio-wallet span {
        width: 28px;
        height: 28px;
        border-radius: 8px;
      }

      .knoww-portfolio-wallet img {
        object-fit: cover;
      }

      .knoww-portfolio-wallet span {
        display: grid;
        place-items: center;
        background: rgba(255, 255, 255, 0.08);
        color: rgba(255, 255, 255, 0.8);
        font: 600 12px/1 var(--pf-mono);
      }

      .knoww-portfolio-wallet strong {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font: 600 12px/1.2 var(--pf-sans);
      }

      /* ---- Trading gate ---- */
      .knoww-portfolio-trading-gate {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 12px;
        border: 1px solid rgba(52, 211, 153, 0.24);
        border-radius: 14px;
        background: linear-gradient(
          180deg,
          rgba(52, 211, 153, 0.11),
          rgba(52, 211, 153, 0.03)
        );
        padding: 13px 14px;
      }

      .knoww-portfolio-trading-gate strong {
        display: block;
        color: rgba(255, 255, 255, 0.95);
        font: 600 12px/1.2 var(--pf-sans);
      }

      .knoww-portfolio-trading-gate span {
        display: block;
        margin-top: 4px;
        color: var(--pf-mid);
        font: 500 11px/1.4 var(--pf-sans);
      }

      /* Three-column variant of the wallet button: [icon][label][chevron].
         Scoped, higher-specificity overrides — the base .knoww-portfolio-wallet
         rules force a 2-column grid and size every descendant span to 28x28,
         which otherwise squeezes the label span to 28px and drops the chevron. */
      .knoww-portfolio-wallet.knoww-pf-wallet-mobile {
        grid-template-columns: auto minmax(0, 1fr) auto;
        gap: 11px;
        text-align: left;
      }

      .knoww-pf-wallet-mobile .knoww-pf-wallet-qr {
        display: grid;
        place-items: center;
        width: 30px;
        height: 30px;
        border-radius: 9px;
        background: var(--pf-surface-2);
        border: 1px solid var(--pf-line-2);
        color: var(--pf-pos);
      }

      .knoww-pf-wallet-mobile .knoww-pf-wallet-qr svg {
        width: 17px;
        height: 17px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.7;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .knoww-pf-wallet-mobile .knoww-pf-wallet-id {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
        width: auto;
        height: auto;
        min-width: 0;
        border-radius: 0;
        background: transparent;
      }

      .knoww-pf-wallet-mobile .knoww-pf-wallet-id strong {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font: 600 12.5px/1.2 var(--pf-sans);
        color: rgba(255, 255, 255, 0.92);
      }

      .knoww-pf-wallet-mobile .knoww-pf-wallet-id small {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font: 500 10px/1.3 var(--pf-mono);
        letter-spacing: 0.02em;
        color: var(--pf-dim);
      }

      .knoww-pf-wallet-mobile .knoww-pf-wallet-go {
        width: 15px;
        height: 15px;
        fill: none;
        stroke: var(--pf-mid);
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .knoww-pf-wc-frame {
        display: grid;
        place-items: center;
        width: 224px;
        max-width: 100%;
        min-height: 224px;
        margin: 12px auto 4px;
        padding: 12px;
        border-radius: 18px;
        background: #ffffff;
        box-shadow:
          0 18px 40px -22px rgba(0, 0, 0, 0.8),
          inset 0 0 0 1px rgba(0, 0, 0, 0.06);
      }

      .knoww-pf-wc-qr {
        display: block;
        width: 100%;
      }

      .knoww-pf-wc-qr svg {
        display: block;
        width: 100%;
        height: auto;
      }

      .knoww-pf-wc-status {
        display: grid;
        gap: 10px;
        place-items: center;
        padding: 24px;
        color: #5b5b5b;
        font: 500 11px/1.4 var(--pf-mono);
        letter-spacing: 0.04em;
        text-align: center;
      }

      .knoww-pf-wc-status.is-error {
        color: #b4232a;
      }

      .knoww-pf-wc-spinner {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 2px solid rgba(0, 0, 0, 0.12);
        border-top-color: #0a0a0a;
        animation: knoww-pf-spin 0.8s linear infinite;
      }

      .knoww-pf-wc-hint {
        max-width: 240px;
        margin: 2px auto 0;
        color: var(--pf-dim);
        font: 500 10px/1.5 var(--pf-mono);
        letter-spacing: 0.03em;
        text-transform: uppercase;
      }

      @media (prefers-reduced-motion: reduce) {
        .knoww-pf-wc-spinner {
          animation: none;
        }
      }

      /* ---- Setup wizard (knoww-pf-setup-*) ---- */

      .knoww-pf-setup {
        display: flex;
        flex-direction: column;
        gap: 14px;
        border: 1px solid var(--pf-line-2);
        border-radius: 16px;
        background: linear-gradient(
          180deg,
          rgba(255, 255, 255, 0.045),
          rgba(255, 255, 255, 0.012)
        );
        padding: 15px 16px;
      }

      .knoww-pf-setup-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .knoww-pf-setup-kicker {
        font: 600 10px/1 var(--pf-mono);
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--pf-mid);
      }

      .knoww-pf-setup-skip {
        border: 0;
        background: transparent;
        color: var(--pf-dim);
        cursor: pointer;
        font: 500 11px/1 var(--pf-sans);
        padding: 0;
        transition: color 0.14s ease;
      }

      .knoww-pf-setup-skip:hover {
        color: var(--pf-mid);
      }

      .knoww-pf-setup-error {
        padding: 8px 10px;
        border-radius: 10px;
        background: rgba(251, 113, 133, 0.1);
        border: 1px solid rgba(251, 113, 133, 0.3);
        color: #fb7185;
        font: 500 12px/1.4 var(--pf-sans);
      }

      .knoww-pf-setup-action {
        margin-top: 4px;
      }

      /* Approve step: labelled input + button */
      .knoww-pf-setup-approve {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      /* Approve button: compact, centred in the column with a centred label. */
      .knoww-pf-setup-approve .knoww-portfolio-open {
        align-self: center;
        justify-content: center;
        min-width: 132px;
      }

      .knoww-pf-setup-approve-label {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font: 600 10.5px/1 var(--pf-mono);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--pf-mid);
      }

      .knoww-pf-setup-approve-field {
        display: flex;
        align-items: center;
        gap: 6px;
        border: 1px solid var(--pf-line-2);
        border-radius: 10px;
        background: rgba(0, 0, 0, 0.18);
        padding: 0 10px;
        transition: border-color 0.14s ease, box-shadow 0.14s ease;
      }

      .knoww-pf-setup-approve-field:focus-within {
        border-color: rgba(52, 211, 153, 0.5);
        box-shadow: 0 0 0 3px rgba(52, 211, 153, 0.1);
      }

      .knoww-pf-setup-approve-input {
        flex: 1;
        min-width: 0;
        height: 40px;
        border: 0;
        outline: none;
        background: transparent;
        color: var(--pf-hi);
        font: 500 16px/1 var(--pf-mono);
        font-variant-numeric: tabular-nums;
      }

      .knoww-pf-setup-approve-unit {
        font: 600 11px/1 var(--pf-mono);
        color: var(--pf-dim);
      }

      /* Numbered step list (collapsed summary) */
      .knoww-pf-setup-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .knoww-pf-setup-step {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 5px 0;
      }

      .knoww-pf-setup-step-body {
        display: flex;
        flex-direction: column;
        gap: 8px;
        flex: 1;
        min-width: 0;
      }

      .knoww-pf-setup-step-helper {
        color: var(--pf-mid);
        font: 500 11.5px/1.45 var(--pf-sans);
      }

      .knoww-pf-setup-step-index {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        flex-shrink: 0;
        font: 700 10px/1 var(--pf-mono);
        transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
      }

      .knoww-pf-setup-step.is-done .knoww-pf-setup-step-index {
        background: #34d399;
        border: 1px solid #34d399;
        color: #fff;
      }

      .knoww-pf-setup-step.is-now .knoww-pf-setup-step-index {
        background: transparent;
        border: 1px solid rgba(52, 211, 153, 0.8);
        color: #34d399;
      }

      .knoww-pf-setup-step.is-pending .knoww-pf-setup-step-index {
        background: transparent;
        border: 1px solid var(--pf-line-2);
        color: var(--pf-dim);
      }

      .knoww-pf-setup-step-label {
        display: flex;
        align-items: center;
        min-height: 20px;
        font: 500 12px/1 var(--pf-sans);
      }

      .knoww-pf-setup-step.is-done .knoww-pf-setup-step-label {
        color: var(--pf-mid);
      }

      .knoww-pf-setup-step.is-now .knoww-pf-setup-step-label {
        color: var(--pf-hi);
        font-weight: 600;
      }

      .knoww-pf-setup-step.is-pending .knoww-pf-setup-step-label {
        color: var(--pf-dim);
      }

      /* Returning-user focused prompt (vault already deployed) */
      .knoww-pf-setup-focused {
        display: flex;
        flex-direction: column;
        gap: 10px;
        border: 1px solid rgba(52, 211, 153, 0.24);
        border-radius: 14px;
        background: linear-gradient(
          180deg,
          rgba(52, 211, 153, 0.11),
          rgba(52, 211, 153, 0.03)
        );
        padding: 13px 14px;
      }

      .knoww-pf-setup-focused-text strong {
        display: block;
        color: rgba(255, 255, 255, 0.95);
        font: 600 13px/1.2 var(--pf-sans);
      }

      .knoww-pf-setup-focused-text span {
        display: block;
        margin-top: 4px;
        color: var(--pf-mid);
        font: 500 11.5px/1.45 var(--pf-sans);
      }

      /* Dismissible resume banner */
      .knoww-pf-setup-banner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        width: 100%;
        border: 1px solid rgba(52, 211, 153, 0.24);
        border-radius: 12px;
        background: linear-gradient(
          135deg,
          rgba(52, 211, 153, 0.08),
          rgba(52, 211, 153, 0.03)
        );
        padding: 10px 12px;
        cursor: pointer;
        text-align: left;
        transition: border-color 0.14s ease, background 0.14s ease;
      }

      .knoww-pf-setup-banner:hover {
        border-color: rgba(52, 211, 153, 0.4);
        background: linear-gradient(
          135deg,
          rgba(52, 211, 153, 0.13),
          rgba(52, 211, 153, 0.06)
        );
      }

      .knoww-pf-setup-banner svg {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
        fill: none;
        stroke: #34d399;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .knoww-pf-setup-banner-text {
        flex: 1;
        font: 600 11px/1.3 var(--pf-sans);
        color: #34d399;
      }
`;

export interface SetupPortfolioData {
  address: string;
  ownerAddress: string;
  walletMode: TradingWalletMode;
  hasTradingWallet: boolean;
  hasTradingCredentials: boolean;
  hasApproval: boolean;
  approvalReadStatus: TradingSetupAllowanceReadStatus;
  cashBalance: number;
}

export interface SetupResolvedPortfolioWallet {
  address: string;
  walletMode: TradingWalletMode;
  isDeployed: boolean;
}

export interface PortfolioWallet {
  uuid: string;
  name: string;
  icon?: string;
  rdns?: string;
}

export interface PortfolioSetupSurfaceRender {
  html: string;
  mode: SetupSurfaceMode;
}

export interface PortfolioSetupDependencies {
  root: HTMLElement;
  getPortfolioData(): SetupPortfolioData | null;
  reloadPortfolio(): Promise<void>;
  renderPortfolio(): void;
  invalidatePortfolio(): void;
  resetFunding(): void;
  openFunding(action: "deposit" | "withdraw"): void;
}

export interface PortfolioSetupHandle {
  resolvePreferredWalletMode(address: string): Promise<TradingWalletMode>;
  reauthSession(address: string): Promise<{ ok: boolean; error?: string }>;
  getSessionAddress(): Promise<string | null>;
  getWallets(): Promise<PortfolioWallet[]>;
  getTradingStatus(address: string): Promise<{ hasCredentials: boolean }>;
  resolveWallet(address: string): Promise<SetupResolvedPortfolioWallet>;
  hasApproval(address: string): Promise<boolean | null>;
  shouldPreserveDegradedApproval(): boolean;
  reconcileLoadedData(
    data: SetupPortfolioData,
    isCurrent: () => boolean
  ): Promise<boolean>;
  renderSurface(data: SetupPortfolioData): PortfolioSetupSurfaceRender;
  renderSignedOut(): string;
  prepareSignedOut(): Promise<void>;
  clearConnectionErrors(): void;
  clearTradingError(): void;
  reset(): void;
  handleClick(event: Event): boolean;
}

const PORTFOLIO_CONNECT_TIMEOUT_MS = 90_000;
const PORTFOLIO_CONNECT_POLL_MS = 1_000;
const WALLETCONNECT_WALLET_UUID = "__knoww_walletconnect_mobile__";

function showPortfolioLoading(
  container: HTMLElement | null,
  messages: LoadingMessageInput
): () => void {
  if (!container) return () => {};
  const status = document.createElement("div");
  status.className = "knoww-portfolio-loading";
  container.replaceChildren(status);
  return startLoadingMessageSequence(status, messages);
}

export function createPortfolioSetup(
  dependencies: PortfolioSetupDependencies
): PortfolioSetupHandle {
  let portfolioConnectError: string | null = null;
  let portfolioTradingError: string | null = null;
  let portfolioSetupDismissed = false;
  let portfolioSetupComplete = false;
  let portfolioSetupConsecutiveDegradedReads = 0;
  let portfolioOwnerAddressValue: string | null = null;
  let portfolioWallets: PortfolioWallet[] | null = null;
  let portfolioWalletConnectActive = false;
  let portfolioWalletConnectToken = 0;
  let portfolioWalletConnectQr: string | null = null;
  let portfolioWalletConnectError: string | null = null;
  let reconciliationGeneration = 0;
  let reconciliationQueue: Promise<void> = Promise.resolve();
  async function hasPortfolioLegacySafe(
    ownerAddress: string
  ): Promise<boolean | null> {
    try {
      const response = await sendRuntimeMessage({
        type: "trading:derive-proxy-address",
        eoaAddress: ownerAddress,
        walletMode: "safe",
        // Existence probe: bytecode is authoritative; the relayer fallback is a
        // guaranteed-miss round-trip for every user without a legacy safe.
        skipRelayerDeploymentFallback: true,
      });
      if (!response.ok) return null;
      const payload = response.data as { isDeployed?: unknown } | undefined;
      return payload?.isDeployed === true;
    } catch {
      return null;
    }
  }

  async function resolvePreferredPortfolioWalletMode(
    ownerAddress: string
  ): Promise<TradingWalletMode> {
    const storedMode = await readStoredWalletMode(ownerAddress);
    // A stored "safe" is only ever written after a successful on-chain
    // detection, and a deployed Safe is permanent — re-probing can never
    // change the answer, so skip the per-open bytecode round trip.
    if (storedMode === "safe") return storedMode;
    const legacySafeDeployed = await hasPortfolioLegacySafe(ownerAddress);
    if (legacySafeDeployed === null) {
      // Transient probe failure: honor the stored mode (a stored "safe" is only
      // ever written after a successful on-chain detection) and skip the
      // write-back so one blip can't clobber it — otherwise the coinciding
      // action would run against the wrong (empty) deposit wallet.
      return storedMode;
    }
    const preferredMode = resolvePreferredTradingWalletMode({
      storedMode,
      legacySafeDeployed,
    });
    if (preferredMode !== storedMode) {
      await writeStoredWalletMode(ownerAddress, preferredMode);
    }
    return preferredMode;
  }

  let portfolioDisconnecting = false;
  async function disconnectPortfolioWallet(
    button: HTMLButtonElement
  ): Promise<void> {
    if (portfolioDisconnecting) return;
    portfolioDisconnecting = true;
    button.classList.add("is-busy");
    button.title = "Disconnecting your wallet...";
    button.setAttribute("aria-label", "Disconnecting your wallet...");
    void sendRuntimeMessage({
      type: "analytics:track",
      event: "wallet_disconnected",
    });
    try {
      await sendRuntimeMessage({ type: "auth:logout" });
    } finally {
      portfolioDisconnecting = false;
      button.classList.remove("is-busy");
      button.title = "Disconnect wallet";
      button.setAttribute("aria-label", "Disconnect wallet");
    }
  }

  let portfolioSwitching = false;
  async function switchPortfolioWallet(
    button: HTMLButtonElement
  ): Promise<void> {
    if (portfolioSwitching) return;
    portfolioSwitching = true;
    // The active account is changing under any open funding flow — reset it.
    dependencies.resetFunding();
    button.classList.add("is-busy");
    button.title = "Switching your wallet...";
    button.setAttribute("aria-label", "Switching your wallet...");
    void sendRuntimeMessage({
      type: "analytics:track",
      event: "wallet_switch_clicked",
    });

    try {
      const response = await sendRuntimeMessage({
        type: "KNOWW_SWITCH_PORTFOLIO_WALLET",
      });
      const payload = response.data as
        | { success?: boolean; data?: { error?: string } }
        | undefined;

      if (response.ok === false || payload?.success === false) {
        const message =
          payload?.data?.error || response.error || "Failed to switch wallet.";
        if (dependencies.getPortfolioData()) {
          // With a portfolio loaded the signed-out channel never renders — the
          // spinner would just stop silently and the stored message would leak
          // into a later signed-out render. Use the portfolio's error line.
          portfolioTradingError = message;
          await dependencies.reloadPortfolio();
        } else {
          portfolioConnectError = message;
          dependencies.invalidatePortfolio();
          const container = dependencies.root.querySelector<HTMLElement>(
            "[data-sidepanel-portfolio]"
          );
          if (container) container.innerHTML = renderPortfolioSignedOut();
        }
        return;
      }

      await dependencies.reloadPortfolio();
    } finally {
      portfolioSwitching = false;
      button.classList.remove("is-busy");
      button.title = "Switch wallet";
      button.setAttribute("aria-label", "Switch wallet");
    }
  }

  // Deposit/withdraw move real funds, which can't be signed from the side panel
  // (it has no wallet context) and must not be hand-rolled against the funding
  // contracts. We deep-link into knoww.app's tested Deposit/Withdraw modals,
  // which auto-open via the `?fund=` param.

  async function reauthPortfolioSession(
    address: string
  ): Promise<{ ok: boolean; error?: string }> {
    const response = await sendRuntimeMessage({
      type: "KNOWW_PORTFOLIO_REAUTH",
      address,
    });
    if (response.ok === false) {
      return {
        ok: false,
        error:
          response.error === "NO_CONTENT_TAB"
            ? "Open a supported page (e.g. Polymarket) with your wallet, then retry."
            : response.error,
      };
    }
    const payload = response.data as
      | { success?: boolean; data?: { error?: string } }
      | undefined;
    if (payload?.success === false) {
      return { ok: false, error: payload.data?.error };
    }
    return { ok: true };
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForPortfolioSessionAddress(): Promise<string | null> {
    const deadline = Date.now() + PORTFOLIO_CONNECT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const address = await getPortfolioSessionAddress();
      if (address) return address;
      await sleep(PORTFOLIO_CONNECT_POLL_MS);
    }
    return null;
  }

  async function waitForPortfolioTradingEnabled(
    address: string
  ): Promise<boolean> {
    const deadline = Date.now() + PORTFOLIO_CONNECT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const status = await getPortfolioTradingStatus(address);
      if (status.hasCredentials) return true;
      await sleep(PORTFOLIO_CONNECT_POLL_MS);
    }
    return false;
  }

  async function connectPortfolioWallet(walletUuid: string): Promise<void> {
    const container = dependencies.root.querySelector<HTMLElement>(
      "[data-sidepanel-portfolio]"
    );
    let stopLoading = showPortfolioLoading(container, [
      "Connecting your wallet...",
      "Check your wallet to continue...",
      "Complete the connection when you're ready...",
    ]);

    const response = await sendRuntimeMessage({
      type: "KNOWW_CONNECT_PORTFOLIO_WALLET",
      walletUuid,
    });
    const payload = response.data as
      | { success?: boolean; data?: { error?: string } }
      | undefined;

    if (response.ok === false || payload?.success === false) {
      stopLoading();
      dependencies.invalidatePortfolio();
      portfolioConnectError =
        payload?.data?.error || response.error || "Failed to connect wallet.";
      if (container) container.innerHTML = renderPortfolioSignedOut();
      return;
    }

    stopLoading();
    stopLoading = showPortfolioLoading(container, [
      "Approve in your wallet...",
      "Check your wallet for the approval...",
      "Complete the approval when you're ready...",
    ]);

    const sessionAddress = await waitForPortfolioSessionAddress();
    if (!sessionAddress) {
      stopLoading();
      dependencies.invalidatePortfolio();
      portfolioConnectError =
        "Wallet connection did not finish. Approve the wallet prompts and try again.";
      if (container) container.innerHTML = renderPortfolioSignedOut();
      return;
    }

    portfolioConnectError = null;
    portfolioTradingError = null;
    stopLoading();
    dependencies.invalidatePortfolio();
    await dependencies.reloadPortfolio();
  }

  function renderPortfolioWalletConnect(): string {
    const error = portfolioWalletConnectError;
    const qr = portfolioWalletConnectQr;
    return `
    <div class="knoww-portfolio-signed-out knoww-pf-wc">
      <p class="knoww-pf-empty-title">Scan to connect</p>
      <span class="knoww-pf-empty-sub">
        Open your wallet app, scan this code, then approve the connection.
      </span>
      <div class="knoww-pf-wc-frame">
        ${
          qr
            ? `<div class="knoww-pf-wc-qr">${qr}</div>`
            : error
              ? `<div class="knoww-pf-wc-status is-error">${escapeHtml(error)}</div>`
              : `<div class="knoww-pf-wc-status"><span class="knoww-pf-wc-spinner" aria-hidden="true"></span>Creating your QR...</div>`
        }
      </div>
      <span class="knoww-pf-wc-hint">Works with MetaMask, Rainbow, Trust &amp; any WalletConnect wallet.</span>
      <div class="knoww-portfolio-actions">
        <button type="button" class="knoww-portfolio-open" data-walletconnect-cancel>
          Back to wallets
        </button>
      </div>
    </div>
  `;
  }

  async function connectPortfolioWalletConnect(): Promise<void> {
    const container = dependencies.root.querySelector<HTMLElement>(
      "[data-sidepanel-portfolio]"
    );
    const token = ++portfolioWalletConnectToken;
    portfolioWalletConnectActive = true;
    portfolioWalletConnectQr = null;
    portfolioWalletConnectError = null;
    portfolioConnectError = null;
    if (container) container.innerHTML = renderPortfolioWalletConnect();

    // Kick off the WalletConnect session in the content script (same rail the
    // trading panel uses). The pairing URI is generated there and polled below.
    await sendRuntimeMessage({
      type: "KNOWW_CONNECT_PORTFOLIO_WALLET",
      walletUuid: WALLETCONNECT_WALLET_UUID,
    });

    const deadline = Date.now() + 180_000; // WalletConnect pairing TTL ~3 min.
    while (
      portfolioWalletConnectActive &&
      portfolioWalletConnectToken === token
    ) {
      // A finished connection resolves the Knoww session — load and exit.
      const sessionAddress = await getPortfolioSessionAddress();
      if (sessionAddress) {
        portfolioWalletConnectActive = false;
        portfolioConnectError = null;
        portfolioTradingError = null;
        dependencies.invalidatePortfolio();
        await dependencies.reloadPortfolio();
        return;
      }

      const response = await sendRuntimeMessage({
        type: "KNOWW_GET_PORTFOLIO_WALLETCONNECT_STATE",
      });
      if (portfolioWalletConnectToken !== token) return;

      if (response.ok === false) {
        portfolioWalletConnectError =
          response.error || "Could not prepare the WalletConnect QR code.";
        portfolioWalletConnectQr = null;
        if (container) container.innerHTML = renderPortfolioWalletConnect();
        portfolioWalletConnectActive = false;
        return;
      }

      const payload = response.data as
        | {
            data?: { status?: string; error?: string; qrSvg?: string | null };
          }
        | undefined;
      const wc = payload?.data;

      if (wc?.error) {
        portfolioWalletConnectError = wc.error;
        portfolioWalletConnectQr = null;
      } else if (
        typeof wc?.qrSvg === "string" &&
        wc.qrSvg !== portfolioWalletConnectQr
      ) {
        portfolioWalletConnectQr = wc.qrSvg;
        portfolioWalletConnectError = null;
      }

      if (
        container &&
        container ===
          dependencies.root.querySelector("[data-sidepanel-portfolio]")
      ) {
        container.innerHTML = renderPortfolioWalletConnect();
      }

      if (Date.now() > deadline) {
        portfolioWalletConnectError =
          "The connection request timed out. Go back and try again.";
        if (container) container.innerHTML = renderPortfolioWalletConnect();
        portfolioWalletConnectActive = false;
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  }

  function cancelPortfolioWalletConnect(): void {
    portfolioWalletConnectActive = false;
    portfolioWalletConnectToken++;
    portfolioWalletConnectQr = null;
    portfolioWalletConnectError = null;
    // Tear down the in-flight pairing in the content script so the relay
    // subscription is released and a later reconnect starts a fresh QR.
    void sendRuntimeMessage({ type: "KNOWW_CANCEL_PORTFOLIO_WALLETCONNECT" });
    const container = dependencies.root.querySelector<HTMLElement>(
      "[data-sidepanel-portfolio]"
    );
    if (container) container.innerHTML = renderPortfolioSignedOut();
  }

  async function deployPortfolioTradingWallet(
    ownerAddress: string
  ): Promise<void> {
    const container = dependencies.root.querySelector<HTMLElement>(
      "[data-sidepanel-portfolio]"
    );
    let stopLoading = showPortfolioLoading(container, [
      "Creating your account...",
      "Setting up your trading access...",
      "Preparing your account for you...",
    ]);

    const walletMode = await resolvePreferredPortfolioWalletMode(ownerAddress);
    const analyticsProperties = {
      product: "extension",
      surface: "portfolio_sidepanel",
      wallet_address: getAnalyticsWalletAddress(ownerAddress),
      wallet_mode: walletMode,
    };
    void sendRuntimeMessage({
      type: "analytics:track",
      event: "trading_account_creation_attempted",
      properties: analyticsProperties,
    });
    const response = await sendRuntimeMessage({
      type: "trading:deploy-safe",
      address: ownerAddress,
      walletMode,
    });

    if (response.ok === false) {
      void sendRuntimeMessage({
        type: "analytics:track",
        event: "trading_account_creation_failed",
        properties: analyticsProperties,
      });
      stopLoading();
      dependencies.invalidatePortfolio();
      portfolioTradingError =
        response.error || "Failed to create trading wallet.";
      if (container) await dependencies.reloadPortfolio();
      return;
    }

    const payload = response.data as
      | { proxyAddress?: unknown; alreadyDeployed?: unknown }
      | undefined;
    const proxyAddress =
      typeof payload?.proxyAddress === "string" ? payload.proxyAddress : null;
    if (payload?.alreadyDeployed !== true) {
      stopLoading();
      stopLoading = showPortfolioLoading(container, [
        "Confirming your account...",
        "Checking your account on Polygon...",
        "Preparing your trading access...",
      ]);
      const deployed = await waitForPortfolioTradingWalletDeployment({
        ownerAddress,
        expectedProxyAddress: proxyAddress,
        // Narrow poll: the wallet mode is already resolved above, so each
        // attempt is a single derive-proxy-address deployment check — not the
        // full resolvePortfolioWallet (stored-mode read + legacy-safe probe +
        // derive) fan-out on every tick of a 90s wait.
        resolvePortfolioWallet: async (owner: string) => {
          const pollResponse = await sendRuntimeMessage({
            type: "trading:derive-proxy-address",
            eoaAddress: owner,
            walletMode,
            // The relayer's /deployed record can flip true before code exists
            // on-chain; advancing to Approve then runs against a code-less
            // wallet. Only a bytecode read may resolve this wait.
            skipRelayerDeploymentFallback: true,
          });
          const pollPayload = pollResponse.data as
            | { proxyAddress?: unknown; isDeployed?: unknown }
            | undefined;
          return {
            address:
              typeof pollPayload?.proxyAddress === "string"
                ? pollPayload.proxyAddress
                : null,
            isDeployed:
              typeof pollPayload?.isDeployed === "boolean"
                ? pollPayload.isDeployed
                : null,
          };
        },
        timeoutMs: PORTFOLIO_CONNECT_TIMEOUT_MS,
        sleep,
      });
      if (!deployed) {
        void sendRuntimeMessage({
          type: "analytics:track",
          event: "trading_account_confirmation_pending",
          properties: analyticsProperties,
        });
        stopLoading();
        dependencies.invalidatePortfolio();
        portfolioTradingError =
          "Your account is being confirmed. Refresh in a moment.";
        if (container) await dependencies.reloadPortfolio();
        return;
      }
    }

    if (payload?.alreadyDeployed !== true) {
      const walletAddress = getAnalyticsWalletAddress(ownerAddress);
      void sendRuntimeMessage({
        type: "analytics:track",
        event: "trading_account_created",
        properties: {
          product: "extension",
          surface: "portfolio_sidepanel",
          ...(walletAddress ? { wallet_address: walletAddress } : {}),
          walletMode,
          account_kind: "trading_wallet",
          $insert_id: `trading-wallet:${walletAddress}:${walletMode}`,
        },
      });
    }

    dependencies.invalidatePortfolio();
    portfolioTradingError = null;
    stopLoading();
    await dependencies.reloadPortfolio();
  }

  type PortfolioApprovalWaitResult = "approved" | "not-approved" | "unverified";

  async function waitForPortfolioApproval(
    proxyAddress: string
  ): Promise<PortfolioApprovalWaitResult> {
    // Distinguish "every read cleanly said not-approved" from "we never got a
    // clean read" (hasPortfolioApproval returns null on degraded reads) — the
    // approval may well have landed during a degraded window, and telling the
    // user it "didn't complete" prompts a redundant re-approval.
    let sawCleanRead = false;
    const approved = await pollUntil(
      async () => {
        const result = await hasPortfolioApproval(proxyAddress);
        if (result) return true;
        if (result === false) sawCleanRead = true;
        return null;
      },
      { timeoutMs: PORTFOLIO_CONNECT_TIMEOUT_MS }
    );
    if (approved) return "approved";
    return sawCleanRead ? "not-approved" : "unverified";
  }

  async function approvePortfolioTrading(
    ownerAddress: string,
    approvalAmount: string
  ): Promise<void> {
    const container = dependencies.root.querySelector<HTMLElement>(
      "[data-sidepanel-portfolio]"
    );
    const stopLoading = showPortfolioLoading(container, [
      "Approve in your wallet...",
      "Check your wallet for the approval...",
      "Complete the approval when you're ready...",
    ]);

    // The signature has to be produced in a content tab (where the wallet is
    // injected) — the side panel is not a tab, so a direct relayer-approve fails
    // with "No active tab for signing". Forward to the resolved content tab, which
    // runs TradingService.approveUsdc and bridges the signature to the wallet —
    // the same rail KNOWW_ENABLE_PORTFOLIO_TRADING uses.
    const response = await sendRuntimeMessage({
      type: "KNOWW_APPROVE_PORTFOLIO_TRADING",
      address: ownerAddress,
      approvalAmount,
    });
    const payload = response.data as
      | { success?: boolean; data?: { error?: string } }
      | undefined;

    if (response.ok === false || payload?.success === false) {
      stopLoading();
      dependencies.invalidatePortfolio();
      portfolioTradingError =
        payload?.data?.error ||
        response.error ||
        "Failed to approve trading permissions.";
      if (container) await dependencies.reloadPortfolio();
      return;
    }

    // The content tab opens the wallet and submits via the relayer asynchronously;
    // poll the on-chain allowance until it lands, then refresh.
    const proxyAddress = await resolvePortfolioApprovalPollAddress({
      ownerAddress,
      currentProxyAddress: dependencies.getPortfolioData()?.address,
      resolvePortfolioWallet,
    });
    // A null poll address means the trading-wallet derive failed (non-EOA) —
    // the approval may well have landed, so report "couldn't verify" rather
    // than polling the owner EOA and claiming it was rejected.
    const waitResult = proxyAddress
      ? await waitForPortfolioApproval(proxyAddress)
      : "unverified";
    if (waitResult !== "approved") {
      stopLoading();
      dependencies.invalidatePortfolio();
      portfolioTradingError =
        waitResult === "unverified"
          ? "Approval status is updating. Refresh in a moment to check."
          : "Approval didn't complete. Approve the wallet signature and try again.";
      if (container) await dependencies.reloadPortfolio();
      return;
    }

    portfolioTradingError = null;
    stopLoading();
    dependencies.invalidatePortfolio();
    await dependencies.reloadPortfolio();
  }

  async function enablePortfolioTrading(ownerAddress: string): Promise<void> {
    const container = dependencies.root.querySelector<HTMLElement>(
      "[data-sidepanel-portfolio]"
    );
    const stopLoading = showPortfolioLoading(container, [
      "Sign in your wallet...",
      "Check your wallet for the signature...",
      "Complete the signature when you're ready...",
    ]);

    const response = await sendRuntimeMessage({
      type: "KNOWW_ENABLE_PORTFOLIO_TRADING",
      address: ownerAddress,
    });
    const payload = response.data as
      | { success?: boolean; data?: { error?: string } }
      | undefined;

    if (response.ok === false || payload?.success === false) {
      stopLoading();
      dependencies.invalidatePortfolio();
      portfolioTradingError =
        payload?.data?.error || response.error || "Failed to enable trading.";
      if (container) await dependencies.reloadPortfolio();
      return;
    }

    const enabled = await waitForPortfolioTradingEnabled(ownerAddress);
    if (!enabled) {
      stopLoading();
      dependencies.invalidatePortfolio();
      portfolioTradingError =
        "Trading was not enabled. Approve the wallet signature and try again.";
      if (container) await dependencies.reloadPortfolio();
      return;
    }

    portfolioTradingError = null;
    stopLoading();
    dependencies.invalidatePortfolio();
    await dependencies.reloadPortfolio();
  }

  type PortfolioConnectedWalletState =
    | { status: "connected"; address: string }
    | { status: "disconnected" }
    | { status: "unavailable" };

  async function getPortfolioSessionAddress(): Promise<string | null> {
    const connectedWallet = await getPortfolioConnectedWalletState();
    if (connectedWallet.status === "connected") return connectedWallet.address;
    if (connectedWallet.status === "disconnected") return null;

    const response = await sendRuntimeMessage({
      type: "auth:get-session-info",
    });
    const payload = response.data as
      | { loggedIn?: unknown; address?: unknown }
      | undefined;
    return payload?.loggedIn === true && typeof payload.address === "string"
      ? payload.address
      : null;
  }

  async function getPortfolioWallets(): Promise<PortfolioWallet[]> {
    const response = await sendRuntimeMessage({
      type: "KNOWW_GET_PORTFOLIO_WALLETS",
    });
    const payload = response.data as
      | { success?: boolean; data?: { wallets?: unknown } }
      | undefined;
    const wallets = payload?.data?.wallets;
    if (!Array.isArray(wallets)) return [];

    return wallets
      .map((wallet) => wallet as Partial<PortfolioWallet>)
      .filter(
        (wallet): wallet is PortfolioWallet =>
          typeof wallet.uuid === "string" && typeof wallet.name === "string"
      );
  }

  async function getPortfolioTradingStatus(
    address: string
  ): Promise<{ hasCredentials: boolean }> {
    const response = await sendRuntimeMessage({
      type: "KNOWW_GET_PORTFOLIO_TRADING_STATUS",
      address,
    });
    const payload = response.data as { hasCredentials?: unknown } | undefined;
    return { hasCredentials: payload?.hasCredentials === true };
  }

  async function getPortfolioConnectedWalletState(): Promise<PortfolioConnectedWalletState> {
    const response = await sendRuntimeMessage({
      type: "KNOWW_GET_PORTFOLIO_CONNECTED_WALLET",
    });
    if (response.ok === false) return { status: "unavailable" };

    const payload = response.data as
      | {
          success?: boolean;
          data?: { address?: unknown; status?: unknown };
        }
      | undefined;
    if (payload?.success !== true) return { status: "unavailable" };
    if (payload.data?.status === "disconnected") {
      return { status: "disconnected" };
    }
    if (payload.data?.status === "unavailable") {
      return { status: "unavailable" };
    }

    const address = payload.data?.address;
    return typeof address === "string" && address.length > 0
      ? { status: "connected", address }
      : { status: "unavailable" };
  }

  async function resolvePortfolioWallet(
    ownerAddress: string
  ): Promise<SetupResolvedPortfolioWallet> {
    const walletMode = await resolvePreferredPortfolioWalletMode(ownerAddress);
    if (walletMode === "eoa") {
      return { address: ownerAddress, walletMode, isDeployed: true };
    }

    const response = await sendRuntimeMessage({
      type: "trading:derive-proxy-address",
      eoaAddress: ownerAddress,
      walletMode,
    });
    const payload = response.data as
      | { proxyAddress?: unknown; isDeployed?: unknown }
      | undefined;
    return {
      address:
        typeof payload?.proxyAddress === "string"
          ? payload.proxyAddress
          : ownerAddress,
      walletMode,
      isDeployed: payload?.isDeployed === true,
    };
  }

  async function hasPortfolioApproval(
    proxyAddress: string
  ): Promise<boolean | null> {
    try {
      const status = await fetchTradingSetupApprovalStatus(
        proxyAddress,
        async (ownerAddress) => {
          const allAllowances = await sendRuntimeMessage({
            type: "trading:get-all-allowances",
            ownerAddress,
          });
          return allAllowances.data as
            | {
                allowances?: Record<string, number>;
                degraded?: boolean;
                degradedKeys?: string[];
              }
            | undefined;
        }
      );
      if (status.allowanceReadStatus === "degraded") return null;
      return status.hasTradingApproval;
    } catch {
      return null;
    }
  }

  function portfolioOwnerAddress(): string | null {
    return portfolioOwnerAddressValue;
  }

  function portfolioSetupState(data: SetupPortfolioData): SetupFlowState {
    return {
      hasSession: true, // SetupPortfolioData only exists once a session is resolved
      address: data.ownerAddress,
      proxyAddress: data.address,
      walletMode: data.walletMode,
      isDeployed: data.hasTradingWallet,
      hasApproval: data.hasApproval,
      hasCredentials: data.hasTradingCredentials,
      cashBalance: data.cashBalance,
    };
  }

  function isPortfolioSetupCompletionUnknown(
    data: SetupPortfolioData
  ): boolean {
    if (data.approvalReadStatus !== "degraded") return false;
    return isSetupCompletionUnknownFromDegradedRead({
      consecutiveDegradedReads: portfolioSetupConsecutiveDegradedReads,
      flowAssumingApproval: deriveSetupFlow({
        ...portfolioSetupState(data),
        hasApproval: true,
      }),
    });
  }

  function renderPortfolioSetupSurface(
    data: SetupPortfolioData
  ): PortfolioSetupSurfaceRender {
    const flow = deriveSetupFlow(portfolioSetupState(data));
    const mode = resolveSetupSurfaceMode({
      flow,
      persistedComplete: portfolioSetupComplete,
      dismissed: portfolioSetupDismissed,
      liveCompleteKnown: !isPortfolioSetupCompletionUnknown(data),
    });
    if (mode === "complete") return { html: "", mode };
    if (mode === "banner") return { html: renderSetupBanner(flow), mode };
    // Returning user — they already have a trading vault, so don't replay the
    // whole onboarding. Show a focused prompt for what's left (usually generating
    // CLOB API keys) and keep their portfolio visible behind it.
    if (data.hasTradingWallet) {
      return {
        html: renderSetupFocused({
          flow,
          ownerAddress: data.ownerAddress,
          error: portfolioTradingError,
        }),
        mode: "banner",
      };
    }
    // New user — guided onboarding checklist.
    return {
      html: renderSetupWizard({
        flow,
        ownerAddress: data.ownerAddress,
        error: portfolioTradingError,
        walletPicker: "", // signed-in wizard never lands on the connect step
      }),
      mode: "wizard",
    };
  }

  function renderPortfolioMobileWalletOption(): string {
    return `
    <button type="button" class="knoww-portfolio-wallet knoww-pf-wallet-mobile" data-connect-portfolio-walletconnect>
      <span class="knoww-pf-wallet-qr" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 3h3m3 0v3m-6 0h3m3-6v3M14 14h3"></path></svg>
      </span>
      <span class="knoww-pf-wallet-id">
        <strong>Mobile wallet</strong>
        <small>Scan a QR with your phone</small>
      </span>
      <svg class="knoww-pf-wallet-go" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"></path></svg>
    </button>
  `;
  }

  function renderPortfolioWalletChoices(
    wallets: PortfolioWallet[] = []
  ): string {
    if (wallets.length === 0) {
      return `
      <div class="knoww-portfolio-wallets">
        ${renderPortfolioMobileWalletOption()}
      </div>
      <div class="knoww-portfolio-actions">
        <button type="button" class="knoww-portfolio-open primary" data-refresh-portfolio-wallets>
          Find wallets
        </button>
        <button type="button" class="knoww-portfolio-open" data-install-metamask>
          Install MetaMask
        </button>
      </div>
      <span class="knoww-pf-empty-sub">
        No browser wallet yet? Install MetaMask, refresh this page, then choose Find wallets.
      </span>
    `;
    }

    return `
    <div class="knoww-portfolio-wallets">
      ${wallets
        .map(
          (wallet) => `
            <button
              type="button"
              class="knoww-portfolio-wallet"
              data-connect-portfolio-wallet
              data-wallet-uuid="${escapeHtml(wallet.uuid)}"
            >
              ${
                wallet.icon
                  ? `<img src="${escapeHtml(wallet.icon)}" alt="" />`
                  : `<span>${escapeHtml(wallet.name.slice(0, 1))}</span>`
              }
              <strong>${escapeHtml(wallet.name)}</strong>
            </button>
          `
        )
        .join("")}
      ${renderPortfolioMobileWalletOption()}
    </div>
    <div class="knoww-portfolio-actions">
      <button type="button" class="knoww-portfolio-open" data-refresh-portfolio-wallets>
        Refresh wallets
      </button>
      <button type="button" class="knoww-portfolio-open" data-open-portfolio>
        Open portfolio
      </button>
    </div>
  `;
  }

  function renderPortfolioSignedOut(): string {
    // Pre-connect: just a clean wallet picker. We can't tell a new user from a
    // returning one until they connect, so we don't surface any setup steps yet.
    const wallets = portfolioWallets || [];
    const hasError = Boolean(portfolioConnectError);
    return `
    <div class="knoww-portfolio-signed-out">
      <div class="knoww-pf-empty-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M19 7V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-1"></path><path d="M21 11h-5a2 2 0 0 0 0 4h5v-4Z"></path></svg>
      </div>
      <p class="knoww-pf-empty-title">Connect a wallet</p>
      <span class="knoww-pf-empty-sub ${hasError ? "is-error" : ""}">${
        hasError
          ? escapeHtml(portfolioConnectError as string)
          : "Choose a wallet on the active page to load your positions."
      }</span>
      ${renderPortfolioWalletChoices(wallets)}
    </div>
  `;
  }

  function shouldPreserveDegradedApproval(): boolean {
    return isWithinDegradedSetupTrustWindow(
      portfolioSetupConsecutiveDegradedReads + 1
    );
  }

  async function reconcileLoadedData(
    data: SetupPortfolioData,
    isCurrent: () => boolean
  ): Promise<boolean> {
    const generation = ++reconciliationGeneration;
    const ownsReconciliation = (): boolean =>
      generation === reconciliationGeneration && isCurrent();
    let committed = false;
    const previousReconciliation = reconciliationQueue;
    const transaction = (async () => {
      await previousReconciliation;
      if (!ownsReconciliation()) return;

      const [setupDismissed, setupComplete] = await Promise.all([
        readSetupDismissed(data.ownerAddress),
        readSetupComplete(data.ownerAddress),
      ]);
      if (!ownsReconciliation()) return;

      const nextDegradedReads =
        data.approvalReadStatus === "degraded"
          ? portfolioSetupConsecutiveDegradedReads + 1
          : 0;
      let nextSetupComplete = setupComplete;
      const flow = deriveSetupFlow(portfolioSetupState(data));
      let durableComplete: boolean | null = null;
      if (flow.isComplete) {
        nextSetupComplete = true;
        if (!setupComplete) durableComplete = true;
      } else if (setupComplete && data.approvalReadStatus !== "degraded") {
        nextSetupComplete = false;
        durableComplete = false;
      }

      if (durableComplete !== null) {
        if (!ownsReconciliation()) return;
        if (durableComplete) {
          await markSetupComplete(data.ownerAddress);
        } else {
          await writeSetupComplete(data.ownerAddress, false);
        }
        if (!ownsReconciliation()) return;
      }

      if (data.approvalReadStatus !== "degraded") {
        await writeSetupMilestones(data.ownerAddress, {
          tradingWalletDeployed: data.hasTradingWallet,
          hasCredentials: data.hasTradingCredentials,
          hasApproval: data.hasApproval,
        });
        if (!ownsReconciliation()) return;
      }

      if (!ownsReconciliation()) return;
      portfolioOwnerAddressValue = data.ownerAddress;
      portfolioSetupDismissed = setupDismissed;
      portfolioSetupComplete = nextSetupComplete;
      portfolioSetupConsecutiveDegradedReads = nextDegradedReads;
      committed = true;
    })();
    reconciliationQueue = transaction.then(
      () => {},
      () => {}
    );
    await transaction;
    return committed;
  }

  async function prepareSignedOut(): Promise<void> {
    if (!portfolioWallets) portfolioWallets = await getPortfolioWallets();
  }

  function reset(): void {
    reconciliationGeneration++;
    portfolioOwnerAddressValue = null;
    portfolioConnectError = null;
    portfolioTradingError = null;
    portfolioSetupConsecutiveDegradedReads = 0;
    portfolioWallets = null;
    portfolioWalletConnectActive = false;
    portfolioWalletConnectToken++;
    portfolioWalletConnectQr = null;
    portfolioWalletConnectError = null;
  }

  function handleClick(event: Event): boolean {
    const target = event.target as Element | null;
    const portfolioConnect = target?.closest<HTMLElement>(
      "[data-connect-portfolio-wallet]"
    );
    if (portfolioConnect) {
      const walletUuid = portfolioConnect.dataset.walletUuid;
      if (walletUuid) void connectPortfolioWallet(walletUuid);
      return true;
    }
    if (target?.closest("[data-connect-portfolio-walletconnect]")) {
      void connectPortfolioWalletConnect();
      return true;
    }
    if (target?.closest("[data-walletconnect-cancel]")) {
      cancelPortfolioWalletConnect();
      return true;
    }
    if (target?.closest("[data-refresh-portfolio-wallets]")) {
      portfolioWallets = null;
      void dependencies.reloadPortfolio();
      return true;
    }
    if (target?.closest("[data-install-metamask]")) {
      void sendRuntimeMessage({
        type: "analytics:track",
        event: "wallet_install_clicked",
        properties: {
          provider: "metamask",
          product: "extension",
          surface: "portfolio_sidepanel",
        },
      });
      void chrome.tabs.create({ url: ONBOARDING_METAMASK_INSTALL_URL });
      return true;
    }
    const deploy = target?.closest<HTMLElement>(
      "[data-deploy-portfolio-trading-wallet]"
    );
    if (deploy) {
      const ownerAddress = deploy.dataset.ownerAddress;
      if (ownerAddress) void deployPortfolioTradingWallet(ownerAddress);
      return true;
    }
    const enable = target?.closest<HTMLElement>(
      "[data-enable-portfolio-trading]"
    );
    if (enable) {
      const ownerAddress = enable.dataset.ownerAddress;
      if (ownerAddress) void enablePortfolioTrading(ownerAddress);
      return true;
    }
    const approve = target?.closest<HTMLElement>("[data-setup-approve]");
    if (approve) {
      const ownerAddress = approve.dataset.ownerAddress;
      const input = dependencies.root.querySelector<HTMLInputElement>(
        "[data-setup-approve-input]"
      );
      const amount = (input?.value || "").trim() || SETUP_APPROVAL_DEFAULT;
      if (ownerAddress) void approvePortfolioTrading(ownerAddress, amount);
      return true;
    }
    if (target?.closest("[data-setup-add-funds]")) {
      dependencies.openFunding("deposit");
      return true;
    }
    if (target?.closest("[data-dismiss-setup]")) {
      const owner = portfolioOwnerAddress();
      portfolioSetupDismissed = true;
      if (owner) void writeSetupDismissed(owner, true);
      dependencies.renderPortfolio();
      return true;
    }
    if (target?.closest("[data-resume-setup]")) {
      const owner = portfolioOwnerAddress();
      portfolioSetupDismissed = false;
      if (owner) void writeSetupDismissed(owner, false);
      dependencies.renderPortfolio();
      return true;
    }
    const switchButton = target?.closest<HTMLButtonElement>(
      "[data-portfolio-switch-wallet]"
    );
    if (switchButton) {
      void switchPortfolioWallet(switchButton);
      return true;
    }
    const disconnect = target?.closest<HTMLButtonElement>(
      "[data-portfolio-disconnect]"
    );
    if (disconnect) {
      void disconnectPortfolioWallet(disconnect);
      return true;
    }
    return false;
  }

  return {
    resolvePreferredWalletMode: resolvePreferredPortfolioWalletMode,
    reauthSession: reauthPortfolioSession,
    getSessionAddress: getPortfolioSessionAddress,
    getWallets: getPortfolioWallets,
    getTradingStatus: getPortfolioTradingStatus,
    resolveWallet: resolvePortfolioWallet,
    hasApproval: hasPortfolioApproval,
    shouldPreserveDegradedApproval,
    reconcileLoadedData,
    renderSurface: renderPortfolioSetupSurface,
    renderSignedOut: renderPortfolioSignedOut,
    prepareSignedOut,
    clearConnectionErrors() {
      portfolioConnectError = null;
      portfolioTradingError = null;
    },
    clearTradingError() {
      portfolioTradingError = null;
    },
    reset,
    handleClick,
  };
}
