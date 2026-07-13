import { PUSD_ADDRESS, USDC_E_ADDRESS } from "@knoww/shared-types/contracts";
import { POLYGON_CHAIN_ID_HEX } from "@knoww/shared-types/polymarket";
import { Decimal } from "decimal.js";
import { parseUnits } from "viem";
import {
  createFundingController,
  type FundingController,
  type FundingState,
  type FundingToken,
} from "../../../funding";
import { createTradingPanelFundingGateway } from "../../../funding/gateways/trading-panel-gateway";
import { WalletBridge } from "../bridge";
import {
  CHAIN_METADATA,
  createDepositAddresses,
  fetchQuote,
  fetchSupportedAssets,
  formatCheckoutTime,
  isPusdToken,
} from "../bridge-api";
import { type TradingContext, TradingService } from "../trading-service";
import {
  depositErrorCopy,
  formatDepositRawAmount,
  formatTokenAmount,
  formatTradingPanelErrorMessage,
  truncAddr,
} from "./format";
import { type PanelOptions, panelState } from "./panel-state";
import { addWalletModeSelector, type SetupViewUiPort } from "./setup-view";

export interface DepositViewUiPort {
  el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls?: string,
    text?: string
  ): HTMLElementTagNameMap[K];
  elHtml<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls: string,
    html: string
  ): HTMLElementTagNameMap[K];
  rerender(): void;
  trackAnalytics(
    event: string,
    properties?: Record<string, string | number | boolean | null | undefined>
  ): void;
  buildInlineError(rawMessage: string | null | undefined): HTMLElement;
  setButtonLoading(button: HTMLElement, text: string): void;
  setupViewUi: SetupViewUiPort;
  icons: {
    refresh: string;
    alert: string;
    wallet: string;
    check: string;
    back: string;
    shield: string;
  };
}

let depositViewUi: DepositViewUiPort | null = null;
export function configureDepositView(ui: DepositViewUiPort): void {
  depositViewUi = ui;
}
function requireUi(): DepositViewUiPort {
  if (!depositViewUi) throw new Error("Deposit view UI port is not configured");
  return depositViewUi;
}
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  return requireUi().el(tag, cls, text);
}
function elHtml<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  html: string
): HTMLElementTagNameMap[K] {
  return requireUi().elHtml(tag, cls, html);
}
function rerender(): void {
  requireUi().rerender();
}
function trackPanelAnalytics(
  event: string,
  properties: Record<string, string | number | boolean | null | undefined> = {}
): void {
  requireUi().trackAnalytics(event, properties);
}
function buildInlineError(rawMessage: string | null | undefined): HTMLElement {
  return requireUi().buildInlineError(rawMessage);
}
function setButtonLoading(button: HTMLElement, text: string): void {
  requireUi().setButtonLoading(button, text);
}
const setupViewUi: SetupViewUiPort = {
  el: (...args) => requireUi().setupViewUi.el(...args),
  buildInlineError: (...args) =>
    requireUi().setupViewUi.buildInlineError(...args),
  setButtonLoading: (...args) =>
    requireUi().setupViewUi.setButtonLoading(...args),
  rerender: () => requireUi().setupViewUi.rerender(),
};
const I = {
  get refresh(): string {
    return requireUi().icons.refresh;
  },
  get alert(): string {
    return requireUi().icons.alert;
  },
  get wallet(): string {
    return requireUi().icons.wallet;
  },
  get check(): string {
    return requireUi().icons.check;
  },
  get back(): string {
    return requireUi().icons.back;
  },
  get shield(): string {
    return requireUi().icons.shield;
  },
};

const DEPOSIT_TOKENS: Array<{
  symbol: string;
  address: string;
  decimals: number;
}> = [
  { symbol: "pUSD", address: PUSD_ADDRESS, decimals: 6 },
  { symbol: "USDC.e", address: USDC_E_ADDRESS, decimals: 6 },
  {
    symbol: "USDC",
    address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    decimals: 6,
  },
  {
    symbol: "USDT",
    address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    decimals: 6,
  },
  {
    symbol: "DAI",
    address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
    decimals: 18,
  },
  {
    symbol: "WETH",
    address: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
    decimals: 18,
  },
];
// ── Types ──

interface DepositToken {
  symbol: string;
  amount: number;
  amountRaw?: string;
  usdValue: number;
  address: string;
  decimals: number;
  depositSupported?: boolean;
  depositDisabledReason?: string;
}

/** The DOM root the deposit flow currently lives in (inline host or panel). */
function depositDomRoot(): HTMLElement | null {
  return panelState.inlineDepositHost ?? panelState.activePanel;
}
// The shared funding controller owns the whole deposit flow (state machine +
// effects). The panel never signs or moves money itself — every transfer goes
// through the background viem path via the trading-panel funding gateway.
// Transition bookkeeping for analytics (deposit_initiated/completed/failed
// fire once on the matching machine-step transition, not on every re-render)
// and the post-success auto-return timer.
// txHashes `deposit_initiated` already fired for — a RETRY that resumes the
// same submitted attempt re-runs the receipt wait and must not double-count.

const DEPOSIT_BALANCE_SYNC_TIMEOUT = 8000;
const DEPOSIT_BALANCE_SYNC_INTERVAL = 1500;
const DEPOSIT_BALANCE_LOAD_TIMEOUT_MS = 8000;
/**
 * Deposit analytics props derived from the current funding-machine state —
 * the module `deposit*` vars that used to back these are gone. Preserves the
 * baseline `{ depositMethod, tokenSymbol, amount, chainName }` payload shape
 * (the `depositMethod` KEY is an external analytics contract — downstream
 * dashboards pin on it; only the module state vars were removed).
 */
function getDepositEventProperties(
  state: FundingState
): Record<string, string | number | boolean | null | undefined> {
  let depositMethod: "wallet" | "bridge" | undefined;
  let tokenSymbol: string | undefined;
  let amount: number | undefined;
  let chainName: string | undefined;

  if (state.step === "select-bridge-asset") {
    depositMethod = "bridge";
  } else if (state.step === "bridge-address-ready") {
    depositMethod = "bridge";
    tokenSymbol = state.asset.symbol;
    chainName = state.asset.chainName;
  } else if (state.step === "amount") {
    depositMethod = "wallet";
    tokenSymbol = state.token?.symbol;
    if (state.amount && !Number.isNaN(Number.parseFloat(state.amount))) {
      amount = Number.parseFloat(state.amount);
    }
  } else if (state.step === "confirm") {
    depositMethod = "wallet";
    tokenSymbol =
      state.token?.symbol ??
      (state.command.flow === "deposit"
        ? state.command.tokenSymbol
        : undefined);
    if (state.command.amount) amount = Number.parseFloat(state.command.amount);
  } else if (
    state.step === "submitting" ||
    state.step === "confirming" ||
    state.step === "error"
  ) {
    const command = state.command;
    if (command?.flow === "deposit") {
      depositMethod = "wallet";
      tokenSymbol = command.tokenSymbol;
      if (command.amount) amount = Number.parseFloat(command.amount);
    }
  } else if (state.step === "select-token") {
    depositMethod = "wallet";
  }

  return { depositMethod, tokenSymbol, amount, chainName };
}
/** Re-render the deposit form into the inline host (stream card). */
export function renderInlineDeposit(): void {
  const host = panelState.inlineDepositHost;
  if (!host?.isConnected) {
    closeInlineDeposit();
    return;
  }
  host.innerHTML = "";
  renderDepositForm(host, TradingService.getContext());
}

/** Tear down the inline deposit and hand control back to the card. */
export function closeInlineDeposit(host?: HTMLElement): void {
  if (
    !panelState.inlineDepositHost ||
    (host && panelState.inlineDepositHost !== host)
  ) {
    return;
  }
  if (panelState.inlineDepositUnsub) {
    panelState.inlineDepositUnsub();
    panelState.inlineDepositUnsub = null;
  }
  disposeDepositController();
  const activeHost = panelState.inlineDepositHost;
  const onClose = panelState.inlineDepositOnClose;
  panelState.inlineDepositHost = null;
  panelState.inlineDepositOnClose = null;
  panelState.panelOpts = null;
  panelState.activeView = "order";
  if (activeHost) activeHost.innerHTML = "";
  onClose?.();
}

/** Wraps `chrome.runtime.sendMessage` in the `{ ok, error, data }` shape the
 * funding gateway expects. Used for the background money-movement messages. */
function sendPortfolioRuntimeMessage(
  message: Record<string, unknown>
): Promise<{ ok?: boolean; error?: string; data?: unknown }> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      message,
      (response: { ok?: boolean; error?: string; data?: unknown }) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response ?? { ok: false, error: "No response" });
      }
    );
  });
}

/** Loads the connected EOA's Polygon token balances for the deposit token
 * list (read-only wallet RPC), bounded by the same timeout the old opener
 * used so a hung wallet surfaces as a LOAD_FAILED instead of an endless
 * spinner. */
async function loadDepositWalletTokens(): Promise<DepositToken[]> {
  const address = TradingService.getContext().address;
  if (!address) return [];
  return withDepositLoadTimeout(
    fetchEoaBalancesViaWallet(address),
    DEPOSIT_BALANCE_LOAD_TIMEOUT_MS,
    "Wallet balance request timed out. Try again, or use Transfer Crypto."
  );
}

/** Lazily creates the module-scoped funding controller (one per open panel /
 * inline host; disposed on close). Subscribes it to `rerender()` and to the
 * transition-driven analytics + auto-return side effects. */
function ensureDepositController(): FundingController {
  if (panelState.depositController) return panelState.depositController;
  const gateway = createTradingPanelFundingGateway({
    sendRuntimeMessage: sendPortfolioRuntimeMessage,
    loadWalletTokens: loadDepositWalletTokens,
    fetchSupportedAssets,
    createDepositAddresses,
    fetchBridgeQuote: fetchQuote,
    getProxyAddress: () => TradingService.getContext().proxyAddress,
    waitForTxReceipt: async (txHash) => {
      const receipt = await waitForTxReceipt(txHash);
      // Baseline timing: `deposit_initiated` fired right after the on-chain
      // receipt confirmed success (old executeDeposit "Phase 2"), with the
      // txHash. This dep is that exact point in the new flow — the machine
      // itself never observes "receipt confirmed" as a discrete transition.
      // Deduped by txHash (a RETRY resuming the same submitted attempt
      // re-runs this wait) and skipped once this controller is disposed or
      // replaced (a late receipt for a closed panel must not fire).
      if (
        receipt.status === "success" &&
        // `controller` is assigned below in this same scope; this callback
        // only ever runs long after initialization (during confirming).
        panelState.depositController === controller &&
        !panelState.depositInitiatedTxHashes.has(txHash)
      ) {
        panelState.depositInitiatedTxHashes.add(txHash);
        trackPanelAnalytics("deposit_initiated", {
          ...getDepositEventProperties(controller.getState()),
          txHash,
        });
      }
      return receipt.status;
    },
    awaitBalanceCredit: async () => {
      await refreshDepositBalanceUntilSynced(
        TradingService.getContext().balance
      );
    },
  });
  const controller = createFundingController(gateway);
  panelState.depositController = controller;
  panelState.depositPrevStep = controller.getState().step;
  panelState.depositControllerUnsub = controller.subscribe((state) => {
    handleDepositTransition(state);
    rerender();
  });
  return controller;
}

/**
 * Reconciles an open funding flow with the wallet account. The machine
 * captures the connected address at START (`corr.address`) and threads it
 * into every command; if the account changes while the panel stays open,
 * that captured state — and any in-flight effect — is for the wrong account.
 * Dispatching ACCOUNT_CHANGED bumps the epoch (dropping in-flight results)
 * and, when the deposit view is still open, the flow restarts for the new
 * account (or exits if the wallet disconnected). Called from every
 * TradingService state listener.
 */
export function syncDepositControllerAccount(ctx: TradingContext): void {
  const controller = panelState.depositController;
  if (!controller) return;
  const state = controller.getState();
  if (state.step === "idle") return;
  const flowAddress = state.corr.address;
  if (!flowAddress) return;
  const currentAddress = ctx.address ?? "";
  if (currentAddress.toLowerCase() === flowAddress.toLowerCase()) return;
  controller.dispatch({ type: "ACCOUNT_CHANGED" });
  if (panelState.activeView !== "deposit" && !panelState.inlineDepositHost)
    return;
  if (currentAddress) {
    controller.dispatch({
      type: "START",
      flow: "deposit",
      address: currentAddress,
      walletMode: ctx.walletMode,
    });
  } else if (panelState.inlineDepositHost) {
    closeInlineDeposit();
  } else {
    panelState.activeView = "order";
  }
}

function clearDepositDoneReturnTimer(): void {
  if (panelState.depositDoneReturnTimer) {
    clearTimeout(panelState.depositDoneReturnTimer);
    panelState.depositDoneReturnTimer = null;
  }
}

/** Tears the controller down (panel/inline close) and clears its side-effect
 * timers. */
export function disposeDepositController(): void {
  clearDepositDoneReturnTimer();
  if (panelState.depositControllerUnsub) {
    panelState.depositControllerUnsub();
    panelState.depositControllerUnsub = null;
  }
  if (panelState.depositController) {
    panelState.depositController.dispose();
    panelState.depositController = null;
  }
  panelState.depositPrevStep = null;
  panelState.depositInitiatedTxHashes.clear();
}

/**
 * Fires the transition-scoped deposit analytics (once per matching machine
 * step change, mirroring the old `executeDeposit` instrumentation) and
 * schedules the post-success return to the trade. Runs from the controller
 * subscription so it sees every state, not just re-rendered ones.
 */
function handleDepositTransition(state: FundingState): void {
  const prev = panelState.depositPrevStep;
  panelState.depositPrevStep = state.step;
  if (prev === state.step) return;

  // NOTE: `deposit_initiated` is NOT fired here — it fires from the gateway's
  // injected waitForTxReceipt dep once the on-chain receipt confirms success,
  // matching the baseline timing (see ensureDepositController).
  if (state.step === "done") {
    trackPanelAnalytics("deposit_completed", {
      statusSource: "balance_sync",
    });
    // Return to the trade once the balance is synced (bet buttons now show a
    // placeable Trade). Stream: close the inline host; panel: back to order.
    clearDepositDoneReturnTimer();
    panelState.depositDoneReturnTimer = setTimeout(() => {
      panelState.depositDoneReturnTimer = null;
      if (panelState.inlineDepositHost) {
        closeInlineDeposit();
      } else {
        panelState.activeView = "order";
        panelState.depositController?.dispatch({ type: "RESET" });
        rerender();
      }
    }, 3000);
  } else if (state.step === "error") {
    const props = getDepositEventProperties(state);
    trackPanelAnalytics("deposit_failed", {
      ...props,
      errorMessage: state.error.message,
    });
  }
}

const BALANCE_OF_SIG = "0x70a08231";

function encodeBalanceOfCall(owner: string): string {
  return (
    BALANCE_OF_SIG + owner.toLowerCase().replace("0x", "").padStart(64, "0")
  );
}

function balanceHexToBigInt(hex: string): bigint {
  if (!hex || hex === "0x" || hex === "0x0") return 0n;
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!clean || clean === "0") return 0n;
  return BigInt(`0x${clean}`);
}

function parseBalanceHex(hex: string, decimals: number): number {
  const raw = balanceHexToBigInt(hex);
  if (raw <= 0n) return 0;
  const scale = 10n ** BigInt(decimals);
  const integerPart = raw / scale;
  const remainder = raw % scale;
  const fracStr = remainder.toString().padStart(decimals, "0");
  return Number(`${integerPart}.${fracStr}`);
}

async function waitForTxReceipt(
  txHash: string,
  pollingInterval = 5000,
  timeout = 180_000
): Promise<{ status: "success" | "reverted" }> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const receipt = await WalletBridge.getTransactionReceipt(txHash);
      if (receipt?.status) {
        return { status: receipt.status === "0x1" ? "success" : "reverted" };
      }
    } catch {
      // RPC error — retry
    }
    await new Promise((r) => setTimeout(r, pollingInterval));
  }
  throw new Error(
    "Transaction confirmation timed out. Check your wallet or Polygonscan."
  );
}

const STABLECOINS = new Set([
  "USDC",
  "USDC.e",
  "USDC.E",
  "pUSD",
  "USDT",
  "DAI",
]);

const PRICE_CACHE_TTL = 5 * 60 * 1000;

async function fetchTokenPrices(): Promise<Record<string, number>> {
  if (
    panelState.cachedPrices &&
    Date.now() - panelState.pricesFetchedAt < PRICE_CACHE_TTL
  ) {
    return panelState.cachedPrices;
  }
  const baseUrl = window.KNOWW_CONFIG?.KNOWW_APP_URL || "https://knoww.app";
  const data = await new Promise<{ prices?: Record<string, number> }>(
    (resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: "fetch-json",
          url: `${baseUrl}/api/price/tokens`,
          method: "GET",
        },
        (response: { ok: boolean; data?: unknown; error?: string }) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!response?.ok) {
            reject(new Error(response?.error || "Price fetch failed"));
            return;
          }
          resolve(response.data as { prices?: Record<string, number> });
        }
      );
    }
  );
  if (data?.prices) {
    panelState.cachedPrices = data.prices;
    panelState.pricesFetchedAt = Date.now();
    return data.prices;
  }
  throw new Error("No prices in response");
}

function getTokenPrice(symbol: string, prices: Record<string, number>): number {
  if (prices[symbol] !== undefined) return prices[symbol];
  if (STABLECOINS.has(symbol)) return 1;
  return 0;
}

async function ensurePolygonChain(): Promise<void> {
  try {
    const chainId = await WalletBridge.getChainId();
    if (chainId !== POLYGON_CHAIN_ID_HEX) {
      await WalletBridge.switchChain(POLYGON_CHAIN_ID_HEX);
    }
  } catch {
    throw new Error("Please switch your wallet to Polygon network.");
  }
}

async function fetchEoaBalancesViaWallet(
  eoaAddress: string
): Promise<DepositToken[]> {
  await ensurePolygonChain();

  let prices: Record<string, number> = {};
  try {
    prices = await fetchTokenPrices();
  } catch {
    // Price API unavailable — stablecoins still get $1 via getTokenPrice
  }

  const callData = encodeBalanceOfCall(eoaAddress);
  const tokens: DepositToken[] = [];

  const erc20Results = await Promise.allSettled(
    DEPOSIT_TOKENS.map((tok) => WalletBridge.ethCall(tok.address, callData))
  );

  for (let i = 0; i < DEPOSIT_TOKENS.length; i++) {
    const res = erc20Results[i];
    if (res.status !== "fulfilled") continue;
    const amountRaw = balanceHexToBigInt(res.value);
    const amount = parseBalanceHex(res.value, DEPOSIT_TOKENS[i].decimals);
    if (amount > 0) {
      const price = getTokenPrice(DEPOSIT_TOKENS[i].symbol, prices);
      tokens.push({
        symbol: DEPOSIT_TOKENS[i].symbol,
        amount,
        amountRaw: amountRaw.toString(),
        usdValue: amount * price,
        address: DEPOSIT_TOKENS[i].address,
        decimals: DEPOSIT_TOKENS[i].decimals,
        depositSupported: true,
      });
    }
  }

  try {
    const polHex = await WalletBridge.getBalance(eoaAddress);
    const polRaw = balanceHexToBigInt(polHex);
    const polAmount = parseBalanceHex(polHex, 18);
    if (polAmount > 0) {
      const polPrice = getTokenPrice("POL", prices);
      tokens.push({
        symbol: "POL",
        amount: polAmount,
        amountRaw: polRaw.toString(),
        usdValue: polAmount * polPrice,
        address: "native",
        decimals: 18,
      });
    }
  } catch {
    // POL balance fetch failed, skip
  }

  tokens.sort((a, b) => b.usdValue - a.usdValue);
  return tokens;
}

function withDepositLoadTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

export function startDepositFlow(eoaAddress: string): void {
  const controller = ensureDepositController();
  const ctx = TradingService.getContext();
  // Reset first so re-opening the flow (header Deposit, insufficient-balance
  // CTA) starts clean; then START seeds the connected address + wallet mode
  // the machine threads into every deposit command.
  controller.dispatch({ type: "RESET" });
  trackPanelAnalytics("deposit_opened");
  controller.dispatch({
    type: "START",
    flow: "deposit",
    address: eoaAddress,
    walletMode: ctx.walletMode,
  });
  rerender();
}

function hasBalanceIncreased(current: number, previous: number): boolean {
  return new Decimal(current).gt(new Decimal(previous).plus(0.001));
}

function parseDepositAmountRaw(
  amount: string,
  decimals: number
): bigint | null {
  try {
    return parseUnits(amount, decimals);
  } catch {
    return null;
  }
}

/** Live client-side over-balance check for the amount step's Continue gate.
 * The funding machine re-validates authoritatively on SUBMIT; this is only the
 * UX affordance. Uses the FundingToken's exact raw balance when known. */
function isFundingAmountOverBalance(
  amount: string,
  token: FundingToken
): boolean {
  const amountRaw = parseDepositAmountRaw(amount, token.decimals);
  if (amountRaw === null) return false;
  if (token.balanceRaw) return amountRaw > BigInt(token.balanceRaw);
  // Empty balanceDisplay = balance unknown → no client-side over-balance gate.
  if (token.balanceDisplay === "") return false;
  return new Decimal(formatDepositRawAmount(amountRaw, token.decimals)).gt(
    new Decimal(token.balanceDisplay)
  );
}

async function refreshDepositBalanceUntilSynced(
  previousBalance: number
): Promise<boolean> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < DEPOSIT_BALANCE_SYNC_TIMEOUT) {
    try {
      await TradingService.refreshBalance();
      if (
        hasBalanceIncreased(
          TradingService.getContext().balance,
          previousBalance
        )
      ) {
        rerender();
        return true;
      }
    } catch {
      /* retry until timeout */
    }

    await new Promise((resolve) =>
      setTimeout(resolve, DEPOSIT_BALANCE_SYNC_INTERVAL)
    );
  }

  try {
    await TradingService.refreshBalance();
  } catch {
    /* ignore final sync failure */
  }
  rerender();
  return hasBalanceIncreased(
    TradingService.getContext().balance,
    previousBalance
  );
}

const DEPOSIT_STABLE_SYMBOLS = new Set([
  "USDC",
  "USDC.e",
  "USDC.E",
  "pUSD",
  "DAI",
  "USDT",
]);

/** USD value of an entered token amount, using the token's implied unit price
 * (usdValue / balance); stablecoins are 1:1. Drives the amount step's live
 * min-deposit warnings — the machine still owns authoritative validation. */
function computeDepositEnteredUsd(token: FundingToken, amount: string): number {
  const numAmount = Number.parseFloat(amount);
  if (!amount || Number.isNaN(numAmount)) return 0;
  if (DEPOSIT_STABLE_SYMBOLS.has(token.symbol)) return numAmount;
  const balance = Number.parseFloat(token.balanceDisplay || "0");
  const usdValue = Number.parseFloat(token.usdValue || "0");
  if (balance <= 0 || usdValue <= 0) return 0;
  return (usdValue / balance) * numAmount;
}

// ── Deposit Form Renderers ──

const CHEVRON_16 = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`;
const CHEVRON_14 = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`;
const WARN_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;color:#f59e0b"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`;
const COPY_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

function renderDepositMethodStep(form: HTMLElement, ctx: TradingContext): void {
  const controller = ensureDepositController();

  // Wallet option
  const walletBtn = el("button", "knoww-tp-deposit-method-btn");
  const walletLeft = el("div", "knoww-tp-deposit-method-left");
  const walletIcon = el("div", "knoww-tp-deposit-method-icon wallet");
  walletIcon.textContent = "🦊";
  walletLeft.appendChild(walletIcon);
  const walletInfo = el("div", "knoww-tp-deposit-method-info");
  const walletName = el("div", "knoww-tp-deposit-method-name");
  walletName.textContent = ctx.address
    ? `Wallet (${truncAddr(ctx.address)})`
    : "Wallet (Not connected)";
  walletInfo.appendChild(walletName);
  // Balances load on demand now (SELECT_METHOD -> select-token), so the method
  // step no longer shows the wallet total up front.
  const walletSub = el(
    "div",
    "knoww-tp-deposit-method-sub",
    ctx.address ? "Instant" : "Connect wallet"
  );
  walletInfo.appendChild(walletSub);
  walletLeft.appendChild(walletInfo);
  walletBtn.appendChild(walletLeft);
  walletBtn.appendChild(
    elHtml("span", "knoww-tp-deposit-method-chevron", CHEVRON_16)
  );
  walletBtn.onclick = (e) => {
    e.stopPropagation();
    trackPanelAnalytics("deposit_method_selected", { depositMethod: "wallet" });
    controller.dispatch({ type: "SELECT_METHOD", method: "wallet" });
  };
  form.appendChild(walletBtn);

  // Divider
  const divider = el("div", "knoww-tp-deposit-divider");
  divider.appendChild(el("span", "knoww-tp-deposit-divider-line"));
  divider.appendChild(el("span", "knoww-tp-deposit-divider-text", "more"));
  divider.appendChild(el("span", "knoww-tp-deposit-divider-line"));
  form.appendChild(divider);

  // Bridge option
  const bridgeBtn = el("button", "knoww-tp-deposit-method-btn");
  const bridgeLeft = el("div", "knoww-tp-deposit-method-left");
  const bridgeIcon = el("div", "knoww-tp-deposit-method-icon bridge");
  bridgeIcon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 10 10-12h-9l1-10z"/></svg>`;
  bridgeLeft.appendChild(bridgeIcon);
  const bridgeInfo = el("div", "knoww-tp-deposit-method-info");
  bridgeInfo.appendChild(
    el("div", "knoww-tp-deposit-method-name", "Transfer Crypto")
  );
  bridgeInfo.appendChild(
    el("div", "knoww-tp-deposit-method-sub", "No limit • Instant")
  );
  bridgeLeft.appendChild(bridgeInfo);
  bridgeBtn.appendChild(bridgeLeft);
  const chainIcons = el("div", "knoww-tp-deposit-chain-icons");
  for (const icon of ["⟠", "⬡", "🔷", "🔵"]) {
    chainIcons.appendChild(el("span", "knoww-tp-deposit-chain-dot", icon));
  }
  bridgeBtn.appendChild(chainIcons);
  bridgeBtn.appendChild(
    elHtml("span", "knoww-tp-deposit-method-chevron", CHEVRON_16)
  );
  bridgeBtn.onclick = (e) => {
    e.stopPropagation();
    trackPanelAnalytics("deposit_method_selected", { depositMethod: "bridge" });
    controller.dispatch({ type: "SELECT_METHOD", method: "bridge" });
  };
  form.appendChild(bridgeBtn);

  // Card - Coming Soon
  const cardBtn = el("button", "knoww-tp-deposit-method-btn disabled");
  cardBtn.disabled = true;
  const cardLeft = el("div", "knoww-tp-deposit-method-left");
  const cardIcon = el("div", "knoww-tp-deposit-method-icon card");
  cardIcon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>`;
  cardLeft.appendChild(cardIcon);
  const cardInfo = el("div", "knoww-tp-deposit-method-info");
  cardInfo.appendChild(
    el("div", "knoww-tp-deposit-method-name", "Deposit with Card")
  );
  cardInfo.appendChild(
    el("div", "knoww-tp-deposit-method-sub", "$50,000 • 5 min")
  );
  cardLeft.appendChild(cardInfo);
  cardBtn.appendChild(cardLeft);
  cardBtn.appendChild(
    el("span", "knoww-tp-deposit-coming-soon", "Coming Soon")
  );
  form.appendChild(cardBtn);

  // Exchange - Coming Soon
  const exchBtn = el("button", "knoww-tp-deposit-method-btn disabled");
  exchBtn.disabled = true;
  const exchLeft = el("div", "knoww-tp-deposit-method-left");
  const exchIcon = el("div", "knoww-tp-deposit-method-icon exchange");
  exchIcon.innerHTML = I.refresh;
  exchLeft.appendChild(exchIcon);
  const exchInfo = el("div", "knoww-tp-deposit-method-info");
  exchInfo.appendChild(
    el("div", "knoww-tp-deposit-method-name", "Connect Exchange")
  );
  exchInfo.appendChild(
    el("div", "knoww-tp-deposit-method-sub", "No limit • 2 min")
  );
  exchLeft.appendChild(exchInfo);
  exchBtn.appendChild(exchLeft);
  exchBtn.appendChild(
    el("span", "knoww-tp-deposit-coming-soon", "Coming Soon")
  );
  form.appendChild(exchBtn);
}

function renderDepositTokenStep(
  form: HTMLElement,
  _ctx: TradingContext,
  state: Extract<FundingState, { step: "select-token" }>
): void {
  const controller = ensureDepositController();
  if (state.loading) {
    const loader = el("div", "knoww-tp-loading-section");
    loader.appendChild(el("div", "knoww-tp-spinner"));
    loader.appendChild(
      el("div", "knoww-tp-loading-text", "Loading wallet balances...")
    );
    form.appendChild(loader);
    return;
  }

  if (state.error) {
    const errRow = el("div", "knoww-tp-deposit-error");
    errRow.appendChild(elHtml("span", "knoww-tp-warn-icon", I.alert));
    errRow.appendChild(el("span", "", depositErrorCopy(state.error)));
    form.appendChild(errRow);
  }

  const MIN_BALANCE_USD = 2;

  if (state.tokens.length === 0) {
    const empty = el("div", "knoww-tp-deposit-empty");
    empty.appendChild(elHtml("span", "knoww-tp-deposit-empty-icon", I.wallet));
    empty.appendChild(
      el("div", "knoww-tp-deposit-empty-text", "No tokens found in your wallet")
    );
    empty.appendChild(
      el(
        "div",
        "knoww-tp-deposit-empty-sub",
        state.error
          ? "There was an issue fetching your balances. Please try again."
          : "Make sure you have tokens on Polygon network."
      )
    );
    form.appendChild(empty);
    return;
  }

  // Min deposit info banner. Per-token floors now live on FundingToken.minUsd;
  // this stays a generic hint.
  const infoBanner = el("div", "knoww-tp-deposit-info-banner warn");
  infoBanner.innerHTML = WARN_ICON_SVG;
  infoBanner.appendChild(
    el(
      "span",
      "",
      `Minimum deposit varies by token (typically $${MIN_BALANCE_USD}+)`
    )
  );
  form.appendChild(infoBanner);

  const tokenList = el("div", "knoww-tp-deposit-token-list");
  for (const tok of state.tokens) {
    const isDirectPusdDeposit = isPusdToken(tok.symbol, tok.address);
    const minDep = Number.parseFloat(tok.minUsd || "0");
    const usdValue = Number.parseFloat(tok.usdValue || "0");
    const amountNum = Number.parseFloat(tok.balanceDisplay || "0");
    const isUnsupported =
      tok.depositSupported === false && !isDirectPusdDeposit;
    const isBelowMinDeposit = minDep > 0 && usdValue < minDep;
    const isBelowMinBalance = usdValue < MIN_BALANCE_USD;
    const isDisabled =
      isUnsupported ||
      isBelowMinDeposit ||
      (!isDirectPusdDeposit && isBelowMinBalance);
    const row = el(
      "button",
      `knoww-tp-deposit-token-row${isDisabled ? " below-min" : ""}`
    );
    const dot = el("span", "knoww-tp-deposit-token-dot");
    const colorMap: Record<string, string> = {
      "usdc.e": "#2687d1",
      usdc: "#2687d1",
      usdt: "#26a17b",
      dai: "#f3ba2f",
      weth: "#627eea",
      pol: "#8247e5",
    };
    dot.style.backgroundColor = colorMap[tok.symbol.toLowerCase()] ?? "#a0a0a0";
    row.appendChild(dot);
    const symCol = el("div", "knoww-tp-deposit-token-info");
    symCol.appendChild(el("span", "knoww-tp-deposit-token-sym", tok.symbol));
    symCol.appendChild(
      el(
        "span",
        "knoww-tp-deposit-token-amt",
        `${amountNum.toFixed(5)} ${tok.symbol}`
      )
    );
    row.appendChild(symCol);
    const rightCol = el("div", "knoww-tp-deposit-token-right");
    if (isUnsupported) {
      rightCol.appendChild(
        el(
          "span",
          "knoww-tp-deposit-min-badge",
          tok.depositDisabledReason || "Unsupported"
        )
      );
    } else if (isDisabled) {
      const badgeAmount =
        !isDirectPusdDeposit && isBelowMinBalance ? MIN_BALANCE_USD : minDep;
      rightCol.appendChild(
        el("span", "knoww-tp-deposit-min-badge", `Min $${badgeAmount}`)
      );
    }
    rightCol.appendChild(
      el("span", "knoww-tp-deposit-token-usd", `$${usdValue.toFixed(2)}`)
    );
    row.appendChild(rightCol);
    if (isDisabled) {
      row.disabled = true;
    } else {
      row.onclick = (e) => {
        e.stopPropagation();
        trackPanelAnalytics("deposit_asset_selected", {
          depositMethod: "wallet",
          tokenSymbol: tok.symbol,
        });
        controller.dispatch({ type: "SELECT_TOKEN", token: tok });
      };
    }
    tokenList.appendChild(row);
  }
  form.appendChild(tokenList);
}

function renderDepositBridgeSelectStep(
  form: HTMLElement,
  _ctx: TradingContext,
  state: Extract<FundingState, { step: "select-bridge-asset" }>
): void {
  const controller = ensureDepositController();
  if (state.loading) {
    const loader = el("div", "knoww-tp-loading-section");
    loader.appendChild(el("div", "knoww-tp-spinner"));
    loader.appendChild(el("div", "knoww-tp-loading-text", "Loading assets..."));
    form.appendChild(loader);
    return;
  }

  if (state.error) {
    const errRow = el("div", "knoww-tp-deposit-error");
    errRow.appendChild(elHtml("span", "knoww-tp-warn-icon", I.alert));
    errRow.appendChild(el("span", "", depositErrorCopy(state.error)));
    form.appendChild(errRow);
  }

  // Search input (the machine owns the filtered `assets` view for `query`).
  const searchWrap = el("div", "knoww-tp-deposit-search-wrap");
  const searchInput = document.createElement("input");
  searchInput.className = "knoww-tp-deposit-search";
  searchInput.type = "text";
  searchInput.placeholder = "Search chain or token...";
  searchInput.value = state.query;
  searchInput.setAttribute("data-bridge-search", "true");
  searchInput.oninput = (e) => {
    controller.dispatch({
      type: "SET_QUERY",
      query: (e.target as HTMLInputElement).value,
    });
    const restored = depositDomRoot()?.querySelector<HTMLInputElement>(
      "[data-bridge-search]"
    );
    if (restored) restored.focus();
  };
  searchWrap.appendChild(searchInput);
  form.appendChild(searchWrap);

  // Info banner
  const infoBanner = el("div", "knoww-tp-deposit-info-banner info");
  infoBanner.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;color:var(--knoww-accent, #1d9bf0)"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`;
  infoBanner.appendChild(
    elHtml(
      "span",
      "",
      `All deposits are automatically converted to <strong style="color:var(--knoww-accent, #1d9bf0)">pUSD on Polygon</strong> (Polymarket's V2 trading token) at the best available rate.`
    )
  );
  form.appendChild(infoBanner);

  const list = el("div", "knoww-tp-deposit-bridge-list");
  for (const asset of state.assets) {
    const meta = CHAIN_METADATA[asset.chainId] || {
      name: `Chain ${asset.chainId}`,
      icon: "🔗",
      color: "#888",
    };
    const row = el("button", "knoww-tp-deposit-bridge-row");
    const chainIcon = el("div", "knoww-tp-deposit-bridge-icon");
    chainIcon.style.background = meta.color;
    chainIcon.textContent = meta.icon;
    row.appendChild(chainIcon);
    const info = el("div", "knoww-tp-deposit-bridge-info");
    info.appendChild(el("div", "knoww-tp-deposit-bridge-sym", asset.symbol));
    info.appendChild(
      el("div", "knoww-tp-deposit-bridge-chain", asset.chainName)
    );
    row.appendChild(info);
    const right = el("div", "knoww-tp-deposit-bridge-right");
    right.appendChild(el("span", "knoww-tp-deposit-bridge-min-label", "MIN"));
    right.appendChild(
      el("span", "knoww-tp-deposit-bridge-min-val", `$${asset.minCheckoutUsd}`)
    );
    row.appendChild(right);
    row.appendChild(
      elHtml("span", "knoww-tp-deposit-method-chevron", CHEVRON_14)
    );
    row.onclick = (e) => {
      e.stopPropagation();
      trackPanelAnalytics("deposit_asset_selected", {
        depositMethod: "bridge",
        tokenSymbol: asset.symbol,
        chainName: asset.chainName,
      });
      controller.dispatch({ type: "SELECT_BRIDGE_ASSET", asset });
    };
    list.appendChild(row);
  }
  form.appendChild(list);
}

function renderDepositAmountStep(
  form: HTMLElement,
  state: Extract<FundingState, { step: "amount" }>
): void {
  const controller = ensureDepositController();
  const token = state.token;
  if (!token) return;
  const needsConversion = !isPusdToken(token.symbol, token.address);

  const maybeRequestQuote = (amount: string): void => {
    if (!needsConversion) return;
    const num = Number.parseFloat(amount);
    if (num > 0) controller.dispatch({ type: "REQUEST_QUOTE" });
  };

  // Large amount input centered
  const amtCenter = el("div", "knoww-tp-deposit-amt-center");
  const amtInput = document.createElement("input");
  amtInput.className = "knoww-tp-deposit-amt-input";
  amtInput.type = "text";
  amtInput.placeholder = "0.00";
  amtInput.value = state.amount;
  amtInput.setAttribute("data-deposit-amt", "true");
  amtInput.oninput = (e) => {
    const amount = (e.target as HTMLInputElement).value.replace(/[^0-9.]/g, "");
    controller.dispatch({ type: "SET_AMOUNT", amount });
    maybeRequestQuote(amount);
    const restored =
      depositDomRoot()?.querySelector<HTMLInputElement>("[data-deposit-amt]");
    if (restored) restored.focus();
  };
  amtCenter.appendChild(amtInput);
  form.appendChild(amtCenter);

  // Percentage presets (exact raw balances when known; capped to 6 dp so the
  // machine's amount pattern accepts the value).
  const presets = el("div", "knoww-tp-deposit-presets");
  for (const pct of [25, 50, 75, 100]) {
    const label = pct === 100 ? "Max" : `${pct}%`;
    const btn = el("button", "knoww-tp-deposit-preset-btn", label);
    btn.onclick = (e) => {
      e.stopPropagation();
      let amount: string;
      if (token.balanceRaw) {
        const raw = (BigInt(token.balanceRaw) * BigInt(pct)) / 100n;
        amount = new Decimal(raw.toString())
          .div(new Decimal(10).pow(token.decimals))
          .toDecimalPlaces(6, Decimal.ROUND_DOWN)
          .toFixed();
      } else {
        amount = new Decimal(token.balanceDisplay || "0")
          .mul(pct)
          .div(100)
          .toDecimalPlaces(6, Decimal.ROUND_DOWN)
          .toFixed();
      }
      controller.dispatch({ type: "SET_AMOUNT", amount });
      maybeRequestQuote(amount);
    };
    presets.appendChild(btn);
  }
  form.appendChild(presets);

  // Send -> Receive summary
  const sendRecv = el("div", "knoww-tp-deposit-send-recv");
  sendRecv.appendChild(el("span", "", `You send: ${token.symbol}`));
  sendRecv.appendChild(
    elHtml(
      "span",
      "",
      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`
    )
  );
  sendRecv.appendChild(el("span", "", "You receive: pUSD"));
  form.appendChild(sendRecv);

  // Quote preview (only when the route needs conversion): estimated output /
  // total fees / time from the live FundingQuote, using the confirm card's
  // existing details-card markup. Baseline rendered these from depositQuote on
  // the confirm step; the machine fetches the quote here on the amount step
  // and carries it forward, so the preview surfaces the same fields live.
  if (needsConversion && (state.quoteLoading || state.quote)) {
    const previewCard = el("div", "knoww-tp-deposit-details-card");
    const recvRow = el("div", "knoww-tp-deposit-detail-row");
    recvRow.appendChild(
      el("span", "knoww-tp-deposit-detail-label", "You receive (est.)")
    );
    const recvVal = el("span", "knoww-tp-deposit-detail-value");
    if (state.quoteLoading) {
      recvVal.appendChild(el("span", "knoww-tp-deposit-inline-spinner"));
    } else if (state.quote) {
      recvVal.appendChild(
        document.createTextNode(
          `${state.quote.estOutputDisplay ?? state.quote.estOutputPusd} pUSD`
        )
      );
    }
    recvRow.appendChild(recvVal);
    previewCard.appendChild(recvRow);
    if (!state.quoteLoading && state.quote) {
      const feesRow = el("div", "knoww-tp-deposit-detail-row");
      feesRow.appendChild(
        el("span", "knoww-tp-deposit-detail-label", "Total fees")
      );
      feesRow.appendChild(
        el(
          "span",
          "knoww-tp-deposit-detail-value",
          `~$${state.quote.totalImpactUsd}`
        )
      );
      previewCard.appendChild(feesRow);
      if (state.quote.estCheckoutTimeMs !== undefined) {
        const timeRow = el("div", "knoww-tp-deposit-detail-row");
        timeRow.appendChild(
          el("span", "knoww-tp-deposit-detail-label", "Est. time")
        );
        timeRow.appendChild(
          el(
            "span",
            "knoww-tp-deposit-detail-value",
            formatCheckoutTime(state.quote.estCheckoutTimeMs)
          )
        );
        previewCard.appendChild(timeRow);
      }
    }
    form.appendChild(previewCard);
  }

  // Minimum deposit/balance warnings (live UX; machine re-validates on SUBMIT).
  const enteredUsd = computeDepositEnteredUsd(token, state.amount);
  const minDep = Number.parseFloat(token.minUsd || "0");
  const MIN_AMOUNT_USD = needsConversion ? 2 : 0;
  const isBelowMinBalance = enteredUsd > 0 && enteredUsd < MIN_AMOUNT_USD;
  const isBelowMinDeposit = enteredUsd > 0 && minDep > 0 && enteredUsd < minDep;

  if (state.amount && isBelowMinBalance) {
    const warn = el("div", "knoww-tp-deposit-info-banner warn");
    warn.innerHTML = WARN_ICON_SVG;
    warn.appendChild(
      el(
        "span",
        "",
        `Minimum amount is $${MIN_AMOUNT_USD}. You entered $${enteredUsd.toFixed(2)}.`
      )
    );
    form.appendChild(warn);
  } else if (state.amount && isBelowMinDeposit) {
    const warn = el("div", "knoww-tp-deposit-info-banner warn");
    warn.innerHTML = WARN_ICON_SVG;
    warn.appendChild(
      el(
        "span",
        "",
        `Minimum deposit is $${minDep}. You entered $${enteredUsd.toFixed(2)}.`
      )
    );
    form.appendChild(warn);
  }

  if (state.error) {
    const errRow = el("div", "knoww-tp-deposit-error");
    errRow.appendChild(elHtml("span", "knoww-tp-warn-icon", I.alert));
    errRow.appendChild(el("span", "", depositErrorCopy(state.error)));
    form.appendChild(errRow);
  }

  // Continue button
  const numAmt = Number.parseFloat(state.amount || "0");
  const overBalance = state.amount
    ? isFundingAmountOverBalance(state.amount, token)
    : false;
  const isValid =
    numAmt > 0 && !overBalance && !isBelowMinBalance && !isBelowMinDeposit;

  const btn = el("button", "knoww-tp-submit deposit");
  if (isBelowMinBalance) {
    btn.textContent = `Min. $${MIN_AMOUNT_USD} required`;
    btn.disabled = true;
  } else if (isBelowMinDeposit) {
    btn.textContent = `Min. $${minDep} required`;
    btn.disabled = true;
  } else if (overBalance) {
    btn.textContent = "Insufficient balance";
    btn.disabled = true;
  } else if (numAmt <= 0) {
    btn.textContent = "Enter amount";
    btn.disabled = true;
  } else {
    btn.textContent = "Continue";
  }
  btn.onclick = (e) => {
    e.stopPropagation();
    if (!isValid) return;
    controller.dispatch({ type: "SUBMIT" });
  };
  form.appendChild(btn);
}

/** Passive bridge-address branch (machine step "bridge-address-ready"): shows
 * the copy-address UI. It never dispatches SUBMIT. */
function renderBridgeAddressReady(
  form: HTMLElement,
  state: Extract<FundingState, { step: "bridge-address-ready" }>
): void {
  form.appendChild(
    el("div", "knoww-tp-deposit-confirm-title", `Deposit ${state.asset.symbol}`)
  );
  form.appendChild(
    el("div", "knoww-tp-deposit-confirm-sub", `on ${state.asset.chainName}`)
  );

  if (state.loading) {
    const loader = el("div", "knoww-tp-loading-section");
    loader.appendChild(el("div", "knoww-tp-spinner"));
    form.appendChild(loader);
    return;
  }

  const depositAddress = state.depositAddress;
  if (depositAddress) {
    const addrBox = el("div", "knoww-tp-deposit-addr-box");
    addrBox.appendChild(
      el(
        "div",
        "knoww-tp-deposit-addr-label",
        `Send ${state.asset.symbol} to this address`
      )
    );
    const addrRow = el("div", "knoww-tp-deposit-addr-row");
    addrRow.appendChild(
      el("code", "knoww-tp-deposit-addr-code", depositAddress)
    );
    const copyBtn = el("button", "knoww-tp-deposit-copy-btn");
    copyBtn.innerHTML = COPY_ICON_SVG;
    copyBtn.onclick = (e) => {
      e.stopPropagation();
      trackPanelAnalytics("deposit_address_copied", { method: "icon" });
      navigator.clipboard.writeText(depositAddress);
      copyBtn.innerHTML = I.check;
      setTimeout(() => {
        copyBtn.innerHTML = COPY_ICON_SVG;
      }, 2000);
    };
    addrRow.appendChild(copyBtn);
    addrBox.appendChild(addrRow);
    form.appendChild(addrBox);

    const copyFullBtn = el("button", "knoww-tp-submit deposit");
    copyFullBtn.textContent = "Copy Deposit Address";
    copyFullBtn.onclick = (e) => {
      e.stopPropagation();
      trackPanelAnalytics("deposit_address_copied", { method: "button" });
      navigator.clipboard.writeText(depositAddress);
      copyFullBtn.textContent = "Address Copied!";
      setTimeout(() => {
        copyFullBtn.textContent = "Copy Deposit Address";
      }, 2000);
    };
    form.appendChild(copyFullBtn);

    const minInfo = el("div", "knoww-tp-deposit-info-banner warn");
    minInfo.innerHTML = WARN_ICON_SVG;
    const minText = el("div", "");
    minText.appendChild(
      el("div", "", `Minimum: $${state.asset.minCheckoutUsd}`)
    );
    minText.appendChild(
      el(
        "div",
        "",
        "Assets will be converted to pUSD (Polymarket's V2 trading token) on Polygon."
      )
    );
    minText.style.fontSize = "11px";
    minInfo.appendChild(minText);
    form.appendChild(minInfo);
  } else {
    form.appendChild(
      el(
        "div",
        "knoww-tp-deposit-status-sub",
        (state.error ? depositErrorCopy(state.error) : null) ??
          "Failed to get deposit address. Please try again."
      )
    );
  }
}

function renderDepositConfirmStep(
  form: HTMLElement,
  ctx: TradingContext,
  state: FundingState
): void {
  const controller = ensureDepositController();

  if (state.step === "bridge-address-ready") {
    renderBridgeAddressReady(form, state);
    return;
  }

  // Wallet branch: confirm / submitting / confirming / done / error.
  const command =
    state.step === "confirm" ||
    state.step === "submitting" ||
    state.step === "confirming"
      ? state.command
      : state.step === "error"
        ? state.command
        : null;
  const depositCommand = command && command.flow === "deposit" ? command : null;
  const token = state.step === "confirm" ? state.token : null;
  const quote = state.step === "confirm" ? state.quote : null;
  const symbol = token?.symbol ?? depositCommand?.tokenSymbol ?? "";
  const tokenAddress = token?.address ?? depositCommand?.tokenAddress ?? "";
  const amount = depositCommand?.amount ?? "";
  const isDirect = symbol ? isPusdToken(symbol, tokenAddress) : false;

  // Done: brief success card before the auto-return timer fires.
  if (state.step === "done") {
    const successBanner = el("div", "knoww-tp-deposit-info-banner success");
    successBanner.innerHTML = I.check;
    const successText = el("div", "");
    successText.appendChild(el("div", "", "Deposit complete!"));
    successText.appendChild(
      el("div", "", "pUSD has been credited to your Polymarket wallet.")
    );
    successText.style.fontSize = "11px";
    successBanner.appendChild(successText);
    form.appendChild(successBanner);

    const doneBtn = el("button", "knoww-tp-submit deposit");
    doneBtn.innerHTML = `${I.check} Deposit Complete!`;
    doneBtn.disabled = true;
    form.appendChild(doneBtn);

    if (panelState.inlineDepositHost) {
      const backToTrade = el("button", "knoww-tp-submit", "Back to trade");
      backToTrade.onclick = (e) => {
        e.stopPropagation();
        closeInlineDeposit();
      };
      form.appendChild(backToTrade);
    }
    return;
  }

  const displayReceiveAmt = quote?.estOutputDisplay
    ? quote.estOutputDisplay
    : DEPOSIT_STABLE_SYMBOLS.has(symbol)
      ? Number.parseFloat(amount || "0").toFixed(2)
      : "";
  const estimatedTime = quote
    ? formatCheckoutTime(quote.estCheckoutTimeMs ?? 0)
    : isDirect
      ? "On-chain"
      : "< 2 min";

  // Amount display
  form.appendChild(
    el(
      "div",
      "knoww-tp-deposit-confirm-amount",
      `$${Number.parseFloat(amount || "0").toFixed(2)}`
    )
  );

  // Auto-conversion banner (hidden in the compact stream inline flow)
  if (symbol && symbol !== "pUSD" && !panelState.inlineDepositHost) {
    const banner = el("div", "knoww-tp-deposit-info-banner info");
    banner.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="flex-shrink:0;color:var(--knoww-accent, #1d9bf0)"><path d="M13 2L3 14h9l-1 10 10-12h-9l1-10z"/></svg>`;
    const text = el("div", "");
    text.appendChild(el("div", "", "Auto-conversion to pUSD"));
    text.appendChild(
      el(
        "div",
        "",
        `Your ${symbol} will be automatically converted to pUSD (Polymarket's V2 trading token) on Polygon via Polymarket Bridge.`
      )
    );
    text.style.fontSize = "11px";
    banner.appendChild(text);
    form.appendChild(banner);
  }

  // Details card (Source / Via / Destination / Est. time)
  if (!panelState.inlineDepositHost) {
    const details = el("div", "knoww-tp-deposit-details-card");
    const rows: Array<[string, string]> = [
      ["Source", `🦊 Wallet (${ctx.address ? truncAddr(ctx.address) : ""})`],
      ["Via", isDirect ? "Direct transfer" : "🌉 Polymarket Bridge"],
      ["Destination", "📊 Polymarket Wallet"],
      ["Est. time", estimatedTime],
    ];
    for (const [label, value] of rows) {
      const row = el("div", "knoww-tp-deposit-detail-row");
      row.appendChild(el("span", "knoww-tp-deposit-detail-label", label));
      row.appendChild(el("span", "knoww-tp-deposit-detail-value", value));
      details.appendChild(row);
    }
    form.appendChild(details);
  }

  // Transaction breakdown
  const breakdown = el("div", "knoww-tp-deposit-details-card");
  const sendRow = el("div", "knoww-tp-deposit-detail-row");
  sendRow.appendChild(el("span", "knoww-tp-deposit-detail-label", "You send"));
  sendRow.appendChild(
    el("span", "knoww-tp-deposit-detail-value", `${amount} ${symbol}`)
  );
  breakdown.appendChild(sendRow);

  const recvRow = el("div", "knoww-tp-deposit-detail-row");
  const recvLabel = el(
    "span",
    "knoww-tp-deposit-detail-label",
    `You receive ${quote ? "" : "(approx)"}`
  );
  recvRow.appendChild(recvLabel);
  recvRow.appendChild(
    el(
      "span",
      "knoww-tp-deposit-detail-value",
      `${quote ? "" : "~"}${displayReceiveAmt} pUSD`
    )
  );
  breakdown.appendChild(recvRow);

  // Fee breakdown — baseline markup (fee rows collected into feeBox; the
  // stream inline flow tucks it behind an (i) tooltip on "You receive").
  // Itemized rows render from FundingQuote.feeBreakdown (decimal strings,
  // converted at the gateway boundary); a quote without a breakdown falls
  // back to the aggregate totalImpactUsd row.
  const feeBox = document.createElement("div");
  if (isDirect) {
    const r = el("div", "knoww-tp-deposit-fee-row");
    r.appendChild(el("span", "knoww-tp-deposit-fee-label", "Network cost"));
    r.appendChild(el("span", "knoww-tp-deposit-fee-value", "Polygon gas"));
    feeBox.appendChild(r);
  } else if (quote?.feeBreakdown) {
    const fb = quote.feeBreakdown;
    // Baseline row set: gas always; swap/app/slippage when non-zero. Display
    // formatting only — the values stay decimal strings end to end.
    const feeRows: Array<[string, string]> = [
      ["Gas fee", `$${Number.parseFloat(fb.gasUsd).toFixed(4)}`],
    ];
    if (Number.parseFloat(fb.swapImpactUsd) > 0) {
      feeRows.push([
        "Swap impact",
        `$${Number.parseFloat(fb.swapImpactUsd).toFixed(4)}`,
      ]);
    }
    if (Number.parseFloat(fb.appFeeUsd) > 0) {
      feeRows.push([
        fb.appFeeLabel || "App fee",
        `$${Number.parseFloat(fb.appFeeUsd).toFixed(4)}`,
      ]);
    }
    if (Number.parseFloat(fb.maxSlippagePct) > 0) {
      feeRows.push(["Max slippage", `${fb.maxSlippagePct}%`]);
    }
    for (const [lbl, val] of feeRows) {
      const r = el("div", "knoww-tp-deposit-fee-row");
      r.appendChild(el("span", "knoww-tp-deposit-fee-label", lbl));
      r.appendChild(el("span", "knoww-tp-deposit-fee-value", val));
      feeBox.appendChild(r);
    }
    const minRecvRow = el("div", "knoww-tp-deposit-fee-row highlight");
    minRecvRow.appendChild(
      el("span", "knoww-tp-deposit-fee-label", "Min. received")
    );
    minRecvRow.appendChild(
      el("span", "knoww-tp-deposit-fee-value", `${fb.minReceivedDisplay} pUSD`)
    );
    feeBox.appendChild(minRecvRow);
  } else if (quote) {
    const r = el("div", "knoww-tp-deposit-fee-row");
    r.appendChild(el("span", "knoww-tp-deposit-fee-label", "Total fees"));
    r.appendChild(
      el("span", "knoww-tp-deposit-fee-value", `~$${quote.totalImpactUsd}`)
    );
    feeBox.appendChild(r);
  } else {
    const defaultFees: Array<[string, string]> = [
      ["Network cost", "~$0.01"],
      ["Bridge fee", "~0.1%"],
    ];
    for (const [lbl, val] of defaultFees) {
      const r = el("div", "knoww-tp-deposit-fee-row");
      r.appendChild(el("span", "knoww-tp-deposit-fee-label", lbl));
      r.appendChild(el("span", "knoww-tp-deposit-fee-value", val));
      feeBox.appendChild(r);
    }
  }

  if (panelState.inlineDepositHost) {
    // Stream: keep only You send / You receive; tuck the fee breakdown behind
    // a hover (i) on the "You receive" label.
    const info = el("span", "knoww-tp-deposit-fee-info");
    info.setAttribute("tabindex", "0");
    info.setAttribute("aria-label", "Fee details");
    info.appendChild(el("span", "knoww-tp-deposit-fee-info-icon", "ⓘ"));
    feeBox.classList.add("knoww-tp-deposit-fee-tooltip");
    info.appendChild(feeBox);
    recvLabel.appendChild(info);
  } else {
    const feeDivider = el("div", "knoww-tp-deposit-fee-divider");
    breakdown.appendChild(feeDivider);
    breakdown.appendChild(feeBox);
  }
  form.appendChild(breakdown);

  // On-chain confirmed, waiting for the deposited pUSD to credit.
  if (state.step === "confirming") {
    const infoBanner = el("div", "knoww-tp-deposit-info-banner success");
    infoBanner.innerHTML = I.check;
    const infoText = el("div", "");
    infoText.appendChild(el("div", "", "Transaction confirmed on-chain!"));
    infoText.appendChild(
      el(
        "div",
        "",
        isDirect
          ? "Finalizing direct pUSD transfer..."
          : "Waiting for bridge to credit pUSD to your wallet..."
      )
    );
    infoText.style.fontSize = "11px";
    infoBanner.appendChild(infoText);
    form.appendChild(infoBanner);
  }

  // Error display
  if (state.step === "error") {
    const errRow = el("div", "knoww-tp-deposit-error");
    errRow.appendChild(elHtml("span", "knoww-tp-warn-icon", I.alert));
    const raw = depositErrorCopy(state.error);
    const errText = raw.length > 150 ? `${raw.slice(0, 150)}...` : raw;
    errRow.appendChild(el("span", "", errText));
    form.appendChild(errRow);
  }

  // Terms
  form.appendChild(
    el(
      "div",
      "knoww-tp-deposit-terms",
      "By clicking Confirm Order, you agree to our terms."
    )
  );

  // Primary action
  const btn = el("button", "knoww-tp-submit deposit");
  if (state.step === "submitting") {
    btn.innerHTML = `<span class="knoww-tp-submit-spinner"></span> Confirm in Wallet...`;
    btn.disabled = true;
    btn.classList.add("loading");
    form.appendChild(btn);
  } else if (state.step === "confirming") {
    btn.innerHTML = `<span class="knoww-tp-submit-spinner"></span> Waiting for credit...`;
    btn.disabled = true;
    btn.classList.add("loading");
    form.appendChild(btn);
  } else if (state.step === "error") {
    if (state.error.retryable) {
      btn.textContent = "Retry";
      btn.onclick = (e) => {
        e.stopPropagation();
        controller.dispatch({ type: "RETRY" });
      };
      form.appendChild(btn);
    }
  } else {
    // "confirm"
    btn.textContent = "Confirm Order";
    btn.onclick = (e) => {
      e.stopPropagation();
      trackPanelAnalytics("deposit_confirm_clicked", {
        asset: symbol || null,
        amount: amount || null,
      });
      controller.dispatch({ type: "SUBMIT" });
    };
    form.appendChild(btn);
  }
}

export function renderDepositForm(p: HTMLElement, ctx: TradingContext): void {
  const controller = ensureDepositController();
  const state = controller.getState();
  const form = el("div", "knoww-tp-form");

  // Header with back button
  const headerRow = el("div", "knoww-tp-deposit-header-row");
  const backBtn = elHtml("button", "knoww-tp-back-btn", I.back);
  if (state.step === "method" || state.step === "idle") {
    backBtn.onclick = (e) => {
      e.stopPropagation();
      // Inline (stream): back exits the deposit and restores the card's bet
      // buttons; floating panel: back returns to the order view.
      if (panelState.inlineDepositHost) {
        closeInlineDeposit();
        return;
      }
      panelState.activeView = "order";
      controller.dispatch({ type: "RESET" });
      rerender();
    };
  } else {
    backBtn.onclick = (e) => {
      e.stopPropagation();
      controller.dispatch({ type: "BACK" });
    };
  }
  headerRow.appendChild(backBtn);

  const title = el("div", "knoww-tp-deposit-title", "Deposit");
  headerRow.appendChild(title);

  const balance = el(
    "div",
    "knoww-tp-deposit-header-bal",
    `Balance: $${formatTokenAmount(ctx.balance)}`
  );
  headerRow.appendChild(balance);
  form.appendChild(headerRow);

  // Stream-only contextual shortfall banner.
  if (panelState.panelOpts?.streamDeposit && state.step === "method") {
    const targetUsd = panelState.panelOpts.initialAmountUsd ?? 0;
    const shortfall = targetUsd - ctx.balance;
    if (targetUsd > 0 && shortfall > 0) {
      const banner = el("div", "knoww-tp-deposit-info-banner stream");
      banner.appendChild(
        el(
          "span",
          "",
          `Add $${shortfall.toFixed(2)} to place your $${targetUsd} ${panelState.panelOpts.outcomeName} trade`
        )
      );
      form.appendChild(banner);
    }
  }

  // Enable trading notice (blocks all steps)
  const needsTrading = !ctx.hasCredentials;
  if (needsTrading) {
    const enableTradingError =
      ctx.state === "error" && ctx.error
        ? formatTradingPanelErrorMessage(ctx.error)
        : null;
    const notice = el("div", "knoww-tp-deposit-notice");
    notice.appendChild(
      elHtml("span", "knoww-tp-deposit-notice-icon", I.shield)
    );
    const noticeText = el("div", "knoww-tp-deposit-notice-body");
    noticeText.appendChild(
      el("div", "knoww-tp-deposit-notice-title", "Enable trading first")
    );
    noticeText.appendChild(
      el(
        "div",
        "knoww-tp-deposit-notice-desc",
        enableTradingError
          ? "Trading could not be enabled. Retry to start a new signing request before depositing funds."
          : "You need to sign a message to enable trading before you can deposit funds."
      )
    );
    if (enableTradingError) {
      noticeText.appendChild(buildInlineError(ctx.error));
    }
    notice.appendChild(noticeText);
    form.appendChild(notice);
    addWalletModeSelector(form, ctx, setupViewUi);

    const enableBtn = el("button", "knoww-tp-submit deposit");
    enableBtn.textContent = enableTradingError ? "Retry" : "Enable Trading";
    enableBtn.onclick = (e) => {
      e.stopPropagation();
      setButtonLoading(enableBtn, "Waiting for signature…");
      panelState.activeView = "order";
      TradingService.deriveCredentials();
    };
    form.appendChild(enableBtn);
    p.appendChild(form);
    return;
  }

  // Render the current machine step.
  switch (state.step) {
    case "idle":
    case "method":
      renderDepositMethodStep(form, ctx);
      break;
    case "select-token":
      renderDepositTokenStep(form, ctx, state);
      break;
    case "select-bridge-asset":
      renderDepositBridgeSelectStep(form, ctx, state);
      break;
    case "amount":
      renderDepositAmountStep(form, state);
      break;
    case "bridge-address-ready":
    case "confirm":
    case "submitting":
    case "confirming":
    case "done":
    case "error":
      renderDepositConfirmStep(form, ctx, state);
      break;
  }

  p.appendChild(form);
}

export function mountInlineDeposit(args: {
  host: HTMLElement;
  opts: PanelOptions;
  onClose?: () => void;
  hidePanel(): void;
}): void {
  if (
    panelState.inlineDepositHost &&
    panelState.inlineDepositHost !== args.host
  ) {
    closeInlineDeposit(panelState.inlineDepositHost);
  }

  args.hidePanel();
  const host = args.host;
  panelState.inlineDepositHost = host;
  panelState.inlineDepositOnClose = args.onClose ?? null;
  panelState.panelOpts = args.opts;
  panelState.activeView = "deposit";
  panelState.inlineDepositUnsub = TradingService.onStateChange((ctx) => {
    if (panelState.inlineDepositHost !== host) return;
    if (!host.isConnected) {
      closeInlineDeposit(host);
      return;
    }
    syncDepositControllerAccount(ctx);
    if (panelState.inlineDepositHost === host) renderInlineDeposit();
  });

  const address = TradingService.getContext().address;
  if (address) startDepositFlow(address);
  else renderInlineDeposit();
}

// ── Main Render ──
