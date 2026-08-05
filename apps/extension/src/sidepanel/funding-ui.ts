import {
  buildBridgeTokenIndex,
  CHAIN_METADATA,
  formatCheckoutTime,
  getAvailableTokensForChain,
  isPusdToken,
  type SupportedAsset,
  WITHDRAW_CHAIN_IDS,
  WITHDRAW_TOKEN_CONFIGS,
} from "@knoww/shared-types/bridge";
import { Decimal } from "decimal.js";
import {
  createFundingController,
  type FundingController,
  type FundingError,
  type FundingQuote,
  type FundingState,
  type FundingToken,
} from "../funding";
import {
  createSidepanelFundingGateway,
  type SidepanelWalletTokenSource,
} from "../funding/gateways/sidepanel-gateway";
import { sendRuntimeMessage } from "./messaging";
import {
  escapeHtml,
  formatAddress,
  formatDecimalMoney,
  formatMoney,
  type TradingWalletMode,
} from "./shared";

export const FUNDING_UI_STYLES = `
      /* ---- Deposit / Withdraw ---- */
      .knoww-pf-fund-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      .knoww-pf-fund-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        height: 40px;
        border: 1px solid var(--pf-line-2);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.04);
        color: var(--pf-hi);
        cursor: pointer;
        font: 600 11px/1 var(--pf-mono);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        transition: color 0.15s ease, background 0.15s ease,
          border-color 0.15s ease;
      }

      .knoww-pf-fund-btn svg {
        width: 14px;
        height: 14px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .knoww-pf-fund-btn:hover {
        border-color: rgba(255, 255, 255, 0.28);
        background: rgba(255, 255, 255, 0.08);
      }

      .knoww-pf-fund-btn.primary {
        border-color: rgba(52, 211, 153, 0.5);
        background: rgba(52, 211, 153, 0.16);
        color: #eafff5;
      }

      .knoww-pf-fund-btn.primary:hover {
        border-color: rgba(52, 211, 153, 0.72);
        background: rgba(52, 211, 153, 0.24);
        color: #fff;
      }

      /* ---- Deposit / Withdraw form ---- */
      .knoww-pf-fund {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }

      /* Per-action accent. Deposit = emerald (incoming), withdraw = gold
         (outgoing). Drives the kicker, focus rings, prefix, chips and submit so
         each modal has its own colour identity. */
      .knoww-pf-fund.is-deposit {
        --pf-accent: #34d399;
        --pf-accent-strong: #5ff0bb;
        --pf-accent-border: rgba(52, 211, 153, 0.5);
        --pf-accent-bg: rgba(52, 211, 153, 0.16);
        --pf-accent-bg-hover: rgba(52, 211, 153, 0.24);
        --pf-accent-tint: rgba(52, 211, 153, 0.1);
        --pf-accent-text: #eafff5;
      }

      .knoww-pf-fund.is-withdraw {
        --pf-accent: #f7c948;
        --pf-accent-strong: #ffd968;
        --pf-accent-border: rgba(247, 201, 72, 0.52);
        --pf-accent-bg: rgba(247, 201, 72, 0.16);
        --pf-accent-bg-hover: rgba(247, 201, 72, 0.24);
        --pf-accent-tint: rgba(247, 201, 72, 0.1);
        --pf-accent-text: #fff6df;
      }

      .knoww-pf-fund-head {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .knoww-pf-fund-back {
        flex: none;
        display: grid;
        place-items: center;
        width: 30px;
        height: 30px;
        border: 1px solid var(--pf-line-2);
        border-radius: 9px;
        background: rgba(255, 255, 255, 0.04);
        color: var(--pf-mid);
        cursor: pointer;
        transition: color 0.14s ease, background 0.14s ease;
      }

      .knoww-pf-fund-back:hover {
        color: var(--pf-accent, var(--pf-hi));
        border-color: var(--pf-accent-border, var(--pf-line-2));
        background: var(--pf-accent-tint, rgba(255, 255, 255, 0.08));
      }

      .knoww-pf-fund-back svg {
        width: 16px;
        height: 16px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .knoww-pf-fund-kicker {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font: 600 10px/1 var(--pf-mono);
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--pf-accent, var(--pf-dim));
      }

      .knoww-pf-fund-kicker::before {
        content: "";
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: var(--pf-accent, var(--pf-dim));
        box-shadow: 0 0 0 3px var(--pf-accent-tint, transparent);
      }

      .knoww-pf-fund-sub {
        margin: 4px 0 0;
        font: 500 12px/1.4 var(--pf-sans);
        color: var(--pf-mid);
      }

      .knoww-pf-fund-field {
        display: flex;
        flex-direction: column;
        gap: 7px;
      }

      .knoww-pf-fund-field-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font: 600 10.5px/1 var(--pf-mono);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--pf-mid);
      }

      .knoww-pf-fund-max {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        border: 0;
        background: transparent;
        color: var(--pf-mid);
        cursor: pointer;
        font: inherit;
        letter-spacing: inherit;
        text-transform: inherit;
      }

      .knoww-pf-fund-max strong {
        color: var(--pf-hi);
        font-variant-numeric: tabular-nums;
      }

      .knoww-pf-fund-max:hover {
        color: var(--pf-hi);
      }

      /* The "Use my wallet" shortcut reads as an action, so it carries the
         modal's accent rather than the muted tone of the read-only Max chip. */
      .knoww-pf-fund-max[data-fund-use-eoa] {
        color: var(--pf-accent, var(--pf-mid));
      }

      .knoww-pf-fund-max[data-fund-use-eoa]:hover {
        color: var(--pf-accent-strong, var(--pf-hi));
      }

      /* Read-only "Available / Balance" figure — the actionable Max now lives
         inside the amount box. */
      .knoww-pf-fund-avail {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        color: var(--pf-mid);
      }

      .knoww-pf-fund-avail strong {
        color: var(--pf-hi);
        font-variant-numeric: tabular-nums;
      }

      .knoww-pf-fund-amount {
        display: flex;
        align-items: center;
        gap: 8px;
        border: 1px solid var(--pf-line-2);
        border-radius: 12px;
        background: rgba(0, 0, 0, 0.2);
        padding: 0 14px;
        transition: border-color 0.14s ease, box-shadow 0.14s ease;
      }

      .knoww-pf-fund-amount:focus-within {
        border-color: var(--pf-accent-border, rgba(255, 255, 255, 0.32));
        box-shadow: 0 0 0 3px var(--pf-accent-tint, transparent);
      }

      .knoww-pf-fund-amount span {
        color: var(--pf-accent, var(--pf-mid));
        font: 600 20px/1 var(--pf-mono);
      }

      .knoww-pf-fund-amount input {
        flex: 1;
        min-width: 0;
        height: 50px;
        border: 0;
        outline: none;
        background: transparent;
        color: var(--pf-hi);
        font: 500 22px/1 var(--pf-mono);
        font-variant-numeric: tabular-nums;
      }

      .knoww-pf-fund-amount input::placeholder,
      .knoww-pf-fund-dest::placeholder {
        color: rgba(255, 255, 255, 0.32);
      }

      /* In-box Max: carries the modal accent and snaps the amount to the full
         available balance. */
      .knoww-pf-amount-max {
        flex: 0 0 auto;
        align-self: center;
        padding: 6px 11px;
        border: 1px solid var(--pf-accent-border, var(--pf-line-2));
        border-radius: 9px;
        background: var(--pf-accent-tint, rgba(255, 255, 255, 0.06));
        color: var(--pf-accent, var(--pf-hi));
        cursor: pointer;
        font: 700 10px/1 var(--pf-mono);
        letter-spacing: 0.12em;
        text-transform: uppercase;
        transition: background 0.14s ease, border-color 0.14s ease;
      }

      .knoww-pf-amount-max:hover {
        background: var(--pf-accent-bg, rgba(255, 255, 255, 0.12));
        border-color: var(--pf-accent, var(--pf-line-2));
      }

      .knoww-pf-amount-max:active {
        transform: translateY(0.5px);
      }

      .knoww-pf-fund-dest {
        height: 42px;
        border: 1px solid var(--pf-line-2);
        border-radius: 12px;
        background: rgba(0, 0, 0, 0.2);
        outline: none;
        padding: 0 14px;
        color: var(--pf-hi);
        font: 500 12px/1 var(--pf-mono);
      }

      .knoww-pf-fund-dest:focus {
        border-color: var(--pf-accent-border, rgba(255, 255, 255, 0.32));
        box-shadow: 0 0 0 3px var(--pf-accent-tint, transparent);
      }

      .knoww-pf-fund-hint {
        margin-top: 2px;
        color: var(--pf-dim);
        font: 500 10.5px/1.4 var(--pf-sans);
        letter-spacing: 0.01em;
      }

      .knoww-pf-fund-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }

      .knoww-pf-fund-row .knoww-pf-fund-field {
        min-width: 0;
      }

      .knoww-pf-fund-select {
        position: relative;
        display: flex;
        align-items: center;
      }

      .knoww-pf-fund-select select {
        appearance: none;
        width: 100%;
        height: 44px;
        border: 1px solid var(--pf-line-2);
        border-radius: 12px;
        background: rgba(0, 0, 0, 0.2);
        outline: none;
        padding: 0 36px 0 14px;
        color: var(--pf-hi);
        font: 600 12px/1 var(--pf-sans);
        cursor: pointer;
      }

      .knoww-pf-fund-select select:focus {
        border-color: var(--pf-accent-border, rgba(255, 255, 255, 0.32));
        box-shadow: 0 0 0 3px var(--pf-accent-tint, transparent);
      }

      .knoww-pf-fund-select svg {
        position: absolute;
        right: 13px;
        width: 16px;
        height: 16px;
        fill: none;
        stroke: var(--pf-mid);
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
        pointer-events: none;
      }

      .knoww-pf-fund-status {
        border-radius: 10px;
        padding: 10px 12px;
        font: 500 11px/1.4 var(--pf-sans);
      }

      .knoww-pf-fund-status.is-info {
        background: rgba(255, 255, 255, 0.05);
        color: var(--pf-mid);
      }

      .knoww-pf-fund-status.is-error {
        background: rgba(251, 113, 133, 0.12);
        color: var(--pf-neg);
      }

      .knoww-pf-fund-status.is-success {
        background: rgba(52, 211, 153, 0.12);
        color: var(--pf-pos);
      }

      .knoww-pf-withdraw-quote {
        display: grid;
        gap: 8px;
        border: 1px solid rgba(59, 130, 246, 0.38);
        border-radius: 10px;
        background: rgba(37, 99, 235, 0.12);
        padding: 10px 12px;
      }

      .knoww-pf-withdraw-quote[hidden] {
        display: none;
      }

      .knoww-pf-withdraw-quote.is-error {
        border-color: rgba(251, 113, 133, 0.36);
        background: rgba(251, 113, 133, 0.12);
      }

      .knoww-pf-withdraw-quote-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        font: 500 11px/1.3 var(--pf-sans);
        color: var(--pf-mid);
      }

      .knoww-pf-withdraw-quote-row span:first-child {
        font: 600 9px/1 var(--pf-mono);
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--pf-dim);
      }

      .knoww-pf-withdraw-quote-row strong {
        min-width: 0;
        text-align: right;
        color: var(--pf-hi);
        overflow-wrap: anywhere;
      }

      .knoww-pf-fund-submit {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 9px;
        height: 44px;
        border: 1px solid var(--pf-accent-border, var(--pf-line-2));
        border-radius: 12px;
        background: var(--pf-accent-bg, rgba(255, 255, 255, 0.06));
        color: var(--pf-accent-text, var(--pf-hi));
        cursor: pointer;
        font: 600 11px/1 var(--pf-mono);
        letter-spacing: 0.12em;
        text-transform: uppercase;
        transition: background 0.15s ease, border-color 0.15s ease,
          opacity 0.15s ease;
      }

      .knoww-pf-fund-submit.primary {
        border-color: rgba(52, 211, 153, 0.5);
        background: rgba(52, 211, 153, 0.18);
        color: #eafff5;
      }

      .knoww-pf-fund-submit:hover:not(:disabled) {
        background: var(--pf-accent-bg-hover, rgba(255, 255, 255, 0.1));
      }

      .knoww-pf-fund-submit.primary:hover:not(:disabled) {
        background: rgba(52, 211, 153, 0.26);
      }

      .knoww-pf-fund-submit:disabled {
        cursor: default;
        opacity: 0.55;
      }

      /* Loading: stay bright (it's working, not unavailable) and run a thin
         rotating ring in the modal's accent colour next to a live label. */
      .knoww-pf-fund-submit.is-loading {
        cursor: progress;
        opacity: 1;
      }

      .knoww-pf-fund-submit.is-loading.primary {
        background: rgba(52, 211, 153, 0.22);
      }

      .knoww-pf-submit-spinner {
        display: none;
        width: 14px;
        height: 14px;
        flex: 0 0 auto;
        border-radius: 50%;
        border: 2px solid rgba(255, 255, 255, 0.22);
        border-top-color: currentColor;
        animation: knoww-pf-spin 0.7s linear infinite;
      }

      .knoww-pf-fund-submit.is-loading .knoww-pf-submit-spinner {
        display: inline-block;
      }

      .knoww-pf-submit-label {
        display: inline-block;
      }

      @media (prefers-reduced-motion: reduce) {
        .knoww-pf-submit-spinner {
          animation-duration: 1.6s;
        }
      }

      /* ---- Deposit method + token lists ---- */
      .knoww-pf-method-list,
      .knoww-pf-token-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .knoww-pf-method {
        display: grid;
        grid-template-columns: 22px minmax(0, 1fr) auto;
        align-items: center;
        gap: 12px;
        border: 1px solid var(--pf-line-2);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.03);
        cursor: pointer;
        padding: 12px 14px;
        text-align: left;
        transition: border-color 0.14s ease, background 0.14s ease;
      }

      .knoww-pf-method:hover:not(:disabled) {
        border-color: rgba(255, 255, 255, 0.28);
        background: rgba(255, 255, 255, 0.06);
      }

      .knoww-pf-method.is-soon {
        cursor: default;
        opacity: 0.5;
      }

      .knoww-pf-method-n {
        font: 600 11px/1 var(--pf-mono);
        color: var(--pf-accent, var(--pf-dim));
        font-variant-numeric: tabular-nums;
      }

      .knoww-pf-method:hover:not(:disabled) .knoww-pf-method-arrow {
        stroke: var(--pf-accent, var(--pf-dim));
      }

      .knoww-pf-method.is-soon .knoww-pf-method-n {
        color: var(--pf-dim);
      }

      .knoww-pf-method-main {
        min-width: 0;
        display: grid;
        gap: 3px;
      }

      .knoww-pf-method-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font: 600 14px/1.1 var(--pf-sans);
        color: var(--pf-hi);
      }

      .knoww-pf-method-meta {
        font: 500 10px/1 var(--pf-mono);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--pf-mid);
      }

      .knoww-pf-method-arrow {
        width: 14px;
        height: 14px;
        fill: none;
        stroke: var(--pf-dim);
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      .knoww-pf-method-soon {
        border: 1px solid rgba(245, 191, 36, 0.4);
        border-radius: 999px;
        padding: 3px 7px;
        font: 600 9px/1 var(--pf-mono);
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: rgba(245, 191, 36, 0.85);
      }

      .knoww-pf-token {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 12px;
        border: 1px solid var(--pf-line);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.03);
        cursor: pointer;
        padding: 12px 14px;
        text-align: left;
        transition: border-color 0.14s ease, background 0.14s ease;
      }

      .knoww-pf-token:hover:not(.is-disabled) {
        border-color: rgba(255, 255, 255, 0.26);
        background: rgba(255, 255, 255, 0.06);
      }

      .knoww-pf-token.is-disabled {
        cursor: default;
        opacity: 0.42;
      }

      .knoww-pf-token.is-disabled .knoww-pf-token-min {
        color: var(--pf-neg);
      }

      .knoww-pf-token-id {
        min-width: 0;
        display: grid;
        gap: 3px;
      }

      .knoww-pf-token-sym {
        font: 600 14px/1 var(--pf-sans);
        color: var(--pf-hi);
      }

      .knoww-pf-token-bal {
        font: 500 12px/1 var(--pf-mono);
        color: rgba(255, 255, 255, 0.8);
        font-variant-numeric: tabular-nums;
      }

      .knoww-pf-token-meta {
        display: grid;
        gap: 3px;
        justify-items: end;
      }

      .knoww-pf-token-meta strong {
        font: 600 14px/1 var(--pf-mono);
        color: var(--pf-hi);
        font-variant-numeric: tabular-nums;
      }

      .knoww-pf-token-min {
        font: 600 10.5px/1 var(--pf-mono);
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(245, 191, 36, 0.92);
      }

`;

export interface FundingPortfolioData {
  address: string;
  ownerAddress: string;
  cashBalance: number;
}

export interface FundingUiDependencies {
  root: HTMLElement;
  getPortfolioData(): FundingPortfolioData | null;
  reloadPortfolio(): Promise<void>;
  renderPortfolio(): void;
  resolvePreferredWalletMode(address: string): Promise<TradingWalletMode>;
  reauthSession(address: string): Promise<{ ok: boolean; error?: string }>;
}

export interface FundingUiHandle {
  isOpen(): boolean;
  open(action: "deposit" | "withdraw"): void;
  close(): void;
  renderActions(): string;
  resetAccount(): void;
  handleChange(event: Event): boolean;
  handleInput(event: Event): boolean;
  handleClick(event: Event): boolean;
  dispose(): void;
}

const KNOWW_APP_URL = __DEV_MODE__
  ? "http://localhost:8000"
  : "https://knoww.app";
const PORTFOLIO_AMOUNT_DECIMALS = 6;
const WITHDRAW_QUOTE_DEBOUNCE_MS = 350;
const WITHDRAW_STATUS_POLL_MS = 4500;
// Ceiling for the pre-START wallet-mode probe (service worker → offscreen → RPC).
const FUND_WALLET_MODE_TIMEOUT_MS = 15000;

export function createFundingUi(
  dependencies: FundingUiDependencies
): FundingUiHandle {
  let portfolioFundRefreshRun = 0;
  const portfolioFundRefreshTimers: ReturnType<typeof setTimeout>[] = [];
  type PortfolioFundAction = "deposit" | "withdraw";

  interface PortfolioWithdrawFormParams {
    amount: string;
    amountDecimal: Decimal;
    chainKey: string;
    tokenId: string;
    destination: string;
  }

  // The pure funding machine (src/funding) now owns the deposit/withdraw flow
  // state (step, selected token, amount, quote, submit/confirm progress). The
  // side panel keeps only: the bridge-asset cache used to fill the withdraw and
  // cross-chain deposit dropdowns, the controller instance, a "which action
  // opened the view" label used for presentation/side-effects (NOT flow
  // branching), which deposit token source is on screen (wallet list vs the
  // cross-chain "Transfer Crypto" form — presentation only; the machine's
  // loadTokens effect carries the same source), and the last-rendered screen
  // key that gates full innerHTML swaps.
  let portfolioBridgeAssets: SupportedAsset[] | null = null;
  let fundController: FundingController | null = null;
  let fundFlow: PortfolioFundAction | null = null;
  let fundDepositSource: "wallet" | "cross-chain" = "wallet";
  let lastFundScreenKey: string | null = null;
  // Bumped by every open and by every teardown (close / reset / account change /
  // post-submit refresh). The async wallet-mode probe in openPortfolioFunds
  // compares against it so a stale probe can never dispatch into a view the user
  // has since left, and — the other direction — so a teardown that lands mid
  // probe can't silently abandon a view that is still on screen.
  let fundOpenToken = 0;
  // The one in-flight wallet-mode round trip, shared per address so a Retry
  // issued while a slow probe is still pending latches onto it instead of
  // stacking another RPC call. Cleared when the round trip settles.
  let pendingWalletModeProbe: {
    address: string;
    probe: Promise<TradingWalletMode | null>;
  } | null = null;

  function getPortfolioContainer(): HTMLElement | null {
    return (
      dependencies.root.querySelector<HTMLElement>(
        "[data-sidepanel-portfolio]"
      ) ?? null
    );
  }

  function formatTokenAmount(amount: number): string {
    if (!Number.isFinite(amount)) return "0";
    if (amount === 0) return "0";
    if (amount >= 1000) return amount.toLocaleString("en-US");
    return amount
      .toLocaleString("en-US", { maximumFractionDigits: 5 })
      .replace(/\.?0+$/, "");
  }

  // knoww.app is only the fallback when there's no content tab to sign through.
  function openPortfolioFundsFallback(action: PortfolioFundAction): void {
    window.open(
      `${KNOWW_APP_URL}/portfolio?fund=${action}`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  // Submit button carries an inline spinner + a swappable label. `data-idle-label`
  // lets the busy-state toggle restore the original text without re-rendering.
  function renderFundSubmitButton(label: string, primary: boolean): string {
    return `
    <button type="button" class="knoww-pf-fund-submit${
      primary ? " primary" : ""
    }" data-fund-submit data-idle-label="${escapeHtml(label)}">
      <span class="knoww-pf-submit-spinner" aria-hidden="true"></span>
      <span class="knoww-pf-submit-label">${escapeHtml(label)}</span>
    </button>`;
  }

  function setFundSubmitLoading(loading: boolean, loadingLabel?: string): void {
    const container = getPortfolioContainer();
    const btn =
      container?.querySelector<HTMLButtonElement>("[data-fund-submit]");
    if (!btn) return;
    const labelEl = btn.querySelector<HTMLElement>(".knoww-pf-submit-label");
    btn.classList.toggle("is-loading", loading);
    btn.disabled = loading;
    if (labelEl) {
      labelEl.textContent = loading
        ? (loadingLabel ?? "Working…")
        : btn.dataset.idleLabel || labelEl.textContent || "";
    }
  }

  function renderPortfolioFundForm(
    action: PortfolioFundAction,
    data: FundingPortfolioData
  ): string {
    const isDeposit = action === "deposit";
    const title = isDeposit ? "Deposit" : "Withdraw";
    const sub = isDeposit
      ? "Deposit from any supported chain into your trading balance."
      : "Withdraw to any supported chain and token.";
    const chainLabel = isDeposit ? "From chain" : "To chain";
    const eoa = data.ownerAddress;
    return `
    <div class="knoww-pf-fund ${isDeposit ? "is-deposit" : "is-withdraw"}">
      <div class="knoww-pf-fund-head">
        <button type="button" class="knoww-pf-fund-back" data-fund-back aria-label="Back to portfolio">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg>
        </button>
        <div class="knoww-pf-fund-heading">
          <span class="knoww-pf-fund-kicker">${escapeHtml(title)}</span>
          <p class="knoww-pf-fund-sub">${escapeHtml(sub)}</p>
        </div>
      </div>
      <div class="knoww-pf-fund-row">
        ${renderFundSelectField(chainLabel, "data-fund-chain")}
        ${renderFundSelectField("Token", "data-fund-token")}
      </div>
      <div class="knoww-pf-fund-field">
        <div class="knoww-pf-fund-field-top">
          <span>Amount</span>
          ${
            isDeposit
              ? ""
              : `<span class="knoww-pf-fund-avail">Available <strong data-fund-avail data-value="${escapeHtml(
                  String(data.cashBalance ?? 0)
                )}">${escapeHtml(formatMoney(data.cashBalance))}</strong></span>`
          }
        </div>
        <div class="knoww-pf-fund-amount">
          <span class="knoww-pf-fund-cur">$</span>
          <input type="text" inputmode="decimal" placeholder="0.00" data-fund-amount autocomplete="off" />
          ${
            isDeposit
              ? ""
              : `<button type="button" class="knoww-pf-amount-max" data-fund-max>Max</button>`
          }
        </div>
      </div>
      ${
        isDeposit
          ? ""
          : `
      <div class="knoww-pf-fund-field">
        <div class="knoww-pf-fund-field-top">
          <span>Recipient address</span>
          <button type="button" class="knoww-pf-fund-max" data-fund-use-eoa data-eoa="${escapeHtml(eoa)}" data-fund-dest-chip>Use my wallet</button>
        </div>
        <input type="text" class="knoww-pf-fund-dest" value="${escapeHtml(eoa)}" placeholder="Recipient wallet on the chosen chain" data-fund-dest data-eoa="${escapeHtml(eoa)}" autocomplete="off" spellcheck="false" />
        <span class="knoww-pf-fund-hint" data-fund-dest-hint>Sends to your connected wallet by default — edit to withdraw elsewhere.</span>
      </div>`
      }
      ${
        isDeposit
          ? ""
          : `<div class="knoww-pf-withdraw-quote" data-withdraw-quote hidden></div>`
      }
      <div class="knoww-pf-fund-status" data-fund-status hidden></div>
      ${renderFundSubmitButton(title, isDeposit)}
    </div>
  `;
  }

  function renderFundSelectField(label: string, dataAttr: string): string {
    return `
    <div class="knoww-pf-fund-field">
      <div class="knoww-pf-fund-field-top"><span>${escapeHtml(label)}</span></div>
      <div class="knoww-pf-fund-select">
        <select ${dataAttr} aria-label="${escapeHtml(label)}">
          <option value="">Loading…</option>
        </select>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>
      </div>
    </div>`;
  }

  function optionHtml(value: string, label: string, selected: boolean): string {
    return `<option value="${escapeHtml(value)}"${
      selected ? " selected" : ""
    }>${escapeHtml(label)}</option>`;
  }

  // Withdraw destination chain dropdown options. (The deposit flow no longer
  // uses these dropdowns — it runs entirely through the funding controller/
  // machine's own step renderers — so this only ever needs the withdraw
  // chain-key set. Destination chains mirror the web's static set; per-chain
  // tokens are still resolved from the live /supported-assets API (see
  // fundTokenOptions).)
  function fundChainOptions(): string {
    const out: string[] = [];
    for (const chainKey of Object.keys(WITHDRAW_CHAIN_IDS)) {
      const chainId = WITHDRAW_CHAIN_IDS[chainKey];
      const name = CHAIN_METADATA[chainId]?.name ?? chainKey;
      out.push(optionHtml(chainKey, name, chainKey === "polygon"));
    }
    return out.join("") || optionHtml("polygon", "Polygon", true);
  }

  // Withdraw token dropdown options for the currently-selected chain.
  function fundTokenOptions(
    assets: SupportedAsset[],
    chainValue: string
  ): string {
    const index = buildBridgeTokenIndex(assets);
    const out: string[] = [];
    for (const tokenId of getAvailableTokensForChain(index, chainValue)) {
      const cfg = WITHDRAW_TOKEN_CONFIGS[tokenId];
      if (!cfg) continue;
      out.push(optionHtml(tokenId, cfg.symbol, tokenId === "usdc-e"));
    }
    return out.join("") || optionHtml("usdc", "USDC", true);
  }

  function fillFundTokenSelect(
    container: HTMLElement,
    assets: SupportedAsset[]
  ): void {
    const chain =
      container.querySelector<HTMLSelectElement>("[data-fund-chain]")?.value ||
      "";
    const tokenSelect =
      container.querySelector<HTMLSelectElement>("[data-fund-token]");
    if (tokenSelect) {
      tokenSelect.innerHTML = fundTokenOptions(assets, chain);
    }
  }

  // The recipient defaults to the connected EVM wallet, but a Solana destination
  // can't receive a 0x address. When the chain flips to/from Solana, swap the
  // auto-filled EOA for an empty Solana field (and back) and hide the "Use my
  // wallet" shortcut — but never clobber an address the user typed themselves.
  function syncFundRecipientForChain(container: HTMLElement): void {
    const dest = container.querySelector<HTMLInputElement>("[data-fund-dest]");
    if (!dest) return;
    const chainValue =
      container.querySelector<HTMLSelectElement>("[data-fund-chain]")?.value ||
      "";
    const isSolana = chainValue === "solana";
    const eoa = dest.dataset.eoa || "";
    const chip = container.querySelector<HTMLElement>("[data-fund-dest-chip]");
    const hint = container.querySelector<HTMLElement>("[data-fund-dest-hint]");

    if (isSolana) {
      if (dest.value === eoa) dest.value = "";
      dest.placeholder = "Solana recipient address";
      if (chip) chip.hidden = true;
      if (hint) hint.textContent = "Paste the Solana wallet to receive funds.";
    } else {
      if (dest.value === "") dest.value = eoa;
      dest.placeholder = "Recipient wallet on the chosen chain";
      if (chip) chip.hidden = false;
      if (hint) {
        hint.textContent =
          "Sends to your connected wallet by default — edit to withdraw elsewhere.";
      }
    }
  }

  async function loadPortfolioBridgeAssets(): Promise<void> {
    const container = getPortfolioContainer();
    const chainSelect =
      container?.querySelector<HTMLSelectElement>("[data-fund-chain]");
    if (!container || !chainSelect) return;
    let assets = portfolioBridgeAssets;
    if (!assets) {
      const response = await sendRuntimeMessage({
        type: "KNOWW_PORTFOLIO_BRIDGE_ASSETS",
      });
      assets =
        (response.data as { assets?: SupportedAsset[] } | undefined)?.assets ??
        [];
      if (assets.length) portfolioBridgeAssets = assets;
    }
    // Only the withdraw amount screen uses these dropdowns now (the passive/bridge
    // deposit path is not offered in the side panel).
    if (!withdrawFormActive()) return;
    chainSelect.innerHTML = fundChainOptions();
    fillFundTokenSelect(container, assets);
  }

  // ── Deposit method screen (Wallet / Transfer Crypto / coming soon) ──
  function renderDepositMethodRow(
    n: string,
    id: string,
    name: string,
    meta: string,
    soon: boolean
  ): string {
    return `
    <button type="button" class="knoww-pf-method${soon ? " is-soon" : ""}"${
      soon ? " disabled" : ` data-deposit-method="${id}"`
    }>
      <span class="knoww-pf-method-n">${escapeHtml(n)}</span>
      <span class="knoww-pf-method-main">
        <span class="knoww-pf-method-name">${escapeHtml(name)}</span>
        <span class="knoww-pf-method-meta">${escapeHtml(meta)}</span>
      </span>
      ${
        soon
          ? `<span class="knoww-pf-method-soon">Soon</span>`
          : `<svg class="knoww-pf-method-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>`
      }
    </button>`;
  }

  function renderDepositMethod(data: FundingPortfolioData): string {
    const addr = formatAddress(data.ownerAddress);
    return `
    <div class="knoww-pf-fund is-deposit">
      <div class="knoww-pf-fund-head">
        <button type="button" class="knoww-pf-fund-back" data-fund-back aria-label="Back to portfolio">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg>
        </button>
        <div class="knoww-pf-fund-heading">
          <span class="knoww-pf-fund-kicker">Deposit · Method</span>
          <p class="knoww-pf-fund-sub">${escapeHtml(formatMoney(data.cashBalance))} balance</p>
        </div>
      </div>
      <div class="knoww-pf-method-list">
        ${renderDepositMethodRow("01", "wallet", `Wallet · ${addr}`, "Polygon · Instant", false)}
        ${renderDepositMethodRow("02", "bridge", "Transfer Crypto", "All chains · Instant", false)}
        ${renderDepositMethodRow("03", "", "Deposit with Card", "Up to $50,000 · ~5 min", true)}
        ${renderDepositMethodRow("04", "", "Connect Exchange", "No limit · ~2 min", true)}
        ${renderDepositMethodRow("05", "", "Deposit with PayPal", "Up to $10,000 · ~5 min", true)}
      </div>
    </div>`;
  }

  function renderDepositTokenList(
    state: Extract<FundingState, { step: "select-token" }>
  ): string {
    let body: string;
    if (state.loading) {
      body = `<div class="knoww-pf-fund-status is-info">Loading your wallet…</div>`;
    } else if (state.error) {
      body = `<div class="knoww-pf-fund-status is-error">${escapeHtml(fundErrorCopy(state.error))}</div>`;
    } else if (state.tokens.length === 0) {
      body = `<div class="knoww-pf-fund-status is-info">No deposit tokens found in your wallet on Polygon.</div>`;
    } else {
      body = state.tokens
        .map((t, i) => {
          // Monetary fields are decimal strings on FundingToken; parse for the
          // display comparisons (the machine already normalized them).
          const minUsd = Number(t.minUsd);
          const usdValue = Number(t.usdValue);
          const balance = Number(t.balanceDisplay);
          // Below the bridge minimum → can't be deposited, so it isn't selectable.
          const priceUnavailable = minUsd > 0 && usdValue <= 0;
          const belowMin = !priceUnavailable && usdValue < minUsd;
          const unsupported = !t.depositSupported;
          const disabled = unsupported || priceUnavailable || belowMin;
          return `
        <button type="button" class="knoww-pf-token${
          disabled ? " is-disabled" : ""
        }"${disabled ? " disabled" : ` data-deposit-token="${i}"`}>
          <span class="knoww-pf-token-id">
            <span class="knoww-pf-token-sym">${escapeHtml(t.symbol)}</span>
            <span class="knoww-pf-token-bal">${escapeHtml(formatTokenAmount(balance))}</span>
          </span>
          <span class="knoww-pf-token-meta">
            <span class="knoww-pf-token-min">${
              unsupported
                ? escapeHtml(t.depositDisabledReason || "Unsupported")
                : priceUnavailable
                  ? "Price unavailable"
                  : `${belowMin ? "Below min" : "Min"} · ${escapeHtml(formatMoney(minUsd))}`
            }</span>
            <strong>${escapeHtml(formatMoney(usdValue))}</strong>
          </span>
        </button>`;
        })
        .join("");
    }
    return `
    <div class="knoww-pf-fund is-deposit">
      <div class="knoww-pf-fund-head">
        <button type="button" class="knoww-pf-fund-back" data-deposit-back="method" aria-label="Back to methods">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg>
        </button>
        <div class="knoww-pf-fund-heading">
          <span class="knoww-pf-fund-kicker">Deposit · Token</span>
          <p class="knoww-pf-fund-sub">Minimum varies by token · typically $2+</p>
        </div>
      </div>
      <div class="knoww-pf-token-list">${body}</div>
    </div>`;
  }

  function renderDepositAmountStep(token: FundingToken): string {
    const minUsd = Number(token.minUsd);
    const balance = Number(token.balanceDisplay);
    const sub = isPusdToken(token.symbol, token.address)
      ? "On Polygon · direct transfer"
      : `On Polygon · minimum ${formatMoney(minUsd)}`;
    return `
    <div class="knoww-pf-fund is-deposit">
      <div class="knoww-pf-fund-head">
        <button type="button" class="knoww-pf-fund-back" data-deposit-back="wallet-token" aria-label="Back to tokens">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg>
        </button>
        <div class="knoww-pf-fund-heading">
          <span class="knoww-pf-fund-kicker">Deposit · ${escapeHtml(token.symbol)}</span>
          <p class="knoww-pf-fund-sub">${escapeHtml(sub)}</p>
        </div>
      </div>
      <div class="knoww-pf-fund-field">
        <div class="knoww-pf-fund-field-top">
          <span>Amount · ${escapeHtml(token.symbol)}</span>
          <span class="knoww-pf-fund-avail">Balance <strong data-fund-avail data-value="${escapeHtml(token.balanceDisplay)}">${escapeHtml(formatTokenAmount(balance))}</strong></span>
        </div>
        <div class="knoww-pf-fund-amount">
          <span class="knoww-pf-fund-cur">${escapeHtml(token.symbol.slice(0, 4))}</span>
          <input type="text" inputmode="decimal" placeholder="0.00" data-fund-amount autocomplete="off" />
          <button type="button" class="knoww-pf-amount-max" data-fund-max>Max</button>
        </div>
      </div>
      <div class="knoww-pf-fund-status" data-fund-status hidden></div>
      ${renderFundSubmitButton(`Deposit ${token.symbol}`, true)}
    </div>`;
  }

  // ── Funding controller wiring ────────────────────────────────────────────
  // The pure funding controller (src/funding) owns the deposit/withdraw flow.
  // The side panel maps its transport onto the controller via a gateway,
  // subscribes for re-renders, and dispatches events from the DOM handlers.

  /** True while a funding flow owns the portfolio container. `fundFlow` is the
   * single source of truth: it is set for the whole open window (including the
   * pre-START wallet-mode probe, when the machine is still idle), and every
   * teardown that nulls it synchronously recycles the machine — so the machine
   * can never be non-idle while `fundFlow` is null. */
  function isFundViewOpen(): boolean {
    return fundFlow !== null;
  }

  /** Invalidates any in-flight open (see `fundOpenToken`). Every teardown path
   * that nulls `fundFlow` must call this. */
  function cancelFundOpen(): void {
    fundOpenToken += 1;
  }

  /** Shared teardown for every path that releases the funding view. Callers
   * follow with the machine event that fits the site (RESET vs ACCOUNT_CHANGED,
   * or nothing when the machine is provably idle) — keeping the
   * `isFundViewOpen` invariant above intact. */
  function resetFundOpenState(): void {
    cancelFundOpen();
    fundFlow = null;
    fundDepositSource = "wallet";
    lastFundScreenKey = null;
  }

  /** True while the withdraw form is on screen — its amount step AND its
   * confirm step (same DOM: the confirm step is the form plus the quote
   * preview and an explicit confirm button). */
  function withdrawFormActive(): boolean {
    const state = fundController?.getState();
    if (!state) return false;
    if (state.step === "amount") return state.flow === "withdraw";
    if (state.step === "confirm") return state.command.flow === "withdraw";
    return false;
  }

  function fundErrorCopy(error: FundingError): string {
    switch (error.code) {
      case "PENDING_RECONCILIATION":
        return "This transaction may already be submitted. Check your wallet and portfolio before trying again.";
      case "IDEMPOTENCY_FINGERPRINT_MISMATCH":
        return "Transaction details changed. Review the form and start a new transaction.";
      case "NO_CONTENT_TAB":
        return "Open a supported page (e.g. Polymarket) with your wallet, then retry — or finish on knoww.app.";
      default:
        // The signing relay couldn't reach the wallet's content tab — point the
        // user back to the connected page (preserves the old submit copy).
        if (isSigningBridgeUnreachable(error.message)) {
          return "Couldn't reach your wallet. Open the page where you connected it (e.g. Polymarket), keep it active, then retry.";
        }
        // AMBIGUOUS_OUTCOME/VALIDATION/QUOTE_FAILED already carry safe copy; the
        // execution/reverted cases route through the shared formatter (which maps
        // user-rejected etc.).
        return formatPortfolioTransactionError(error.message);
    }
  }

  function ensureFundController(): FundingController {
    if (fundController) return fundController;
    const gateway = createSidepanelFundingGateway({
      sendRuntimeMessage,
      loadWalletTokens: async (): Promise<SidepanelWalletTokenSource[]> => {
        const data = dependencies.getPortfolioData();
        if (!data) return [];
        const response = await sendRuntimeMessage({
          type: "KNOWW_PORTFOLIO_WALLET_TOKENS",
          address: data.ownerAddress,
        });
        return (
          (
            response.data as
              | { tokens?: SidepanelWalletTokenSource[] }
              | undefined
          )?.tokens ?? []
        );
      },
      // Backs the executable cross-chain "Transfer Crypto" deposit token list;
      // shares the same cache the withdraw dropdowns use.
      loadCrossChainAssets: async (): Promise<SupportedAsset[]> => {
        if (portfolioBridgeAssets) return portfolioBridgeAssets;
        const response = await sendRuntimeMessage({
          type: "KNOWW_PORTFOLIO_BRIDGE_ASSETS",
        });
        const assets =
          (response.data as { assets?: SupportedAsset[] } | undefined)
            ?.assets ?? [];
        if (assets.length) portfolioBridgeAssets = assets;
        return assets;
      },
      // Source fallback for loadTokens re-loads (BACK from the amount step),
      // whose machine effect carries no source.
      defaultTokenSource: () => fundDepositSource,
      reauthSession: (address) => dependencies.reauthSession(address),
      readWithdrawParams: () => {
        const params = readPortfolioWithdrawParams(false);
        if (!params) return null;
        return {
          amount: params.amount,
          destination: params.destination,
          chainKey: params.chainKey,
          tokenId: params.tokenId,
        };
      },
    });
    fundController = createFundingController(gateway, {
      quoteDebounceMs: WITHDRAW_QUOTE_DEBOUNCE_MS,
      statusPollMs: WITHDRAW_STATUS_POLL_MS,
    });
    // The side panel is a persistent page — one controller lives for its
    // lifetime (RESET/ACCOUNT_CHANGED recycle it), so the subscription is never
    // torn down.
    fundController.subscribe(onFundState);
    return fundController;
  }

  /** Which distinct screen a step renders; only a change swaps innerHTML (so an
   * amount input is never destroyed mid-typing). The cross-chain "Transfer
   * Crypto" deposit is ONE combined form spanning the machine's select-token
   * and (transient) amount steps. confirm/submitting/confirming/done/error keep
   * whatever screen was last shown and update it in place. */
  function fundScreenKey(state: FundingState): string {
    switch (state.step) {
      case "idle":
        return "idle";
      case "method":
        return "method";
      case "select-token":
        return fundDepositSource === "cross-chain"
          ? "xchain-form"
          : "select-token";
      case "amount":
        if (state.flow === "deposit" && fundDepositSource === "cross-chain") {
          return "xchain-form";
        }
        return `amount:${state.flow}`;
      default:
        return lastFundScreenKey ?? "";
    }
  }

  function hidePortfolioFundStatus(): void {
    const status =
      getPortfolioContainer()?.querySelector<HTMLElement>("[data-fund-status]");
    if (status) status.hidden = true;
  }

  /** Swaps the submit button's visible label without toggling its busy state. */
  function setFundSubmitLabel(label: string): void {
    const btn =
      getPortfolioContainer()?.querySelector<HTMLButtonElement>(
        "[data-fund-submit]"
      );
    const labelEl = btn?.querySelector<HTMLElement>(".knoww-pf-submit-label");
    if (labelEl) labelEl.textContent = label;
  }

  function hidePortfolioWithdrawQuote(): void {
    const quote = getPortfolioContainer()?.querySelector<HTMLElement>(
      "[data-withdraw-quote]"
    );
    if (!quote) return;
    quote.hidden = true;
    quote.innerHTML = "";
  }

  function setPortfolioWithdrawQuote(
    kind: "info" | "error",
    html: string
  ): void {
    const quote = getPortfolioContainer()?.querySelector<HTMLElement>(
      "[data-withdraw-quote]"
    );
    if (!quote) return;
    quote.hidden = false;
    quote.className = `knoww-pf-withdraw-quote is-${kind}`;
    quote.innerHTML = html;
  }

  /** The baseline fee/time/output preview, driven from the machine's quote. */
  function renderFundingWithdrawQuote(quote: FundingQuote): void {
    const feeUsd = new Decimal(quote.totalImpactUsd || "0");
    const feeLabel = feeUsd.lte(0) ? "Free" : formatDecimalMoney(feeUsd);
    const receiveRow =
      quote.estOutputDisplay && quote.estOutputSymbol
        ? `
      <div class="knoww-pf-withdraw-quote-row">
        <span>You receive</span>
        <strong>${escapeHtml(quote.estOutputDisplay)} ${escapeHtml(quote.estOutputSymbol)}</strong>
      </div>`
        : "";
    const timeRow =
      typeof quote.estCheckoutTimeMs === "number"
        ? `
      <div class="knoww-pf-withdraw-quote-row">
        <span>Est. time</span>
        <strong>${escapeHtml(formatCheckoutTime(quote.estCheckoutTimeMs))}</strong>
      </div>`
        : "";
    setPortfolioWithdrawQuote(
      "info",
      `${receiveRow}
      <div class="knoww-pf-withdraw-quote-row">
        <span>Fee</span>
        <strong>${escapeHtml(feeLabel)}</strong>
      </div>${timeRow}
    `
    );
  }

  /** Subscribe callback: drives the container from controller state. */
  function onFundState(state: FundingState): void {
    const container = getPortfolioContainer();
    const data = dependencies.getPortfolioData();
    if (!container || !data) return;

    if (state.step === "confirm") {
      if (state.command.flow === "deposit") {
        // Deposit has no confirm screen (the plan sanctions dispatching SUBMIT
        // twice: amount → confirm → submitting). confirm carries no effects, so
        // this re-entrant dispatch is safe and one-shot (SUBMIT in submitting
        // is a no-op).
        fundController?.dispatch({ type: "SUBMIT" });
        return;
      }
      // Withdraw confirm: the form stays on screen; render the quote preview
      // (fee/time/output) and flip the submit button into an explicit confirm.
      // Money never moves without this quote having been displayed — SUBMIT is
      // only dispatched from the confirm step.
      if (state.quote) renderFundingWithdrawQuote(state.quote);
      else hidePortfolioWithdrawQuote();
      hidePortfolioFundStatus();
      setFundSubmitLoading(false);
      setFundSubmitLabel("Confirm withdrawal");
      return;
    }

    const key = fundScreenKey(state);
    const screenChanged = key !== lastFundScreenKey;
    lastFundScreenKey = key;

    if (state.step === "idle") {
      // View closed / reset — closePortfolioFunds and the refresh timers restore
      // the portfolio content, so nothing to render here.
      return;
    }

    if (state.step === "method") {
      if (screenChanged) container.innerHTML = renderDepositMethod(data);
      return;
    }

    if (state.step === "select-token") {
      if (fundDepositSource === "cross-chain") {
        // Executable cross-chain deposit: one combined form (chain + token
        // dropdowns + amount). Render once; fill the dropdowns in place as the
        // machine's token list arrives, so typing is never interrupted.
        if (screenChanged) {
          container.innerHTML = renderPortfolioFundForm("deposit", data);
          container
            .querySelector<HTMLInputElement>("[data-fund-amount]")
            ?.focus();
        }
        fillCrossChainDepositSelects(container, state);
        if (state.error) {
          setFundSubmitLoading(false);
          setPortfolioFundStatus("error", fundErrorCopy(state.error));
        }
        return;
      }
      // Re-render freely (loading → list → error): the token list has no inputs.
      container.innerHTML = renderDepositTokenList(state);
      return;
    }

    if (state.step === "amount") {
      if (screenChanged) {
        if (state.flow === "deposit" && state.token) {
          container.innerHTML = renderDepositAmountStep(state.token);
          container
            .querySelector<HTMLInputElement>("[data-fund-amount]")
            ?.focus();
        } else if (state.flow === "withdraw") {
          container.innerHTML = renderPortfolioFundForm("withdraw", data);
          container
            .querySelector<HTMLInputElement>("[data-fund-amount]")
            ?.focus();
          void loadPortfolioBridgeAssets();
        }
      }
      syncFundAmountStatus(state);
      return;
    }

    // submitting / confirming / done / error keep the current screen.
    syncFundProgress(state);
  }

  /** Fills the cross-chain deposit form's chain/token dropdowns from the
   * machine's token list. Token option values are indexes into `state.tokens`;
   * current selections survive refills. */
  function fillCrossChainDepositSelects(
    container: HTMLElement,
    state: Extract<FundingState, { step: "select-token" }>
  ): void {
    if (state.loading) return; // leave the "Loading…" placeholders
    const chainSelect =
      container.querySelector<HTMLSelectElement>("[data-fund-chain]");
    if (!chainSelect) return;
    const previousChain = chainSelect.value;
    const seen = new Set<string>();
    const options: string[] = [];
    for (const token of state.tokens) {
      const chainId = token.chainId ?? "137";
      if (seen.has(chainId)) continue;
      seen.add(chainId);
      const name = CHAIN_METADATA[chainId]?.name ?? chainId;
      options.push(
        optionHtml(chainId, name, chainId === (previousChain || "137"))
      );
    }
    chainSelect.innerHTML =
      options.join("") || optionHtml("137", "Polygon", true);
    fillCrossChainTokenSelect(container, state.tokens);
  }

  function fillCrossChainTokenSelect(
    container: HTMLElement,
    tokens: FundingToken[]
  ): void {
    const chain =
      container.querySelector<HTMLSelectElement>("[data-fund-chain]")?.value ||
      "";
    const tokenSelect =
      container.querySelector<HTMLSelectElement>("[data-fund-token]");
    if (!tokenSelect) return;
    const previous = tokenSelect.value;
    const options: string[] = [];
    tokens.forEach((token, index) => {
      if ((token.chainId ?? "137") !== chain) return;
      const value = String(index);
      const isDefault = previous
        ? value === previous
        : token.symbol === "USDC.e";
      options.push(optionHtml(value, token.symbol, isDefault));
    });
    tokenSelect.innerHTML =
      options.join("") || optionHtml("", "No tokens", false);
  }

  function syncFundAmountStatus(
    state: Extract<FundingState, { step: "amount" }>
  ): void {
    // Withdraw: the live quote preview block (baseline behavior — the fee/time
    // rows track typing; quote failures render inside the block).
    if (state.flow === "withdraw") {
      if (state.quoteLoading) {
        setPortfolioWithdrawQuote(
          "info",
          `<div class="knoww-pf-withdraw-quote-row"><span>Route</span><strong>Checking quote...</strong></div>`
        );
      } else if (state.error?.code === "QUOTE_FAILED") {
        setPortfolioWithdrawQuote(
          "error",
          `<div class="knoww-pf-withdraw-quote-row"><span>Quote</span><strong>${escapeHtml(
            state.error.message || "Quote unavailable"
          )}</strong></div>`
        );
      } else if (state.quote) {
        renderFundingWithdrawQuote(state.quote);
      } else {
        hidePortfolioWithdrawQuote();
      }
    }
    if (state.error && state.error.code !== "QUOTE_FAILED") {
      setFundSubmitLoading(false);
      setPortfolioFundStatus("error", fundErrorCopy(state.error));
      return;
    }
    if (state.quoteLoading) {
      setFundSubmitLoading(true, "Getting quote…");
      return;
    }
    setFundSubmitLoading(false);
  }

  function syncFundProgress(state: FundingState): void {
    const action = fundFlow ?? "deposit";
    if (state.step === "submitting" || state.step === "confirming") {
      const flow = state.command.flow;
      setFundSubmitLoading(
        true,
        flow === "deposit" ? "Depositing…" : "Withdrawing…"
      );
      if (state.step === "submitting") {
        setPortfolioFundStatus(
          "info",
          "Confirm the transaction in your wallet…"
        );
      } else if (flow === "withdraw") {
        setPortfolioFundStatus(
          "info",
          "Withdrawal sent. Waiting for completion…"
        );
      } else {
        setPortfolioFundStatus("info", "Processing your deposit…");
      }
      return;
    }
    if (state.step === "done") {
      setFundSubmitLoading(false);
      setPortfolioFundStatus(
        "success",
        action === "withdraw"
          ? "Withdrawal completed."
          : "Deposit submitted. Funds appear once processing completes."
      );
      schedulePortfolioFundRefreshes(action);
      return;
    }
    if (state.step === "error") {
      setFundSubmitLoading(false);
      setPortfolioFundStatus("error", fundErrorCopy(state.error));
      if (state.error.code === "NO_CONTENT_TAB") {
        openPortfolioFundsFallback(action);
      }
    }
  }

  /** Withdraw-form edits re-quote (the controller debounces the fetch). From
   * the confirm step, BACK is dispatched FIRST so a stale quote can never be
   * confirmed against edited inputs. */
  function requestWithdrawRequote(): void {
    const controller = fundController;
    if (!controller) return;
    let state = controller.getState();
    if (state.step === "confirm" && state.command.flow === "withdraw") {
      controller.dispatch({ type: "BACK" });
      state = controller.getState();
    }
    if (!(state.step === "amount" && state.flow === "withdraw")) return;
    const params = readPortfolioWithdrawParams(false);
    if (!params) {
      // Incomplete/invalid form: no quote to show (baseline hid the preview).
      // SET_AMOUNT also invalidates any in-flight quote in the machine, so a
      // quote requested for the previous (valid) inputs can never resolve into
      // a confirm step while the form shows the new invalid input.
      const rawAmount =
        getPortfolioContainer()
          ?.querySelector<HTMLInputElement>("[data-fund-amount]")
          ?.value.trim() ?? "";
      controller.dispatch({ type: "SET_AMOUNT", amount: rawAmount });
      hidePortfolioWithdrawQuote();
      return;
    }
    controller.dispatch({
      type: "SET_DESTINATION",
      destination: params.destination,
      chainKey: params.chainKey,
      tokenId: params.tokenId,
    });
    controller.dispatch({ type: "SET_AMOUNT", amount: params.amount });
    controller.dispatch({ type: "REQUEST_QUOTE" });
  }

  /** data-fund-submit click: advances the machine from the current screen (or
   * retries a retryable error). Reads the uncontrolled DOM inputs at submit
   * time rather than tracking them live. */
  function handleFundSubmit(): void {
    const controller = fundController;
    if (!controller) return;
    const state = controller.getState();
    if (state.step === "error") {
      if (state.error.retryable) controller.dispatch({ type: "RETRY" });
      return;
    }
    if (state.step === "confirm") {
      // Withdraw's explicit confirm — the quote preview is on screen (deposit
      // confirm never renders; it auto-submits in onFundState).
      controller.dispatch({ type: "SUBMIT" });
      return;
    }
    const container = getPortfolioContainer();
    const amount = (
      container?.querySelector<HTMLInputElement>("[data-fund-amount]")?.value ??
      ""
    ).trim();
    if (state.step === "select-token" && fundDepositSource === "cross-chain") {
      // Cross-chain combined form: the machine sits in select-token until
      // submit, when the dropdown token + amount drive the cascade
      // SELECT_TOKEN → SET_AMOUNT → SUBMIT (→ confirm → auto-SUBMIT).
      const amountDecimal = parsePortfolioAmount(amount);
      if (!amount || !amountDecimal || amountDecimal.lte(0)) {
        setPortfolioFundStatus("error", "Enter an amount greater than zero.");
        return;
      }
      const idxRaw =
        container?.querySelector<HTMLSelectElement>("[data-fund-token]")
          ?.value ?? "";
      const token = idxRaw === "" ? undefined : state.tokens[Number(idxRaw)];
      if (!token) {
        setPortfolioFundStatus("error", "Select a chain and token.");
        return;
      }
      controller.dispatch({ type: "SELECT_TOKEN", token });
      controller.dispatch({ type: "SET_AMOUNT", amount });
      controller.dispatch({ type: "SUBMIT" });
      return;
    }
    if (state.step !== "amount") return; // ignore while submitting/confirming
    if (state.flow === "deposit") {
      controller.dispatch({ type: "SET_AMOUNT", amount });
      controller.dispatch({ type: "SUBMIT" });
      return;
    }
    // Withdraw: rich address/chain/balance validation stays in the side panel;
    // only dispatch once the form is valid. QUOTE_OK advances to the explicit
    // confirm step, where the preview renders before SUBMIT is possible.
    const params = readPortfolioWithdrawParams(true);
    if (!params) return;
    controller.dispatch({
      type: "SET_DESTINATION",
      destination: params.destination,
      chainKey: params.chainKey,
      tokenId: params.tokenId,
    });
    controller.dispatch({ type: "SET_AMOUNT", amount: params.amount });
    controller.dispatch({ type: "REQUEST_QUOTE" });
  }

  /** The screen shown while the signing wallet mode resolves, and the retryable
   * error screen when that probe fails or times out. Both carry a Back button:
   * this step is a background round trip, so it must never be able to strand the
   * panel on a placeholder with no way out. Retry re-enters through the same
   * `[data-portfolio-fund]` affordance the portfolio uses. */
  function renderFundProbe(
    action: PortfolioFundAction,
    error?: string
  ): string {
    const label = action === "deposit" ? "Deposit" : "Withdraw";
    const body = error
      ? `<div class="knoww-pf-fund-status is-error">${escapeHtml(error)}</div>
      <button type="button" class="knoww-pf-fund-submit primary" data-portfolio-fund="${action}">
        <span class="knoww-pf-submit-label">Retry</span>
      </button>`
      : `<div class="knoww-portfolio-loading">Loading…</div>`;
    return `
    <div class="knoww-pf-fund" data-fund-probe>
      <div class="knoww-pf-fund-head">
        <button type="button" class="knoww-pf-fund-back" data-fund-back aria-label="Back to portfolio">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg>
        </button>
        <div class="knoww-pf-fund-heading">
          <span class="knoww-pf-fund-kicker">${label}</span>
        </div>
      </div>
      ${body}
    </div>`;
  }

  /** Bounds the wallet-mode probe. It hops side panel → service worker →
   * offscreen → Polygon RPC; any of those can go quiet (worker evicted mid
   * flight, offscreen wedged, RPC hanging), and an unanswered probe must surface
   * as a retryable error rather than as a spinner that never resolves. The
   * underlying round trip is shared per address (see `pendingWalletModeProbe`),
   * so each open/retry gets its own fresh timeout window over the same probe. */
  function resolveFundWalletMode(
    address: string
  ): Promise<TradingWalletMode | null> {
    let entry = pendingWalletModeProbe;
    if (!entry || entry.address !== address) {
      const probe = dependencies.resolvePreferredWalletMode(address).then(
        (mode) => mode,
        () => null
      );
      entry = { address, probe };
      pendingWalletModeProbe = entry;
      const settled = entry;
      void probe.then(() => {
        if (pendingWalletModeProbe === settled) pendingWalletModeProbe = null;
      });
    }
    const { probe } = entry;
    return new Promise<TradingWalletMode | null>((resolve) => {
      const timer = setTimeout(
        () => resolve(null),
        FUND_WALLET_MODE_TIMEOUT_MS
      );
      void probe.then((mode) => {
        clearTimeout(timer);
        resolve(mode);
      });
    });
  }

  /** Screen for reopening the funds view onto a flow whose money is still in
   * flight: a live status panel over that transaction (regardless of which
   * action was clicked). Reuses the fund frame's status/submit hooks so the
   * shared progress sync keeps driving it through done/error. */
  function renderFundInFlight(flow: PortfolioFundAction): string {
    const label = flow === "deposit" ? "Deposit" : "Withdraw";
    return `
    <div class="knoww-pf-fund">
      <div class="knoww-pf-fund-head">
        <button type="button" class="knoww-pf-fund-back" data-fund-back aria-label="Back to portfolio">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg>
        </button>
        <div class="knoww-pf-fund-heading">
          <span class="knoww-pf-fund-kicker">${label}</span>
        </div>
      </div>
      <div class="knoww-pf-fund-status" data-fund-status hidden></div>
      ${renderFundSubmitButton(label, true)}
    </div>`;
  }

  function openPortfolioFunds(action: PortfolioFundAction): void {
    const container = getPortfolioContainer();
    const data = dependencies.getPortfolioData();
    // Without loaded portfolio data we can't derive the wallet — hand off to web.
    if (!container || !data) {
      openPortfolioFundsFallback(action);
      return;
    }
    const controller = ensureFundController();
    const current = controller.getState();
    // A flow with money in flight must never be recycled: RESET would tear down
    // the controller's confirmation polling and its outcome would never reach
    // the screen. Re-attach instead — the status panel keeps tracking it, and
    // its "done" refresh closes the view as usual.
    if (current.step === "submitting" || current.step === "confirming") {
      cancelFundOpen();
      fundFlow = current.command.flow;
      fundDepositSource = "wallet";
      lastFundScreenKey = "in-flight";
      container.innerHTML = renderFundInFlight(current.command.flow);
      syncFundProgress(current);
      return;
    }
    // START is only honoured from the machine's idle step; every other step drops
    // it. A flow left mid-air (errored, or abandoned by switching to the Markets
    // tab — neither dispatches RESET) would therefore swallow the START below,
    // and those steps render nothing new, leaving the loading placeholder on
    // screen forever. Recycle so the open always starts from idle.
    if (current.step !== "idle") controller.dispatch({ type: "RESET" });
    const token = ++fundOpenToken;
    fundFlow = action;
    fundDepositSource = "wallet";
    lastFundScreenKey = null;
    const address = data.ownerAddress;
    // The signing wallet mode must be known before START (the machine threads it
    // into the command fingerprint). Resolving it is async, so show a brief
    // loading state instead of a blank flash.
    container.innerHTML = renderFundProbe(action);
    void (async () => {
      const walletMode = await resolveFundWalletMode(address);
      if (token !== fundOpenToken) return; // closed or reopened during the probe
      const target = getPortfolioContainer();
      // If some external render replaced the probe screen anyway, releasing the
      // view beats painting a funding screen over foreign content. The machine
      // is provably idle here (START hasn't been dispatched), so no RESET.
      if (!target?.querySelector("[data-fund-probe]")) {
        resetFundOpenState();
        return;
      }
      if (!walletMode) {
        // Never guess the signing wallet — a wrong mode signs from the wrong
        // address. Surface it instead and let the user retry.
        target.innerHTML = renderFundProbe(
          action,
          "Couldn't reach your wallet. Check your connection and try again."
        );
        return;
      }
      controller.dispatch({ type: "START", flow: action, address, walletMode });
    })();
  }

  function closePortfolioFunds(): void {
    resetFundOpenState();
    fundController?.dispatch({ type: "RESET" });
    if (dependencies.getPortfolioData()) dependencies.renderPortfolio();
    else void dependencies.reloadPortfolio();
  }

  function clearPortfolioFundRefreshTimers(): void {
    for (const timer of portfolioFundRefreshTimers) clearTimeout(timer);
    portfolioFundRefreshTimers.length = 0;
  }

  function schedulePortfolioFundRefreshes(action: PortfolioFundAction): void {
    clearPortfolioFundRefreshTimers();
    const run = ++portfolioFundRefreshRun;
    const delays = [2600, 4000, 6500, 10000, 15000, 20000, 30000];

    for (const delay of delays) {
      portfolioFundRefreshTimers.push(
        setTimeout(() => {
          if (run !== portfolioFundRefreshRun) return;
          // The first refresh closes the funds view (this action's result is on
          // screen); later ones only reload if the user hasn't reopened it. The
          // "done" gate tells the completed flow these timers belong to apart
          // from a same-action flow the user has since reopened — which must
          // not be torn down mid-form.
          if (fundFlow === action) {
            if (fundController?.getState().step !== "done") return;
            resetFundOpenState();
            fundController?.dispatch({ type: "RESET" });
          } else if (isFundViewOpen()) {
            return;
          }
          void dependencies.reloadPortfolio();
        }, delay)
      );
    }
  }

  function setPortfolioFundStatus(
    kind: "info" | "error" | "success",
    message: string
  ): void {
    const status =
      getPortfolioContainer()?.querySelector<HTMLElement>("[data-fund-status]");
    if (!status) return;
    status.hidden = false;
    status.className = `knoww-pf-fund-status is-${kind}`;
    status.textContent = message;
  }

  function parsePortfolioAmount(value: string): Decimal | null {
    try {
      const amount = new Decimal(value);
      return amount.isFinite() ? amount : null;
    } catch {
      return null;
    }
  }

  function normalizePortfolioAmountInput(value: string): string {
    const cleaned = value.replace(/[^\d.]/g, "");
    if (!cleaned) return "";

    const dotIndex = cleaned.indexOf(".");
    if (dotIndex === -1) {
      return cleaned.replace(/^0+(?=\d)/, "");
    }

    const wholeRaw = cleaned.slice(0, dotIndex).replace(/\./g, "");
    const fractionalRaw = cleaned
      .slice(dotIndex + 1)
      .replace(/\./g, "")
      .slice(0, PORTFOLIO_AMOUNT_DECIMALS);
    const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
    return `${whole}.${fractionalRaw}`;
  }

  function formatPortfolioAmountInputValue(value: string): string {
    const amount = parsePortfolioAmount(value);
    if (!amount || amount.lt(0)) return "0";
    return amount
      .toDecimalPlaces(PORTFOLIO_AMOUNT_DECIMALS, Decimal.ROUND_DOWN)
      .toFixed();
  }

  function readPortfolioWithdrawParams(
    reportErrors: boolean
  ): PortfolioWithdrawFormParams | null {
    const container = getPortfolioContainer();
    const data = dependencies.getPortfolioData();
    if (!container || !data) return null;

    const amount = (
      container.querySelector<HTMLInputElement>("[data-fund-amount]")?.value ||
      ""
    ).trim();
    const amountDecimal = parsePortfolioAmount(amount);
    if (!amount || !amountDecimal || amountDecimal.lte(0)) {
      if (reportErrors) {
        setPortfolioFundStatus("error", "Enter an amount greater than zero.");
      }
      return null;
    }

    const chainKey =
      container.querySelector<HTMLSelectElement>("[data-fund-chain]")?.value ||
      "";
    const tokenId =
      container.querySelector<HTMLSelectElement>("[data-fund-token]")?.value ||
      "";
    const destination = (
      container.querySelector<HTMLInputElement>("[data-fund-dest]")?.value || ""
    ).trim();
    if (!chainKey || !tokenId) {
      if (reportErrors)
        setPortfolioFundStatus("error", "Select a chain and token.");
      return null;
    }

    const isSolana = chainKey === "solana";
    const validEvm = /^0x[0-9a-fA-F]{40}$/.test(destination);
    const validSol = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(destination);
    if (!destination || (isSolana ? !validSol : !validEvm)) {
      if (reportErrors) {
        setPortfolioFundStatus(
          "error",
          isSolana
            ? "Enter a valid Solana recipient address."
            : "Enter a valid 0x recipient address."
        );
      }
      return null;
    }

    const available = new Decimal(data.cashBalance || 0);
    if (amountDecimal.gt(available.plus("0.000000001"))) {
      if (reportErrors) {
        setPortfolioFundStatus(
          "error",
          "Amount exceeds your available balance."
        );
      }
      return null;
    }

    return { amount, amountDecimal, chainKey, tokenId, destination };
  }

  function isSigningBridgeUnreachable(error?: string): boolean {
    if (!error) return false;
    return (
      error.includes("Receiving end does not exist") ||
      error.includes("Could not establish connection") ||
      error.includes("Extension context invalidated")
    );
  }

  function formatPortfolioTransactionError(error?: string): string {
    if (!error) return "Could not complete the transaction.";
    if (error === "PENDING_RECONCILIATION") {
      return "This transaction may already be submitted. Check your wallet and portfolio before trying again.";
    }
    if (
      error === "IDEMPOTENCY_FINGERPRINT_MISMATCH" ||
      error === "INVALID_IDEMPOTENCY_KEY"
    ) {
      return "Transaction details changed. Review the form and start a new transaction.";
    }
    if (
      /user rejected|request rejected|rejected the request|denied|4001/i.test(
        error
      )
    ) {
      return "Transaction rejected.";
    }
    return error;
  }

  function renderPortfolioFundActions(): string {
    // Deposit/withdraw move real funds on-chain; the store-compliant build
    // ships neither the buttons nor the background money-movement routes.
    if (__STORE_BUILD__) return "";
    return `
    <div class="knoww-pf-fund-actions">
      <button type="button" class="knoww-pf-fund-btn primary" data-portfolio-fund="deposit">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16"></path></svg>
        <span>Deposit</span>
      </button>
      <button type="button" class="knoww-pf-fund-btn" data-portfolio-fund="withdraw">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21V9m0 0 4 4m-4-4-4 4M4 3h16"></path></svg>
        <span>Withdraw</span>
      </button>
    </div>
  `;
  }

  function handleChange(event: Event): boolean {
    const target = event.target as Element | null;
    const chainSelect = target?.closest("[data-fund-chain]");
    if (chainSelect) {
      const container = getPortfolioContainer();
      const state = fundController?.getState();
      if (container && state) {
        if (withdrawFormActive() && portfolioBridgeAssets) {
          fillFundTokenSelect(container, portfolioBridgeAssets);
          syncFundRecipientForChain(container);
          requestWithdrawRequote();
        } else if (fundDepositSource === "cross-chain") {
          if (state.step === "select-token") {
            fillCrossChainTokenSelect(container, state.tokens);
          } else if (state.step === "amount") {
            fundController?.dispatch({ type: "BACK" });
          }
        }
      }
      return true;
    }
    const tokenSelect = target?.closest("[data-fund-token]");
    if (!tokenSelect) return false;
    if (withdrawFormActive()) requestWithdrawRequote();
    else if (
      fundDepositSource === "cross-chain" &&
      fundController?.getState().step === "amount"
    )
      fundController.dispatch({ type: "BACK" });
    return true;
  }

  function handleInput(event: Event): boolean {
    const target = event.target as Element | null;
    const amountInput = target?.closest<HTMLInputElement>("[data-fund-amount]");
    if (amountInput) {
      const normalized = normalizePortfolioAmountInput(amountInput.value);
      if (normalized !== amountInput.value) amountInput.value = normalized;
    }
    const relevant =
      Boolean(amountInput) || Boolean(target?.closest("[data-fund-dest]"));
    if (withdrawFormActive() && relevant) requestWithdrawRequote();
    return relevant;
  }

  function handleClick(event: Event): boolean {
    const target = event.target as Element | null;
    const portfolioFund = target?.closest<HTMLElement>("[data-portfolio-fund]");
    if (portfolioFund) {
      // Money-movement is stripped from the store-compliant build; ignore any
      // stray deposit/withdraw affordance defensively.
      if (__STORE_BUILD__) return true;
      const action = portfolioFund.dataset.portfolioFund;
      if (action === "deposit" || action === "withdraw")
        openPortfolioFunds(action);
      return true;
    }
    if (target?.closest("[data-fund-back]")) {
      closePortfolioFunds();
      return true;
    }
    const depositMethod = target?.closest<HTMLElement>("[data-deposit-method]");
    if (depositMethod) {
      const method = depositMethod.dataset.depositMethod;
      if (method === "wallet") {
        fundDepositSource = "wallet";
        fundController?.dispatch({ type: "SELECT_METHOD", method: "wallet" });
      } else if (method === "bridge") {
        fundDepositSource = "cross-chain";
        fundController?.dispatch({
          type: "SELECT_METHOD",
          method: "wallet",
          source: "cross-chain",
        });
      }
      return true;
    }
    if (target?.closest("[data-deposit-back]")) {
      fundController?.dispatch({ type: "BACK" });
      return true;
    }
    const depositToken = target?.closest<HTMLElement>("[data-deposit-token]");
    if (depositToken) {
      const index = Number(depositToken.dataset.depositToken);
      const state = fundController?.getState();
      if (state?.step === "select-token") {
        const token = state.tokens[index];
        if (token) fundController?.dispatch({ type: "SELECT_TOKEN", token });
      }
      return true;
    }
    const useEoaChip = target?.closest<HTMLElement>("[data-fund-use-eoa]");
    if (useEoaChip) {
      const destination =
        getPortfolioContainer()?.querySelector<HTMLInputElement>(
          "[data-fund-dest]"
        );
      if (destination) {
        destination.value = useEoaChip.dataset.eoa || "";
        destination.focus();
        requestWithdrawRequote();
      }
      return true;
    }
    if (target?.closest("[data-fund-max]")) {
      const container = getPortfolioContainer();
      const amount =
        container?.querySelector<HTMLInputElement>("[data-fund-amount]");
      if (amount && isFundViewOpen()) {
        const value = withdrawFormActive()
          ? String(dependencies.getPortfolioData()?.cashBalance ?? 0)
          : container?.querySelector<HTMLElement>("[data-fund-avail]")?.dataset
              .value || "0";
        amount.value = formatPortfolioAmountInputValue(value);
        amount.focus();
        if (withdrawFormActive()) requestWithdrawRequote();
      }
      return true;
    }
    if (target?.closest("[data-fund-submit]")) {
      handleFundSubmit();
      return true;
    }
    return false;
  }

  return {
    isOpen: isFundViewOpen,
    open: openPortfolioFunds,
    close: closePortfolioFunds,
    renderActions: renderPortfolioFundActions,
    resetAccount() {
      resetFundOpenState();
      fundController?.dispatch({ type: "ACCOUNT_CHANGED" });
    },
    handleChange,
    handleInput,
    handleClick,
    dispose() {
      resetFundOpenState();
      clearPortfolioFundRefreshTimers();
      fundController?.dispose();
      fundController = null;
    },
  };
}
