// ============================================
// UI COMPONENTS - Multi-Source Market Cards
// ============================================

import {
  parseGammaNumberArray,
  parseGammaStringArray,
  resolveNegRisk,
} from "@knoww/shared-types/polymarket";
import { Decimal } from "decimal.js";
import type {
  InjectedMarketEntry,
  Market,
  NestedMarket,
} from "../types/market";
import { setCspSafeImageSrc } from "./image-proxy";
import { prioritizeByPreferredOutcomeNames } from "./market-context";
import { WALLETCONNECT_WALLET_UUID, WalletBridge } from "./trading/bridge";
import { ExtensionSession } from "./trading/extension-session";
import { isTradingWalletDeploymentRequired } from "./trading/setup-gates";
import {
  canSellHolding,
  clampStake,
  formatHoldingLine,
  parseStreamStakeInput,
  pickHolding,
  resolvePrimarySportsMoneyline,
  type StreamHolding,
  sellButtonLabel,
  stepStake,
} from "./trading/stream-bet-logic";
import { TradingPanel } from "./trading/trading-panel";
import { TradingService } from "./trading/trading-service";
import { renderWalletConnectQrSvg } from "./trading/walletconnect-qr";
import { escapeHtml, escapeSelectorValue } from "./utils";

function clampGammaPrice(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function toDecimal(value: number | string | null | undefined): Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    const decimal = new Decimal(value);
    return decimal.isFinite() ? decimal : null;
  } catch {
    return null;
  }
}

function parseGammaPriceArray(
  raw: string | readonly unknown[] | null | undefined
): number[] {
  return parseGammaNumberArray(raw).map(clampGammaPrice);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = error as {
      code?: unknown;
      message?: unknown;
      shortMessage?: unknown;
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

function openTradingSetupSidePanel(): void {
  void window.KNOWW_UTILS.safeSendMessage({
    type: "KNOWW_OPEN_EXTENSION_SIDEPANEL",
    view: "portfolio",
  }).then((response?: { ok?: boolean; error?: string }) => {
    if (response?.ok === true) return;
    showScrollToast(
      response?.error || "Open the Knoww side panel to finish trading setup."
    );
  });
}

async function connectAndAuthorizePortfolioWallet(
  walletUuid?: string
): Promise<string> {
  await TradingService.connectWallet(walletUuid);
  const address = TradingService.getContext().address;
  if (!address) {
    throw new Error("Wallet connection was cancelled.");
  }
  await ExtensionSession.ensureAuthorized(address);
  return address;
}

async function switchAndAuthorizePortfolioWallet(): Promise<string> {
  await TradingService.switchWallet();
  const address = TradingService.getContext().address;
  if (!address) {
    throw new Error("Wallet switch was cancelled.");
  }
  await ExtensionSession.ensureAuthorized(address);
  return address;
}

/**
 * Extract the CLOB token ID for a given outcome index from a market.
 * Returns null if the market is Kalshi or the token ID is unavailable.
 */
function getTokenIdForOutcome(
  market: Market,
  outcomeIndex: number,
  marketIndex = 0
): string | null {
  if (market.source === "kalshi") return null;
  if (!market.markets || market.markets.length === 0) return null;

  const nestedMarket = market.markets[marketIndex] ?? market.markets[0];
  if (!nestedMarket?.clobTokenIds) return null;

  return parseGammaStringArray(nestedMarket.clobTokenIds)[outcomeIndex] ?? null;
}

/**
 * Extract token ID for a multi-outcome item by its market index.
 */
function getTokenIdForMultiOutcome(
  market: Market,
  marketIndex: number
): string | null {
  if (market.source === "kalshi") return null;
  if (!market.markets) return null;

  const nestedMarket = market.markets[marketIndex];
  if (!nestedMarket?.clobTokenIds) return null;

  return parseGammaStringArray(nestedMarket.clobTokenIds)[0] ?? null;
}

/**
 * Resolve a token ID — tries locally first, then fetches from the events API.
 * Opens the TradingPanel once resolved, or logs a warning if it can't.
 */
async function resolveTokenAndShowPanel(
  market: Market,
  outcomeName: string,
  outcomeIndex: number,
  price: number,
  anchorElement: HTMLElement,
  isMultiOutcome: boolean,
  marketIndex?: number,
  tradeOpts?: {
    amountUsd?: number;
    autoSubmit?: boolean;
    view?: "order" | "deposit";
    streamDeposit?: boolean;
  }
): Promise<void> {
  const { log } = window.KNOWW_UTILS;
  const panelAnchor =
    anchorElement.closest<HTMLElement>(".knoww-market-card") ?? anchorElement;

  let tokenId = isMultiOutcome
    ? getTokenIdForMultiOutcome(market, marketIndex ?? outcomeIndex)
    : getTokenIdForOutcome(market, outcomeIndex, marketIndex ?? 0);

  if (!tokenId) {
    anchorElement.style.opacity = "0.6";
    anchorElement.style.pointerEvents = "none";
    try {
      tokenId = await window.KNOWW_API.fetchClobTokenIds(
        market,
        outcomeIndex,
        isMultiOutcome,
        marketIndex
      );
    } finally {
      anchorElement.style.opacity = "";
      anchorElement.style.pointerEvents = "";
    }
  }

  if (tokenId) {
    const idx = marketIndex ?? 0;
    const nestedMarket = market.markets?.[idx];
    let conditionId: string | undefined;
    let yesTokenId: string | undefined;
    let noTokenId: string | undefined;

    if (nestedMarket) {
      conditionId = nestedMarket.conditionId as string | undefined;
      const ids = parseGammaStringArray(nestedMarket.clobTokenIds);
      if (ids.length >= 2) {
        yesTokenId = ids[0];
        noTokenId = ids[1];
        // fetchClobTokenIds may have returned a token from a different
        // sub-market ordering than market.markets. Re-derive tokenId from
        // the now-consistent clobTokenIds to avoid a stale mismatch.
        const corrected: string | undefined = isMultiOutcome
          ? ids[0]
          : ids[outcomeIndex];
        if (corrected) tokenId = corrected;
      }
    }

    TradingPanel.show({
      market,
      outcomeName,
      outcomeIndex,
      price,
      side: "BUY",
      tokenId: tokenId as string,
      negRisk: resolveNegRisk(nestedMarket, market),
      isMultiOutcome,
      anchorElement: panelAnchor,
      conditionId,
      yesTokenId,
      noTokenId,
      initialAmountUsd: tradeOpts?.amountUsd,
      autoSubmit: tradeOpts?.autoSubmit,
      initialView: tradeOpts?.view,
      streamDeposit: tradeOpts?.streamDeposit,
    });
    void window.KNOWW_ANALYTICS?.track("trading_panel_opened", {
      marketId: market.id,
      source: market.source || "polymarket",
      outcomeName,
      isMultiOutcome,
    });
    log(`Trading panel opened for ${outcomeName}`);
  } else {
    void window.KNOWW_ANALYTICS?.track("trading_panel_open_failed", {
      reason: "token_unresolved",
      marketId: market.id,
      outcomeName,
    });
    log(
      "Could not resolve tokenId for",
      outcomeName,
      "— cannot open trading panel"
    );
  }
}

// Color palette for multi-option markets — bright variants for dark-theme readability
const OPTION_COLORS = [
  "#fb7185", // Rose
  "#34d399", // Emerald
  "#60a5fa", // Sky blue
  "#fbbf24", // Amber
  "#c084fc", // Violet
  "#22d3ee", // Cyan
  "#f472b6", // Pink
  "#a3e635", // Lime
];

// Source branding configuration
interface SourceConfigItem {
  name: string;
  color: string;
  bgColor: string;
  icon: string;
}

const SOURCE_CONFIG: Record<string, SourceConfigItem> = {
  polymarket: {
    name: "Polymarket",
    color: "#7c3aed", // Purple
    bgColor: "rgba(124, 58, 237, 0.1)",
    icon: "P",
  },
  kalshi: {
    name: "Kalshi",
    color: "#f59e0b", // Amber/Orange
    bgColor: "rgba(245, 158, 11, 0.1)",
    icon: "K",
  },
};

// Multi-outcome data structure
interface MultiOutcomeItem {
  name: string;
  price: number;
  marketIndex: number;
  conditionId?: string;
}

interface ParsedOutcomeData {
  isMultiOutcome: boolean;
  outcomes: string[];
  prices: number[];
  multiOutcomeData: MultiOutcomeItem[];
  firstActiveMarketIndex: number;
}

interface MarketDisplayData extends ParsedOutcomeData {
  hasMultipleOptions: boolean;
}

const LIVE_MARKET_REFRESH_INTERVAL_MS = 30000;
const LIVE_MARKET_REFRESH_INITIAL_DELAY_MS = 5000;

/**
 * Safely resolve extension asset URLs.
 * Guards against "Extension context invalidated" after hot-reload/update.
 */
function getSafeRuntimeUrl(path: string): string | null {
  try {
    if (
      typeof chrome !== "undefined" &&
      chrome.runtime &&
      typeof chrome.runtime.getURL === "function"
    ) {
      return chrome.runtime.getURL(path);
    }
  } catch {
    // Extension context invalidated; caller should use fallback.
  }
  return null;
}

function applyPlatformStyleVariables(
  element: HTMLElement,
  styles: Record<string, unknown> | null | undefined
): void {
  if (!styles) return;

  const styleMap: Record<string, string> = {
    "--knoww-bg": "backgroundColor",
    "--knoww-border": "borderColor",
    "--knoww-text": "textColor",
    "--knoww-text-secondary": "secondaryTextColor",
    "--knoww-card-bg": "cardBg",
    "--knoww-accent": "accentColor",
    "--knoww-font": "fontFamily",
    "--knoww-radius": "borderRadius",
  };

  for (const [cssVariable, key] of Object.entries(styleMap)) {
    const value = styles[key];
    if (typeof value === "string" && value) {
      element.style.setProperty(cssVariable, value);
    }
  }
}

/**
 * Parse multi-outcome data from a market's markets array
 */
function parseMultiOutcomeData(market: Market): ParsedOutcomeData {
  const result: ParsedOutcomeData = {
    isMultiOutcome: false,
    outcomes: ["Yes", "No"],
    prices: [0.5, 0.5],
    multiOutcomeData: [],
    firstActiveMarketIndex: 0,
  };

  if (!market.markets || market.markets.length <= 1) {
    return result;
  }

  // Derive an outcome label from a sub-market. The search API sometimes
  // returns `groupItemTitle`, sometimes only `question`. Fall back to
  // extracting a short label from the question by stripping the common
  // "Will … [verb] <OUTCOME>?" wrapper.
  function getOutcomeLabel(
    m: NonNullable<typeof market.markets>[number]
  ): string | null {
    if (m.groupItemTitle) return m.groupItemTitle;
    if (!m.question) return null;
    // If the event title is embedded in the question, try to extract the
    // differing suffix as the outcome label. Example:
    //   event.title = "Which club will Cristiano Ronaldo play for next?"
    //   m.question  = "Will Cristiano Ronaldo play for Atlanta United FC next?"
    // We can't do a perfect extraction, so just use the full question
    // truncated to a reasonable label length.
    return m.question.length > 60
      ? `${m.question.slice(0, 57)}...`
      : m.question;
  }

  const activeMarketsWithLabel = market.markets.filter(
    (m) =>
      getOutcomeLabel(m) &&
      m.active !== false &&
      !(m as { closed?: boolean }).closed &&
      !(m as { archived?: boolean }).archived
  );

  if (activeMarketsWithLabel.length === 0) {
    return result;
  }

  const firstActiveIdx = market.markets.findIndex(
    (m) =>
      getOutcomeLabel(m) &&
      m.active !== false &&
      !(m as { closed?: boolean }).closed &&
      !(m as { archived?: boolean }).archived
  );
  if (firstActiveIdx >= 0) {
    result.firstActiveMarketIndex = firstActiveIdx;
  }

  result.isMultiOutcome = activeMarketsWithLabel.length >= 2;

  for (let i = 0; i < market.markets.length; i++) {
    const m = market.markets[i];
    const label = getOutcomeLabel(m);
    if (label) {
      if (m.active === false || (m as { closed?: boolean }).closed === true)
        continue;

      const name = label;
      if (name.startsWith("Individual ")) continue;

      let outcomePrice = 0.5;

      if (m.outcomePrices) {
        const parsedPrices = parseGammaPriceArray(m.outcomePrices);
        if (parsedPrices.length >= 1) {
          outcomePrice = parsedPrices[0];
        }
      }

      result.multiOutcomeData.push({
        name,
        price: outcomePrice,
        marketIndex: i,
        conditionId: m.conditionId,
      });
    }
  }

  // Sort by price descending (highest probability first)
  result.multiOutcomeData.sort((a, b) => b.price - a.price);
  result.multiOutcomeData = prioritizeByPreferredOutcomeNames(
    result.multiOutcomeData,
    market._preferredOutcomeNames
  );

  if (result.multiOutcomeData.length <= 1) {
    result.isMultiOutcome = false;
    result.multiOutcomeData = [];
    return result;
  }

  result.outcomes = result.multiOutcomeData.map((d) => d.name);
  result.prices = result.multiOutcomeData.map((d) => d.price);

  return result;
}

function resolveMarketDisplayData(market: Market): MarketDisplayData {
  const primarySportsMoneyline = resolvePrimarySportsMoneyline(market);
  if (primarySportsMoneyline) {
    const primaryMoneylineOptions =
      primarySportsMoneyline.multiOutcomeData ?? [];
    return {
      isMultiOutcome: primaryMoneylineOptions.length > 0,
      outcomes: primarySportsMoneyline.outcomes,
      prices: primarySportsMoneyline.prices,
      multiOutcomeData: primaryMoneylineOptions,
      firstActiveMarketIndex: primarySportsMoneyline.marketIndex,
      hasMultipleOptions: primaryMoneylineOptions.length > 2,
    };
  }

  const parsed = parseMultiOutcomeData(market);
  let outcomes = parsed.outcomes;
  let prices: number[] = parsed.prices;
  const isMultiOutcomeEvent = parsed.isMultiOutcome;
  const multiOutcomeData = parsed.multiOutcomeData;
  const firstActiveMarketIndex = parsed.firstActiveMarketIndex;
  let hasMultipleOptions = multiOutcomeData.length > 2;

  if (!isMultiOutcomeEvent && market.markets && market.markets.length > 0) {
    const firstMarket =
      market.markets[parsed.firstActiveMarketIndex] ?? market.markets[0];

    if (firstMarket.outcomePrices) {
      prices = parseGammaPriceArray(firstMarket.outcomePrices);
    }

    if (firstMarket.outcomes) {
      outcomes = parseGammaStringArray(firstMarket.outcomes);
      hasMultipleOptions = outcomes.length > 2;
    }

    if (prices.length >= 2 && outcomes.length === 0) {
      outcomes = ["Yes", "No"];
    }

    if (outcomes.length === 0 || prices.length === 0) {
      if (firstMarket.groupItemTitle) {
        outcomes = [firstMarket.groupItemTitle];
        if (firstMarket.outcomePrices) {
          prices = parseGammaPriceArray(firstMarket.outcomePrices);
        }
      } else {
        outcomes = ["Yes", "No"];
        prices = [0.5, 0.5];
      }
    }
  }

  if (outcomes.length === 0 && market.outcomes) {
    outcomes = market.outcomes.map((o) => o.title || o.name || "Unknown");
    prices = market.outcomes.map((o) => o.price || 0.5);
    hasMultipleOptions = outcomes.length > 2;
  }

  if (outcomes.length === 0) {
    outcomes = ["Yes", "No"];
    prices = [0.5, 0.5];
  }

  while (prices.length < outcomes.length) {
    prices.push(0.5);
  }

  return {
    isMultiOutcome: isMultiOutcomeEvent,
    outcomes,
    prices,
    multiOutcomeData,
    firstActiveMarketIndex,
    hasMultipleOptions,
  };
}

const OPTION_INDICATOR_CLASSES = [
  "option-1",
  "option-2",
  "option-3",
  "option-4",
  "option-5",
];

/**
 * Render outcome prices into a container element.
 * Handles any count: 0 (empty), 1 (single row), 2 binary Yes/No,
 * 2 multi-outcome, or N outcomes.
 * @param maxItems - cap the number of displayed outcomes (0 = no limit)
 */
function renderOutcomePrices(
  container: HTMLElement,
  outcomes: string[],
  priceData: number[],
  maxItems = 0
): void {
  if (outcomes.length === 0) return;

  const displayOutcomes = maxItems > 0 ? outcomes.slice(0, maxItems) : outcomes;
  const displayPrices = maxItems > 0 ? priceData.slice(0, maxItems) : priceData;

  const isBinary =
    displayOutcomes.length === 2 &&
    displayOutcomes[0].toLowerCase() === "yes" &&
    displayOutcomes[1].toLowerCase() === "no";

  if (isBinary) {
    const p1 = Math.round(displayPrices[0] * 100);
    const p2 = Math.round((displayPrices[1] ?? 1 - displayPrices[0]) * 100);
    container.innerHTML = `
      <span class="knoww-price-yes">${escapeHtml(displayOutcomes[0])} ${p1}%</span>
      <span class="knoww-price-no">${escapeHtml(displayOutcomes[1])} ${p2}%</span>
    `;
    return;
  }

  container.classList.add("knoww-multi-outcome");
  const rows: string[] = [];
  for (let i = 0; i < displayOutcomes.length; i++) {
    const cls = OPTION_INDICATOR_CLASSES[i % OPTION_INDICATOR_CLASSES.length];
    const pct = Math.round((displayPrices[i] ?? 0.5) * 100);
    // The probability bar's width is driven by `--knoww-pct` so the value
    // travels via a typed CSS custom property instead of a raw inline width
    // string — keeps the visual treatment owned by the stylesheet.
    rows.push(`
      <div class="knoww-outcome-row" style="--knoww-pct: ${pct}%">
        <div class="knoww-outcome-indicator ${cls}"></div>
        <span class="knoww-outcome-name">${escapeHtml(displayOutcomes[i])}</span>
        <span class="knoww-outcome-percent ${cls}">${pct}%</span>
        <div class="knoww-outcome-bar ${cls}" aria-hidden="true"></div>
      </div>
    `);
  }
  container.innerHTML = rows.join("");
}

/**
 * Build market URL based on source (Polymarket via Knoww, or Kalshi direct)
 */
function buildMarketUrl(
  market: Market,
  outcomeIndex = 0,
  side = "BUY"
): string {
  if (market.source === "kalshi") {
    return buildKalshiUrl(market);
  }
  return buildKnowwUrl(market, outcomeIndex, side);
}

/**
 * Build Kalshi market URL
 */
function buildKalshiUrl(market: Market): string {
  const { KALSHI_WEB_URL } = window.KNOWW_CONFIG;
  const baseUrl = KALSHI_WEB_URL || "https://kalshi.com";

  if (market.eventTicker) {
    return `${baseUrl}/events/${market.eventTicker}`;
  }

  return `${baseUrl}/markets/${market.ticker || market.id}`;
}

/**
 * Build Knoww.app URL for a specific outcome (Polymarket)
 */
function buildKnowwUrl(market: Market, outcomeIndex = 0, side = "BUY"): string {
  const { KNOWW_APP_URL } = window.KNOWW_CONFIG;
  const baseUrl = KNOWW_APP_URL || "https://knoww.app";

  let conditionId: string | null = null;
  if (market.markets && market.markets.length > 0) {
    conditionId = market.markets[0].conditionId || null;
  }

  if (market.slug) {
    const url = `${baseUrl}/events/detail/${market.slug}`;
    const params = new URLSearchParams();
    params.set("side", side.toUpperCase());
    params.set("outcome", outcomeIndex === 0 ? "yes" : "no");
    if (conditionId) {
      params.set("conditionId", conditionId);
    }
    return `${url}?${params.toString()}`;
  }

  if (market.id) {
    const url = `${baseUrl}/events/detail/${market.id}`;
    const params = new URLSearchParams();
    params.set("side", side.toUpperCase());
    params.set("outcome", outcomeIndex === 0 ? "yes" : "no");
    if (conditionId) {
      params.set("conditionId", conditionId);
    }
    return `${url}?${params.toString()}`;
  }

  return baseUrl;
}

/**
 * Build Knoww.app URL for a multi-outcome event's specific outcome
 */
function buildKnowwUrlForOutcome(
  market: Market,
  outcomeData: unknown,
  side = "BUY"
): string {
  const data = outcomeData as MultiOutcomeItem;
  const { KNOWW_APP_URL } = window.KNOWW_CONFIG;
  const baseUrl = KNOWW_APP_URL || "https://knoww.app";

  const slug = market.slug || market.id;
  if (!slug) return baseUrl;

  const url = `${baseUrl}/events/detail/${slug}`;
  const params = new URLSearchParams();
  params.set("side", side.toUpperCase());
  params.set("outcome", "yes");
  if (data.conditionId) {
    params.set("conditionId", data.conditionId);
  }

  return `${url}?${params.toString()}`;
}

function normalizeOutcomeName(name: string): string {
  return name.trim().toLowerCase();
}

function formatProbability(price: number | undefined): string {
  const safePrice =
    typeof price === "number" && Number.isFinite(price) ? price : 0.5;
  return `${Math.round(safePrice * 100)}%`;
}

function getUpdatedOutcomePrice(
  displayData: MarketDisplayData,
  outcomeName: string,
  fallbackIndex: number
): number {
  const lookup = new Map<string, number>();
  for (let i = 0; i < displayData.outcomes.length; i++) {
    lookup.set(
      normalizeOutcomeName(displayData.outcomes[i]),
      displayData.prices[i] ?? 0.5
    );
  }
  for (const option of displayData.multiOutcomeData) {
    lookup.set(normalizeOutcomeName(option.name), option.price);
  }

  return (
    lookup.get(normalizeOutcomeName(outcomeName)) ??
    displayData.prices[fallbackIndex] ??
    0.5
  );
}

function updateInlineCardPrices(
  card: HTMLElement,
  state: {
    outcomes: string[];
    prices: number[];
    multiOutcomeData: MultiOutcomeItem[];
  },
  freshMarket: Market
): void {
  const displayData = resolveMarketDisplayData(freshMarket);
  const nextPrices = state.outcomes.map((outcome, index) =>
    getUpdatedOutcomePrice(displayData, outcome, index)
  );

  state.prices.splice(0, state.prices.length, ...nextPrices);

  const freshOptionsByName = new Map(
    displayData.multiOutcomeData.map((option) => [
      normalizeOutcomeName(option.name),
      option,
    ])
  );
  for (let i = 0; i < state.multiOutcomeData.length; i++) {
    const currentOption = state.multiOutcomeData[i];
    const freshOption =
      freshOptionsByName.get(normalizeOutcomeName(currentOption.name)) ??
      displayData.multiOutcomeData[i];
    if (!freshOption) continue;
    currentOption.price = freshOption.price;
    currentOption.conditionId = freshOption.conditionId;
  }

  const summaryItems = Array.from(
    card.querySelectorAll<HTMLElement>(".knoww-card-mini-summary span")
  );
  for (let i = 0; i < summaryItems.length; i++) {
    const outcome = state.outcomes[i];
    if (!outcome) continue;
    summaryItems[i].textContent = `${outcome} ${formatProbability(
      state.prices[i]
    )}`;
  }

  const outcomeButtons = Array.from(
    card.querySelectorAll<HTMLElement>(
      ".knoww-card-outcomes .knoww-outcome-btn"
    )
  );
  for (let i = 0; i < outcomeButtons.length; i++) {
    const price = outcomeButtons[i].querySelector<HTMLElement>(
      ".knoww-outcome-price"
    );
    if (price) price.textContent = formatProbability(state.prices[i]);
  }

  const optionRows = Array.from(
    card.querySelectorAll<HTMLElement>(".knoww-options-list .knoww-option-row")
  );
  for (let i = 0; i < optionRows.length; i++) {
    const row = optionRows[i];
    const name =
      row.querySelector<HTMLElement>(".knoww-option-name")?.textContent ?? "";
    const option =
      state.multiOutcomeData.find(
        (item) => normalizeOutcomeName(item.name) === normalizeOutcomeName(name)
      ) ?? state.multiOutcomeData[i + 2];
    if (!option) continue;

    const pct = formatProbability(option.price);
    row.style.setProperty("--knoww-pct", pct);
    const percent = row.querySelector<HTMLElement>(".knoww-option-percent");
    if (percent) percent.textContent = pct;
  }

  card.setAttribute("data-knoww-live-price-updated-at", String(Date.now()));
}

function mergeFreshMarketIntoCurrent(
  currentMarket: Market,
  freshMarket: Market
): void {
  const contextReason = currentMarket._contextReason;
  const aiConfidence = currentMarket._aiConfidence;

  Object.assign(currentMarket, freshMarket);

  if (contextReason && !currentMarket._contextReason) {
    currentMarket._contextReason = contextReason;
  }
  if (aiConfidence !== undefined && currentMarket._aiConfidence === undefined) {
    currentMarket._aiConfidence = aiConfidence;
  }
}

function startLiveMarketPriceUpdates(
  card: HTMLElement,
  market: Market,
  state: {
    outcomes: string[];
    prices: number[];
    multiOutcomeData: MultiOutcomeItem[];
  }
): void {
  if (market.source !== "polymarket") return;

  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = (delayMs: number) => {
    timer = setTimeout(refresh, delayMs);
  };

  const refresh = async () => {
    if (!document.body.contains(card)) {
      if (timer) clearTimeout(timer);
      return;
    }

    if (document.visibilityState === "hidden") {
      schedule(LIVE_MARKET_REFRESH_INTERVAL_MS);
      return;
    }

    const freshMarket =
      await window.KNOWW_API?.fetchPolymarketEventRefresh?.(market);
    if (freshMarket && document.body.contains(card)) {
      mergeFreshMarketIntoCurrent(market, freshMarket);
      updateInlineCardPrices(card, state, market);
    }

    schedule(LIVE_MARKET_REFRESH_INTERVAL_MS);
  };

  schedule(LIVE_MARKET_REFRESH_INITIAL_DELAY_MS);
}

/**
 * Create a market card (supports multiple sources: Polymarket, Kalshi)
 */
function createInlineMarketCard(
  market: Market,
  _relevanceScore: number,
  _contextTopics: string[]
): HTMLElement {
  const { log } = window.KNOWW_UTILS;
  const { KNOWW_APP_URL } = window.KNOWW_CONFIG;
  const currentPlatform = window.KNOWW_PLATFORM?.getCurrentPlatform?.();
  const isKalshiPage = currentPlatform?.name === "kalshi-platform";

  const marketSource = market.source || "polymarket";
  const sourceConfig = SOURCE_CONFIG[marketSource] || SOURCE_CONFIG.polymarket;

  const card = document.createElement("div");
  card.className = `knoww-market-card knoww-source-${marketSource}`;
  card.setAttribute("data-knoww-market-id", market.id);
  card.setAttribute("data-knoww-source", marketSource);
  card.setAttribute("data-nth-injector-card", "true");

  if (isKalshiPage) {
    card.style.position = "relative";
    card.style.zIndex = "3";
    card.style.pointerEvents = "auto";
  }

  const displayData = resolveMarketDisplayData(market);
  const outcomes = displayData.outcomes;
  const prices: number[] = displayData.prices;
  const isMultiOutcomeEvent = displayData.isMultiOutcome;
  const multiOutcomeData = displayData.multiOutcomeData;
  const firstActiveMarketIdx = displayData.firstActiveMarketIndex;
  const hasMultipleOptions = displayData.hasMultipleOptions;

  // Header
  const header = document.createElement("div");
  header.className = "knoww-card-header";

  const icon = document.createElement("div");
  icon.className = "knoww-card-icon";

  let imageUrl = market.image;
  if (!imageUrl && market.markets && market.markets.length > 0) {
    imageUrl = (market.markets[0] as NestedMarket & { image?: string }).image;
  }

  // Build a data URI fallback for when chrome.runtime is unavailable
  const kalshiFallbackIcon =
    getSafeRuntimeUrl("icons/icon-48.png") ||
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Crect fill='%234a5568' width='48' height='48' rx='8'/%3E%3Ctext x='24' y='32' font-size='24' text-anchor='middle' fill='white'%3EK%3C/text%3E%3C/svg%3E";

  if (imageUrl) {
    const img = document.createElement("img");
    img.alt = "";
    img.decoding = "async";
    const renderFallback = () => {
      log("Image failed to load:", imageUrl);
      icon.innerHTML = "";
      if (marketSource === "kalshi") {
        const fallbackImg = document.createElement("img");
        fallbackImg.src = kalshiFallbackIcon;
        fallbackImg.alt = "Kalshi";
        fallbackImg.decoding = "async";
        icon.appendChild(fallbackImg);
      } else {
        icon.textContent = getMarketEmoji(market);
      }
    };
    img.onerror = renderFallback;
    setCspSafeImageSrc(img, imageUrl, renderFallback);
    icon.appendChild(img);
    log("Using event image:", imageUrl);
  } else {
    log("No image found, using fallback. Market data:", {
      hasImage: !!market.image,
      hasMarkets: !!market.markets,
      marketsCount: market.markets?.length,
      source: marketSource,
    });
    if (marketSource === "kalshi") {
      const img = document.createElement("img");
      img.src = kalshiFallbackIcon;
      img.alt = "Kalshi";
      img.decoding = "async";
      icon.appendChild(img);
    } else {
      icon.textContent = getMarketEmoji(market);
    }
  }

  const titleSection = document.createElement("div");
  titleSection.className = "knoww-card-title-section";

  const titleRow = document.createElement("div");
  titleRow.className = "knoww-card-title-row";
  titleRow.style.display = "flex";
  titleRow.style.justifyContent = "space-between";
  titleRow.style.alignItems = "flex-start";
  titleRow.style.gap = "8px";

  const title = document.createElement("div");
  title.className = "knoww-card-title";
  title.textContent = market.title || "Untitled Market";

  const headerActions = document.createElement("div");
  headerActions.className = "knoww-card-header-actions";

  const setMinimizeButtonIcon = (
    button: HTMLButtonElement,
    minimized: boolean
  ) => {
    button.innerHTML = minimized
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="18 15 12 9 6 15"/>
        </svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9"/>
        </svg>`;
  };

  const minimizeBtn = document.createElement("button");
  minimizeBtn.type = "button";
  minimizeBtn.className = "knoww-card-minimize-btn";
  minimizeBtn.title = "Minimize this market";
  minimizeBtn.setAttribute("aria-label", "Minimize this market");
  minimizeBtn.setAttribute("aria-expanded", "true");
  setMinimizeButtonIcon(minimizeBtn, false);

  const dismissBtn = document.createElement("button");
  dismissBtn.type = "button";
  dismissBtn.className = "knoww-card-dismiss-btn";
  dismissBtn.innerHTML = "✕";
  dismissBtn.title = "Dismiss this market";
  dismissBtn.setAttribute("aria-label", "Dismiss this market");
  dismissBtn.onclick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    void window.KNOWW_ANALYTICS?.track("market_card_dismissed", {
      marketId: market.id,
      source: marketSource,
    });

    TradingPanel.hide();

    card.style.height = `${card.offsetHeight}px`;
    card.style.overflow = "hidden";
    card.style.transition = "all 0.3s ease-out";

    void card.offsetHeight;

    card.style.height = "0px";
    card.style.opacity = "0";
    card.style.margin = "0";
    card.style.padding = "0";
    card.style.border = "none";

    setTimeout(() => {
      card.remove();
    }, 300);
  };

  const miniSummary = document.createElement("div");
  miniSummary.className = "knoww-card-mini-summary";
  const summaryCount = Math.min(outcomes.length, 2);
  {
    const isBinaryMiniMarket =
      !isMultiOutcomeEvent &&
      outcomes.length === 2 &&
      outcomes[0].toLowerCase() === "yes" &&
      outcomes[1].toLowerCase() === "no";
    const binaryMiniClasses = ["yes", "no"];
    const multiMiniClasses = ["option-1", "option-2"];
    for (let i = 0; i < summaryCount; i++) {
      const summaryItem = document.createElement("span");
      const variant = isBinaryMiniMarket
        ? binaryMiniClasses[i]
        : multiMiniClasses[i] || `option-${i + 1}`;
      summaryItem.className = `knoww-card-mini-price ${variant}`;
      summaryItem.textContent = `${outcomes[i]} ${Math.round(prices[i] * 100)}%`;
      miniSummary.appendChild(summaryItem);
    }
  }

  titleRow.appendChild(title);
  titleRow.appendChild(miniSummary);
  headerActions.appendChild(minimizeBtn);
  headerActions.appendChild(dismissBtn);
  titleRow.appendChild(headerActions);

  const volume = document.createElement("div");
  volume.className = "knoww-card-volume";
  if (market.volume24hr) {
    const volumeFormatted =
      market.volume24hr >= 1000000
        ? `${(market.volume24hr / 1000000).toFixed(1)}M`
        : market.volume24hr >= 1000
          ? `${(market.volume24hr / 1000).toFixed(1)}K`
          : `${market.volume24hr.toFixed(0)}`;
    // Format reads as "$1.3M · 24h vol" — the · separator gives the mono
    // uppercase line a clean break between the figure and the qualifier.
    volume.textContent = `$${volumeFormatted} · 24h vol`;
  }

  titleSection.appendChild(titleRow);
  titleSection.appendChild(volume);

  // Context line — shows why this market was matched to the post
  const contextReason = market._contextReason;
  if (contextReason) {
    const contextLine = document.createElement("div");
    contextLine.className = "knoww-card-context";
    contextLine.textContent = contextReason;
    titleSection.appendChild(contextLine);
  }

  header.appendChild(icon);
  header.appendChild(titleSection);

  // Outcome buttons
  const outcomesDiv = document.createElement("div");
  outcomesDiv.className = "knoww-card-outcomes";

  {
    const isBinaryMarket =
      !isMultiOutcomeEvent &&
      outcomes.length === 2 &&
      outcomes[0].toLowerCase() === "yes" &&
      outcomes[1].toLowerCase() === "no";

    const displayCount = Math.min(outcomes.length, 2);
    const binaryClasses = ["yes", "no"];
    const multiClasses = ["option-1", "option-2"];

    for (let idx = 0; idx < displayCount; idx++) {
      const btn = document.createElement("button");
      btn.className = `knoww-outcome-btn ${isBinaryMarket ? binaryClasses[idx] : multiClasses[idx] || `option-${idx + 1}`}`;
      if (displayCount === 1) btn.style.flex = "1";
      const percent = Math.round(prices[idx] * 100);
      btn.style.setProperty("--knoww-pct", `${percent}%`);
      const label = document.createElement("span");
      label.className = "knoww-outcome-label";
      label.textContent = outcomes[idx];
      const price = document.createElement("span");
      price.className = "knoww-outcome-price";
      price.textContent = `${percent}%`;
      btn.appendChild(label);
      btn.appendChild(price);

      const capturedIdx = idx;
      btn.onclick = (e) => {
        e.stopPropagation();
        void window.KNOWW_ANALYTICS?.track("market_card_clicked", {
          marketId: market.id,
          source: marketSource,
          action: "outcome_selected",
          outcomeName: outcomes[capturedIdx],
        });

        if (marketSource === "kalshi") {
          const url = buildKalshiUrl(market);
          log(`Opening Kalshi (${outcomes[capturedIdx]}):`, url);
          window.open(url, "_blank", "noopener,noreferrer");
          window.KNOWW_PREFERENCES?.recordClick(market);
          return;
        }

        const isMulti =
          isMultiOutcomeEvent && multiOutcomeData.length > capturedIdx;
        resolveTokenAndShowPanel(
          market,
          outcomes[capturedIdx],
          capturedIdx,
          prices[capturedIdx],
          btn,
          isMulti,
          isMulti
            ? multiOutcomeData[capturedIdx].marketIndex
            : firstActiveMarketIdx
        );
        window.KNOWW_PREFERENCES?.recordClick(market);
      };

      outcomesDiv.appendChild(btn);
    }
  }

  // Toggle options button (for multi-option markets)
  let toggleBtn: HTMLButtonElement | null = null;
  let optionsList: HTMLDivElement | null = null;

  if (isMultiOutcomeEvent && multiOutcomeData.length > 2) {
    toggleBtn = document.createElement("button");
    toggleBtn.className = "knoww-toggle-options";
    toggleBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
      <span>+${multiOutcomeData.length - 2} more options</span>
    `;

    optionsList = document.createElement("div");
    optionsList.className = "knoww-options-list";

    for (let i = 2; i < multiOutcomeData.length; i++) {
      const option = multiOutcomeData[i];
      const optionRow = document.createElement("div");
      optionRow.className = "knoww-option-row";
      optionRow.style.cursor = "pointer";

      const optionPct = Math.round(option.price * 100);
      // Drive the row's probability bar via a CSS custom property so the
      // visual treatment stays owned by the stylesheet.
      optionRow.style.setProperty("--knoww-pct", `${optionPct}%`);

      const optionClass = `option-${(i % OPTION_COLORS.length) + 1}`;

      const colorBar = document.createElement("div");
      colorBar.className = "knoww-option-color";
      colorBar.style.backgroundColor = OPTION_COLORS[i % OPTION_COLORS.length];

      const nameSpan = document.createElement("span");
      nameSpan.className = "knoww-option-name";
      nameSpan.textContent = option.name;

      const percentSpan = document.createElement("span");
      percentSpan.className = "knoww-option-percent";
      percentSpan.textContent = `${optionPct}%`;

      const probBar = document.createElement("div");
      probBar.className = `knoww-option-bar ${optionClass}`;
      probBar.setAttribute("aria-hidden", "true");

      optionRow.onclick = (e) => {
        e.stopPropagation();
        void window.KNOWW_ANALYTICS?.track("market_card_clicked", {
          marketId: market.id,
          source: marketSource,
          action: "outcome_selected",
          outcomeName: option.name,
        });
        if (marketSource === "polymarket") {
          resolveTokenAndShowPanel(
            market,
            option.name,
            option.marketIndex,
            option.price,
            optionRow,
            true,
            option.marketIndex
          );
        } else {
          const url = buildKnowwUrlForOutcome(market, option);
          window.open(url, "_blank", "noopener,noreferrer");
          log(`Opening Knoww (${option.name}):`, url);
        }
        window.KNOWW_PREFERENCES?.recordClick(market);
      };

      optionRow.appendChild(colorBar);
      optionRow.appendChild(nameSpan);
      optionRow.appendChild(percentSpan);
      optionRow.appendChild(probBar);
      optionsList.appendChild(optionRow);
    }

    const currentToggleBtn = toggleBtn;
    const currentOptionsList = optionsList;
    toggleBtn.onclick = (e) => {
      e.stopPropagation();
      const isExpanded = currentOptionsList.classList.contains("visible");
      void window.KNOWW_ANALYTICS?.track("market_card_options_toggled", {
        marketId: market.id,
        source: marketSource,
        expanded: !isExpanded,
        optionCount: multiOutcomeData.length,
      });
      if (isExpanded) {
        currentOptionsList.classList.remove("visible");
        currentToggleBtn.classList.remove("expanded");
        const spanEl = currentToggleBtn.querySelector("span");
        if (spanEl)
          spanEl.textContent = `+${multiOutcomeData.length - 2} more options`;
        const svgEl = currentToggleBtn.querySelector("svg");
        if (svgEl)
          svgEl.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';
      } else {
        currentOptionsList.classList.add("visible");
        currentToggleBtn.classList.add("expanded");
        const spanEl = currentToggleBtn.querySelector("span");
        if (spanEl) spanEl.textContent = "Hide options";
        const svgEl = currentToggleBtn.querySelector("svg");
        if (svgEl)
          svgEl.innerHTML = '<polyline points="18 15 12 9 6 15"></polyline>';
      }
    };
  } else if (
    hasMultipleOptions &&
    outcomes.length > 2 &&
    !isMultiOutcomeEvent
  ) {
    toggleBtn = document.createElement("button");
    toggleBtn.className = "knoww-toggle-options expanded";
    toggleBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="18 15 12 9 6 15"></polyline>
      </svg>
      <span>Hide options</span>
    `;

    optionsList = document.createElement("div");
    optionsList.className = "knoww-options-list visible";

    const optionsData = outcomes.map((outcome, i) => ({
      name: outcome,
      percent: Math.round(prices[i] * 100),
      color: OPTION_COLORS[i % OPTION_COLORS.length],
      index: i,
    }));

    optionsData.sort((a, b) => b.percent - a.percent);

    for (const option of optionsData) {
      const optionRow = document.createElement("div");
      optionRow.className = "knoww-option-row";
      optionRow.style.cursor = "pointer";
      optionRow.style.setProperty("--knoww-pct", `${option.percent}%`);

      const optionClass = `option-${(option.index % OPTION_COLORS.length) + 1}`;

      const colorBar = document.createElement("div");
      colorBar.className = "knoww-option-color";
      colorBar.style.backgroundColor = option.color;

      const nameSpan = document.createElement("span");
      nameSpan.className = "knoww-option-name";
      nameSpan.textContent = option.name;

      const percentSpan = document.createElement("span");
      percentSpan.className = "knoww-option-percent";
      percentSpan.textContent = `${option.percent}%`;

      const probBar = document.createElement("div");
      probBar.className = `knoww-option-bar ${optionClass}`;
      probBar.setAttribute("aria-hidden", "true");

      optionRow.onclick = (e) => {
        e.stopPropagation();
        void window.KNOWW_ANALYTICS?.track("market_card_clicked", {
          marketId: market.id,
          source: marketSource,
          action: "outcome_selected",
          outcomeName: option.name,
        });
        if (marketSource === "polymarket") {
          resolveTokenAndShowPanel(
            market,
            option.name,
            option.index,
            prices[option.index],
            optionRow,
            false
          );
        } else {
          const url = buildKnowwUrl(market, option.index, "BUY");
          window.open(url, "_blank", "noopener,noreferrer");
          log(`Opening Knoww (${option.name}):`, url);
        }
        window.KNOWW_PREFERENCES?.recordClick(market);
      };

      optionRow.appendChild(colorBar);
      optionRow.appendChild(nameSpan);
      optionRow.appendChild(percentSpan);
      optionRow.appendChild(probBar);
      optionsList.appendChild(optionRow);
    }

    const currentToggleBtn = toggleBtn;
    const currentOptionsList = optionsList;
    toggleBtn.onclick = (e) => {
      e.stopPropagation();
      const isExpanded = currentOptionsList.classList.contains("visible");
      void window.KNOWW_ANALYTICS?.track("market_card_options_toggled", {
        marketId: market.id,
        source: marketSource,
        expanded: !isExpanded,
        optionCount: outcomes.length,
      });
      if (isExpanded) {
        currentOptionsList.classList.remove("visible");
        currentToggleBtn.classList.remove("expanded");
        const spanEl = currentToggleBtn.querySelector("span");
        if (spanEl) spanEl.textContent = "Show options";
        const svgEl = currentToggleBtn.querySelector("svg");
        if (svgEl)
          svgEl.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';
      } else {
        currentOptionsList.classList.add("visible");
        currentToggleBtn.classList.add("expanded");
        const spanEl = currentToggleBtn.querySelector("span");
        if (spanEl) spanEl.textContent = "Hide options";
        const svgEl = currentToggleBtn.querySelector("svg");
        if (svgEl)
          svgEl.innerHTML = '<polyline points="18 15 12 9 6 15"></polyline>';
      }
    };
  }

  // Footer
  const footer = document.createElement("div");
  footer.className = "knoww-card-footer";

  const sourceBadge = document.createElement("div");
  sourceBadge.className = `knoww-source-badge knoww-source-${marketSource}`;
  sourceBadge.innerHTML = `
    <div class="knoww-source-icon" style="background-color: ${sourceConfig.color};">${sourceConfig.icon}</div>
    <span>${sourceConfig.name}</span>
  `;

  const viewMarket = document.createElement("button");
  viewMarket.className = "knoww-view-market";
  viewMarket.innerHTML = `
    View market
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M7 17L17 7M17 7H7M17 7V17"/>
    </svg>
  `;
  viewMarket.onclick = (e) => {
    e.stopPropagation();
    let marketUrl: string;

    if (marketSource === "kalshi") {
      marketUrl = buildKalshiUrl(market);
      log("Opening Kalshi:", marketUrl);
    } else {
      marketUrl = market.slug
        ? `${KNOWW_APP_URL}/events/detail/${market.slug}`
        : KNOWW_APP_URL;
      log("Opening Knoww:", marketUrl);
    }

    void window.KNOWW_ANALYTICS?.track("market_card_clicked", {
      marketId: market.id,
      source: marketSource,
      action: "view_market",
    });
    window.open(marketUrl, "_blank", "noopener,noreferrer");
    window.KNOWW_PREFERENCES?.recordClick(market);
  };

  footer.appendChild(sourceBadge);

  if (window.KNOWW_CONFIG?.isDebugMode?.() === true) {
    const feedbackGroup = document.createElement("div");
    feedbackGroup.className = "knoww-feedback-actions";
    feedbackGroup.setAttribute("aria-label", "Relevance feedback");

    const setFeedbackState = (
      selectedButton: HTMLButtonElement,
      otherButton: HTMLButtonElement
    ) => {
      selectedButton.classList.add("selected");
      selectedButton.setAttribute("aria-pressed", "true");
      otherButton.classList.remove("selected");
      otherButton.setAttribute("aria-pressed", "false");
    };

    const createFeedbackButton = (
      feedback: "good" | "bad",
      label: string
    ): HTMLButtonElement => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `knoww-feedback-btn ${feedback}`;
      button.textContent = label;
      button.title =
        feedback === "good" ? "Mark as a good match" : "Mark as a bad match";
      button.setAttribute("aria-label", button.title);
      button.setAttribute("aria-pressed", "false");
      return button;
    };

    const goodButton = createFeedbackButton("good", "Good");
    const badButton = createFeedbackButton("bad", "Bad");

    const recordFeedback = (
      feedback: "good" | "bad",
      selectedButton: HTMLButtonElement,
      otherButton: HTMLButtonElement
    ) => {
      setFeedbackState(selectedButton, otherButton);
      window.KNOWW_RELEVANCE_TELEMETRY?.recordFeedback?.({
        postKey: card.getAttribute("data-knoww-post-key") ?? undefined,
        marketId: market.id,
        marketTitle: market.title || "",
        source: marketSource,
        feedback,
      });
    };

    goodButton.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      recordFeedback("good", goodButton, badButton);
    };

    badButton.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      recordFeedback("bad", badButton, goodButton);
    };

    feedbackGroup.appendChild(goodButton);
    feedbackGroup.appendChild(badButton);
    footer.appendChild(feedbackGroup);
  }

  footer.appendChild(viewMarket);

  // Assemble card
  card.appendChild(header);
  if (outcomesDiv.children.length > 0) card.appendChild(outcomesDiv);
  if (toggleBtn) card.appendChild(toggleBtn);
  if (optionsList) card.appendChild(optionsList);
  card.appendChild(footer);

  const setCardMinimized = (minimized: boolean) => {
    card.classList.toggle("knoww-card-minimized", minimized);
    card.setAttribute("data-knoww-card-minimized", String(minimized));
    minimizeBtn.title = minimized
      ? "Expand this market"
      : "Minimize this market";
    minimizeBtn.setAttribute(
      "aria-label",
      minimized ? "Expand this market" : "Minimize this market"
    );
    minimizeBtn.setAttribute("aria-expanded", String(!minimized));
    setMinimizeButtonIcon(minimizeBtn, minimized);

    if (minimized) {
      TradingPanel.hide();
    }
  };

  minimizeBtn.onclick = (e) => {
    e.stopPropagation();
    e.preventDefault();

    const minimized = !card.classList.contains("knoww-card-minimized");
    setCardMinimized(minimized);
    void window.KNOWW_ANALYTICS?.track("market_card_minimized_toggled", {
      marketId: market.id,
      source: marketSource,
      minimized,
    });
  };

  card.addEventListener("dblclick", (event) => {
    if (!card.classList.contains("knoww-card-minimized")) return;
    event.stopPropagation();
    setCardMinimized(false);
  });

  if (isKalshiPage) {
    const stopKalshiTilePropagation = (event: MouseEvent): void => {
      event.stopPropagation();
    };

    card.addEventListener("click", stopKalshiTilePropagation);
    card.addEventListener("auxclick", stopKalshiTilePropagation);
  }

  startLiveMarketPriceUpdates(card, market, {
    outcomes,
    prices,
    multiOutcomeData,
  });

  return card;
}

/**
 * Get appropriate emoji for market based on tags/title
 */
function getMarketEmoji(market: Market): string {
  const title = (market.title || "").toLowerCase();
  const tags = (market.tags || []).map((t) =>
    (t.slug || t.label || "").toLowerCase()
  );
  const combined = `${title} ${tags.join(" ")}`;

  // Politics
  if (
    combined.includes("republican") ||
    combined.includes("gop") ||
    combined.includes("trump")
  )
    return "🐘";
  if (combined.includes("democrat") || combined.includes("biden")) return "🫏";
  if (
    combined.includes("election") ||
    combined.includes("vote") ||
    combined.includes("president")
  )
    return "🗳️";

  // Crypto
  if (combined.includes("bitcoin") || combined.includes("btc")) return "₿";
  if (combined.includes("ethereum") || combined.includes("eth")) return "⟠";
  if (combined.includes("crypto")) return "🪙";

  // Sports
  if (combined.includes("nfl") || combined.includes("football")) return "🏈";
  if (combined.includes("nba") || combined.includes("basketball")) return "🏀";
  if (combined.includes("mlb") || combined.includes("baseball")) return "⚾";
  if (combined.includes("soccer")) return "⚽";
  if (combined.includes("ufc") || combined.includes("mma")) return "🥊";
  if (combined.includes("f1") || combined.includes("formula")) return "🏎️";

  // Tech
  if (combined.includes("ai") || combined.includes("openai")) return "🤖";
  if (combined.includes("apple")) return "🍎";
  if (combined.includes("tesla") || combined.includes("musk")) return "🚗";
  if (combined.includes("space") || combined.includes("nasa")) return "🚀";

  // Geopolitics
  if (combined.includes("ukraine") || combined.includes("russia")) return "🌍";
  if (combined.includes("china")) return "🇨🇳";
  if (combined.includes("war") || combined.includes("military")) return "⚔️";

  // Economy
  if (
    combined.includes("fed") ||
    combined.includes("interest") ||
    combined.includes("inflation")
  )
    return "📈";
  if (combined.includes("stock") || combined.includes("market")) return "📊";

  // Entertainment
  if (combined.includes("oscar") || combined.includes("movie")) return "🎬";
  if (combined.includes("grammy") || combined.includes("music")) return "🎵";

  // Weather/Climate
  if (combined.includes("weather") || combined.includes("climate")) return "🌡️";
  if (combined.includes("hurricane") || combined.includes("storm")) return "🌀";

  // Default
  return "📊";
}

// ============================================
// NOTIFICATION STACK COMPONENT
// ============================================

let notificationStackContainer: HTMLElement | null = null;
let notificationStackListenersAttached = false; // Guard to prevent duplicate listeners on re-init
// Default caps; platforms can override via `maxActiveNotificationItems` and
// `maxNotificationItems` on their adapter (see `resolveNotificationCaps`).
const MAX_NOTIFICATION_ITEMS = 12;
const MAX_ACTIVE_NOTIFICATION_ITEMS = 4;

function resolveNotificationCaps(): { active: number; scrolled: number } {
  const platform = window.KNOWW_PLATFORM?.getCurrentPlatform?.();
  const activeOverride = platform?.maxActiveNotificationItems;
  const totalOverride = platform?.maxNotificationItems;

  const active =
    typeof activeOverride === "number" && activeOverride > 0
      ? Math.floor(activeOverride)
      : MAX_ACTIVE_NOTIFICATION_ITEMS;
  const total =
    typeof totalOverride === "number" && totalOverride > 0
      ? Math.floor(totalOverride)
      : MAX_NOTIFICATION_ITEMS;
  // Guarantee the scrolled-out bucket has at least one slot so the section
  // doesn't collapse when a platform sets active === total.
  const scrolled = Math.max(total - active, 0);
  return { active, scrolled };
}
const SCROLLED_OUT_GRACE_MS = 8000;

// Trending markets state
const TRENDING_FETCH_DELAY_MS = 10_000;
const TRENDING_SHUFFLE_INTERVAL_MS = 60_000;
const MAX_TRENDING_DISPLAY = 2;
const MAX_EXPANDED_TRENDING_DISPLAY = 10;
let trendingFetchTimer: ReturnType<typeof setTimeout> | null = null;
let trendingShuffleTimer: ReturnType<typeof setInterval> | null = null;
let trendingFetchInFlight = false;
let trendingPool: Market[] = [];
let visibleTrending: Market[] = [];

// ─── First-run welcome state ──────────────────────────────────────────
//
// On first install, users who reach the notification stack with no matched
// markets yet would otherwise see a terse "Searching for markets…" spinner
// with no indication that the extension is working correctly. A one-time
// welcome card orients them; once dismissed, we revert to the compact
// scanning state for the rest of the user's lifetime on this profile.

const WELCOME_SEEN_STORAGE_KEY = "knoww-stack-welcome-seen";

const WELCOME_SPARKLE_ICON_HTML = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.64 5.64l2.12 2.12M16.24 16.24l2.12 2.12M5.64 18.36l2.12-2.12M16.24 7.76l2.12-2.12"/>
  </svg>
`;

function readPersistedWelcomeSeen(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.storage?.local.get(WELCOME_SEEN_STORAGE_KEY, (result) => {
        if (chrome.runtime.lastError) {
          resolve(false);
          return;
        }
        resolve(Boolean(result?.[WELCOME_SEEN_STORAGE_KEY]));
      });
    } catch {
      resolve(false);
    }
  });
}

function persistWelcomeSeen(): void {
  try {
    chrome.storage?.local.set({ [WELCOME_SEEN_STORAGE_KEY]: true });
  } catch {
    // Non-fatal — if persistence fails, the welcome just shows again next time.
  }
}

function disconnectNotificationStackLifecyclePort(): void {
  if (notificationStackLifecycleTimer) {
    clearInterval(notificationStackLifecycleTimer);
    notificationStackLifecycleTimer = null;
  }

  if (notificationStackLifecyclePort) {
    try {
      notificationStackLifecyclePort.disconnect();
    } catch {
      // The port may already be disconnected if the background worker restarted.
    }
    notificationStackLifecyclePort = null;
  }
}

function ensureNotificationStackLifecyclePort(): void {
  if (notificationStackLifecyclePort) return;

  try {
    const port = chrome.runtime.connect({ name: NOTIFICATION_STACK_PORT_NAME });
    notificationStackLifecyclePort = port;
    port.postMessage({ type: "KNOWW_NOTIFICATION_STACK_ALIVE" });
    notificationStackLifecycleTimer = setInterval(() => {
      try {
        port.postMessage({ type: "KNOWW_NOTIFICATION_STACK_ALIVE" });
      } catch {
        disconnectNotificationStackLifecyclePort();
      }
    }, NOTIFICATION_STACK_LIFECYCLE_PING_MS);
    port.onDisconnect.addListener(() => {
      if (notificationStackLifecyclePort === port) {
        notificationStackLifecyclePort = null;
      }
      if (notificationStackLifecycleTimer) {
        clearInterval(notificationStackLifecycleTimer);
        notificationStackLifecycleTimer = null;
      }
    });
  } catch {
    notificationStackLifecyclePort = null;
  }
}

// ─── Minimize / expand state ───────────────────────────────────────────
//
// The notification stack can be collapsed to just its header when users
// want the panel out of the way. The collapsed preference is persisted
// per-origin so it survives page navigations and reloads.

const STACK_MINIMIZED_STORAGE_KEY = "knoww-stack-minimized";
const STACK_DISMISSED_STORAGE_KEY = "knoww-stack-dismissed";
const STACK_EXPANDED_SESSION_KEY = "knoww-stack-expanded";
const NOTIFICATION_STACK_VIEWPORT_MARGIN = 12;
const NOTIFICATION_STACK_PORT_NAME = "knoww-notification-stack";
const NOTIFICATION_STACK_LIFECYCLE_PING_MS = 20_000;

const STACK_MINIMIZE_ICON_HTML = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
`;

const STACK_EXPAND_ICON_HTML = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="18 15 12 9 6 15"/>
  </svg>
`;

type StackFilter = "all" | "active" | "seen" | "trending";

let cachedStackMinimized = false;
let cachedStackExpanded = readPersistedStackExpanded();
let cachedStackFilter: StackFilter = "all";
let notificationStackLifecyclePort: chrome.runtime.Port | null = null;
let notificationStackLifecycleTimer: ReturnType<typeof setInterval> | null =
  null;

function readPersistedStackMinimized(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.storage?.local.get(STACK_MINIMIZED_STORAGE_KEY, (result) => {
        if (chrome.runtime.lastError) {
          resolve(false);
          return;
        }
        resolve(Boolean(result?.[STACK_MINIMIZED_STORAGE_KEY]));
      });
    } catch {
      resolve(false);
    }
  });
}

function readPersistedStackDismissed(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.storage?.local.get(STACK_DISMISSED_STORAGE_KEY, (result) => {
        if (chrome.runtime.lastError) {
          resolve(false);
          return;
        }
        resolve(Boolean(result?.[STACK_DISMISSED_STORAGE_KEY]));
      });
    } catch {
      resolve(false);
    }
  });
}

function persistStackMinimized(value: boolean): void {
  try {
    chrome.storage?.local.set({ [STACK_MINIMIZED_STORAGE_KEY]: value });
  } catch {
    // Non-fatal; the UI state stays consistent for the current session.
  }
}

function persistStackDismissed(value: boolean): void {
  try {
    chrome.storage?.local.set({ [STACK_DISMISSED_STORAGE_KEY]: value });
  } catch {
    // Non-fatal; the current page still follows the user's action.
  }
}

function readPersistedStackExpanded(): boolean {
  try {
    return sessionStorage.getItem(STACK_EXPANDED_SESSION_KEY) === "true";
  } catch {
    return false;
  }
}

function persistStackExpanded(value: boolean): void {
  try {
    sessionStorage.setItem(
      STACK_EXPANDED_SESSION_KEY,
      value ? "true" : "false"
    );
  } catch {
    // Non-fatal; expanded state is session-only convenience.
  }
}

function applyMinimizedState(
  container: HTMLElement,
  toggleBtn: HTMLElement,
  minimized: boolean
): void {
  container.classList.toggle("knoww-stack-minimized", minimized);
  toggleBtn.innerHTML = minimized
    ? STACK_EXPAND_ICON_HTML
    : STACK_MINIMIZE_ICON_HTML;
  toggleBtn.title = minimized ? "Expand" : "Minimize";
  toggleBtn.setAttribute(
    "aria-label",
    minimized ? "Expand markets panel" : "Minimize markets panel"
  );
  toggleBtn.setAttribute("aria-expanded", minimized ? "false" : "true");
}

function applyStackExpandedState(
  container: HTMLElement,
  expanded: boolean
): void {
  container.classList.toggle("knoww-stack-expanded", expanded);
}

function clampNotificationStackToViewport(container: HTMLElement): void {
  const rect = container.getBoundingClientRect();
  const maxLeft = Math.max(
    NOTIFICATION_STACK_VIEWPORT_MARGIN,
    window.innerWidth - rect.width - NOTIFICATION_STACK_VIEWPORT_MARGIN
  );
  const maxTop = Math.max(
    NOTIFICATION_STACK_VIEWPORT_MARGIN,
    window.innerHeight - rect.height - NOTIFICATION_STACK_VIEWPORT_MARGIN
  );

  let nextLeft = rect.left;
  let nextTop = rect.top;
  let shouldClamp = false;

  if (rect.right > window.innerWidth - NOTIFICATION_STACK_VIEWPORT_MARGIN) {
    nextLeft = maxLeft;
    shouldClamp = true;
  }
  if (rect.left < NOTIFICATION_STACK_VIEWPORT_MARGIN) {
    nextLeft = NOTIFICATION_STACK_VIEWPORT_MARGIN;
    shouldClamp = true;
  }
  if (rect.bottom > window.innerHeight - NOTIFICATION_STACK_VIEWPORT_MARGIN) {
    nextTop = maxTop;
    shouldClamp = true;
  }
  if (rect.top < NOTIFICATION_STACK_VIEWPORT_MARGIN) {
    nextTop = NOTIFICATION_STACK_VIEWPORT_MARGIN;
    shouldClamp = true;
  }

  if (!shouldClamp) return;

  container.style.setProperty("left", `${nextLeft}px`, "important");
  container.style.setProperty("top", `${nextTop}px`, "important");
  container.style.setProperty("right", "auto", "important");
}

function resetNotificationStackToPreferredPosition(
  container: HTMLElement
): void {
  container.style.removeProperty("left");
  container.style.removeProperty("top");
  container.style.removeProperty("right");
}

function createStackTabs(): HTMLElement {
  const tabs = document.createElement("div");
  tabs.className = "knoww-stack-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Market list filters");

  const options: Array<{ value: StackFilter; label: string }> = [
    { value: "all", label: "All" },
    { value: "active", label: "Active" },
    { value: "seen", label: "Seen" },
    { value: "trending", label: "Trending" },
  ];

  options.forEach((option) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "knoww-stack-tab";
    tab.dataset.knowwStackFilter = option.value;
    tab.setAttribute("role", "tab");
    tab.textContent = option.label;
    tab.addEventListener("click", () => {
      cachedStackFilter = option.value;
      updateStackTabsState();
      void window.KNOWW_ANALYTICS?.track("notification_stack_filter_changed", {
        filter: cachedStackFilter,
      });
      updateNotificationStack(getStackBaseMarkets());
    });
    tabs.appendChild(tab);
  });

  updateStackTabsState(tabs);
  return tabs;
}

function updateStackTabsState(root?: HTMLElement): void {
  const tabsRoot =
    root || document.querySelector<HTMLElement>("#knoww-stack-tabs");
  if (!tabsRoot) return;

  tabsRoot
    .querySelectorAll<HTMLButtonElement>("[data-knoww-stack-filter]")
    .forEach((tab) => {
      const isActive = tab.dataset.knowwStackFilter === cachedStackFilter;
      tab.classList.toggle("knoww-stack-tab-active", isActive);
      tab.setAttribute("aria-selected", isActive ? "true" : "false");
      tab.tabIndex = isActive ? 0 : -1;
    });
}

function setStackExpanded(container: HTMLElement, expanded: boolean): void {
  cachedStackExpanded = expanded;
  persistStackExpanded(expanded);
  applyStackExpandedState(container, expanded);
  requestAnimationFrame(() => clampNotificationStackToViewport(container));
  if (expanded) updateStackTabsState();
  updateNotificationStack(getStackBaseMarkets());
}

function handleNotificationStackKeydown(e: KeyboardEvent): void {
  if (!notificationStackContainer) return;
  if (notificationStackContainer.style.display === "none") return;

  if (e.key === "Escape") {
    if (notificationStackContainer.classList.contains("knoww-stack-expanded")) {
      setStackExpanded(notificationStackContainer, false);
      e.preventDefault();
      return;
    }

    const searchContainer = notificationStackContainer.querySelector(
      "#knoww-search-container"
    );
    const searchToggle = notificationStackContainer.querySelector<HTMLElement>(
      "#knoww-search-toggle"
    );
    if (searchContainer?.classList.contains("knoww-search-open")) {
      searchContainer.classList.remove("knoww-search-open");
      searchToggle?.classList.remove("knoww-search-active");
      e.preventDefault();
    }
    return;
  }

  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    const items = Array.from(
      notificationStackContainer.querySelectorAll<HTMLElement>(
        ".knoww-notification-item"
      )
    );
    if (items.length === 0) return;
    const activeIndex = items.indexOf(document.activeElement as HTMLElement);
    const nextIndex =
      e.key === "ArrowDown"
        ? activeIndex < 0
          ? 0
          : Math.min(activeIndex + 1, items.length - 1)
        : activeIndex < 0
          ? items.length - 1
          : Math.max(activeIndex - 1, 0);
    items[nextIndex]?.focus();
    e.preventDefault();
  }
}

// ─── Editorial helpers ─────────────────────────────────────────────────
//
// Formatting + per-row derivations used by the editorial notification
// layout: live clock in the footer, the 2–3 char category badge in the
// row thumbnail, the volume meta line, and the big serif ¢ price column.

let liveTimeTicker: ReturnType<typeof setInterval> | null = null;

function formatLiveTimeLabel(now: Date = new Date()): string {
  const time = now.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  });
  let zone = "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZoneName: "short",
    }).formatToParts(now);
    zone = parts.find((p) => p.type === "timeZoneName")?.value || "";
  } catch {
    zone = "";
  }
  return zone ? `Live · ${time} ${zone}` : `Live · ${time}`;
}

function refreshLiveTimeLabel(): void {
  const node = document.getElementById("knoww-stack-footer-live");
  if (node) node.textContent = formatLiveTimeLabel();
}

function startLiveTimeTicker(): void {
  if (liveTimeTicker) return;
  liveTimeTicker = setInterval(refreshLiveTimeLabel, 30_000);
}

/**
 * Build a 32×32 row thumbnail. Prefers the market's image (event or first
 * nested market); falls back to a diagonal-stripe tile with the category
 * code when no image is available or the image fails to load.
 */
function renderRowThumbnail(market: Market): HTMLElement {
  const icon = document.createElement("div");
  icon.className = "knoww-notification-icon";
  const code = getCategoryCode(market);

  const imageUrl =
    market.image ||
    (market.markets?.[0] as (NestedMarket & { image?: string }) | undefined)
      ?.image;

  if (imageUrl) {
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    const renderFallback = () => {
      img.remove();
      icon.classList.add("knoww-notification-icon-fallback");
      icon.textContent = code;
    };
    img.onerror = renderFallback;
    setCspSafeImageSrc(img, imageUrl, renderFallback);
    icon.appendChild(img);
  } else {
    icon.classList.add("knoww-notification-icon-fallback");
    icon.textContent = code;
  }

  return icon;
}

function getCategoryCode(market: Market): string {
  const candidates: string[] = [];
  if (market.category) candidates.push(market.category);
  const firstTag = market.tags?.[0];
  if (firstTag) candidates.push(firstTag.label || firstTag.slug || "");
  if (market.title) candidates.push(market.title);
  for (const raw of candidates) {
    const cleaned = (raw || "").replace(/[^a-zA-Z]/g, "").toUpperCase();
    if (cleaned.length >= 2) return cleaned.slice(0, 3);
  }
  return "MKT";
}

function formatMarketVolume(market: Market): string | null {
  const raw = market.volume24hr ?? market.volume ?? market.liquidity;
  const value = toDecimal(raw);
  if (!value || value.lte(0)) return null;

  const formatScaled = (divisor: number, suffix: string) =>
    `$${value
      .div(divisor)
      .toDecimalPlaces(1, Decimal.ROUND_HALF_UP)
      .toFixed(1)
      .replace(/\.0$/, "")}${suffix}`;

  if (value.gte(1_000_000_000)) return formatScaled(1_000_000_000, "B");
  if (value.gte(1_000_000)) return formatScaled(1_000_000, "M");
  if (value.gte(1_000)) return formatScaled(1_000, "K");
  return `$${value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0)}`;
}

/**
 * Render the editorial price column: big serif ¢ price + mono side label.
 * `outcomes` and `prices` are already aligned and parsed by the caller.
 */
function renderEditorialPrice(
  container: HTMLElement,
  outcomes: string[],
  prices: number[]
): void {
  container.innerHTML = "";

  if (!outcomes.length || !prices.length) return;

  let leadingIdx = 0;
  let leadingPriceDecimal = toDecimal(prices[0]) ?? new Decimal(0);
  for (let i = 1; i < prices.length; i++) {
    const candidatePrice = toDecimal(prices[i]) ?? new Decimal(0);
    if (candidatePrice.gt(leadingPriceDecimal)) {
      leadingIdx = i;
      leadingPriceDecimal = candidatePrice;
    }
  }

  const leadingOutcome = (outcomes[leadingIdx] || "").trim();
  const cents = Decimal.max(0, Decimal.min(99, leadingPriceDecimal.mul(100)))
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toNumber();

  const numEl = document.createElement("span");
  numEl.className = "knoww-notification-price-num";
  const lower = leadingOutcome.toLowerCase();
  const isBinary = outcomes.length === 2;
  // Color when one side has a clear majority. "No" wins gets salmon; any
  // other leader (Yes, by-date, multi-outcome name) gets green.
  if (cents > 50) {
    if (isBinary && lower === "no") numEl.classList.add("no");
    else numEl.classList.add("yes");
  }

  numEl.textContent = String(cents);
  const centsGlyph = document.createElement("span");
  centsGlyph.className = "knoww-notification-price-cents";
  centsGlyph.textContent = "¢";
  numEl.appendChild(centsGlyph);

  const sideLabel = document.createElement("span");
  sideLabel.className = "knoww-notification-side-label";
  sideLabel.textContent = leadingOutcome || (isBinary ? "Yes" : "Top");

  container.appendChild(numEl);
  container.appendChild(sideLabel);
}

// Tracks whether the fullscreen listeners have been wired (once per page).
let fullscreenReparentBound = false;

/** The active fullscreen element across vendor-prefixed implementations. */
function getFullscreenElement(): Element | null {
  return (
    document.fullscreenElement ||
    // Safari/older WebKit
    (document as Document & { webkitFullscreenElement?: Element | null })
      .webkitFullscreenElement ||
    null
  );
}

/**
 * Keep the notification panel visible across fullscreen transitions by
 * re-parenting it into the fullscreen element (and back to <body> on exit).
 * A fixed-position node still anchors to the viewport inside the fullscreen
 * element, so the panel stays in its corner.
 */
function setupFullscreenReparenting(container: HTMLElement): void {
  if (fullscreenReparentBound) return;
  fullscreenReparentBound = true;

  const reparent = (): void => {
    const stack =
      notificationStackContainer ||
      document.getElementById("knoww-notification-stack") ||
      container;
    if (!stack) return;

    const fsEl = getFullscreenElement();
    const target: HTMLElement =
      fsEl instanceof HTMLElement ? fsEl : document.body;

    if (stack.parentElement !== target) {
      target.appendChild(stack);
    }
    // Player chrome can sit at very high stacking; keep the panel above it.
    stack.style.zIndex = fsEl ? "2147483647" : "";
  };

  document.addEventListener("fullscreenchange", reparent);
  document.addEventListener("webkitfullscreenchange", reparent);
}

/**
 * Create the notification stack container
 */
function createNotificationStack(): HTMLElement {
  const { log } = window.KNOWW_UTILS;

  if (notificationStackContainer) {
    return notificationStackContainer;
  }

  // Remove any stale notification stacks left behind by a previous
  // script context (e.g. after extension hot-reload or update).
  const stale = document.querySelectorAll("#knoww-notification-stack");
  for (const el of Array.from(stale)) {
    el.remove();
    log("Removed stale notification stack from previous context");
  }

  const container = document.createElement("div");
  container.id = "knoww-notification-stack";

  const platformName = window.KNOWW_PLATFORM?.getPlatformName?.() || "unknown";

  // Detect theme - try multiple methods
  let theme: "dark" | "light" | "dim" = "dark"; // Default to dark for Twitter

  const platform = window.KNOWW_PLATFORM?.getCurrentPlatform?.();
  if (platform && typeof platform.detectTheme === "function") {
    theme = platform.detectTheme();
  } else {
    // Fallback theme detection for Twitter if platform not ready
    if (platformName === "twitter" || platformName === "unknown") {
      try {
        const bodyBg = window.getComputedStyle(document.body).backgroundColor;
        const rgbMatch = bodyBg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (rgbMatch) {
          const r = parseInt(rgbMatch[1], 10);
          const g = parseInt(rgbMatch[2], 10);
          const b = parseInt(rgbMatch[3], 10);
          if (r === 0 && g === 0 && b === 0) {
            theme = "dark";
          } else if (r < 30 && g < 40 && b < 50 && b > r) {
            theme = "dim";
          } else if (r > 240 && g > 240 && b > 240) {
            theme = "light";
          }
        }
      } catch {
        // Keep default dark theme
      }
    }
  }

  const themeClass = ` knoww-theme-${theme}`;
  container.className = `knoww-notification-stack knoww-notification-stack-${platformName}${themeClass}`;
  applyPlatformStyleVariables(container, platform?.getCardStyles?.(theme));

  log(
    `Creating notification stack with platform: ${platformName}, theme: ${theme}`
  );

  // Header
  const header = document.createElement("div");
  header.className = "knoww-stack-header";

  const headerTitle = document.createElement("div");
  headerTitle.className = "knoww-stack-title";
  const brandIconUrl =
    getSafeRuntimeUrl("icons/icon-128.png") || "icons/icon-128.png";
  headerTitle.innerHTML = `
    <span class="knoww-stack-icon" aria-hidden="true">
      <img src="${brandIconUrl}" alt="Knoww" width="20" height="20" />
    </span>
    <span>Markets</span>
  `;

  const headerRight = document.createElement("div");
  headerRight.className = "knoww-stack-header-right";

  const settingsBtn = document.createElement("button");
  settingsBtn.className = "knoww-stack-settings";
  settingsBtn.type = "button";
  settingsBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 5 15.08a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8.92 5a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>
    </svg>
  `;
  settingsBtn.title = "Settings";
  settingsBtn.setAttribute("aria-label", "Open extension settings");

  const sidebarBtn = document.createElement("button");
  sidebarBtn.className = "knoww-stack-sidebar";
  sidebarBtn.type = "button";
  sidebarBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2"/>
      <path d="M15 4v16"/>
      <path d="m10 9 3 3-3 3"/>
    </svg>
  `;
  sidebarBtn.title = "Move to browser sidebar";
  sidebarBtn.setAttribute(
    "aria-label",
    "Move markets panel to browser sidebar"
  );

  const searchToggle = document.createElement("button");
  searchToggle.className = "knoww-search-toggle";
  searchToggle.id = "knoww-search-toggle";
  searchToggle.type = "button";
  searchToggle.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="11" cy="11" r="8"></circle>
      <path d="M21 21l-4.35-4.35"></path>
    </svg>
  `;
  searchToggle.title = "Search markets";

  const minimizeToggle = document.createElement("button");
  minimizeToggle.className = "knoww-stack-minimize";
  minimizeToggle.id = "knoww-stack-minimize";
  minimizeToggle.type = "button";
  minimizeToggle.innerHTML = STACK_MINIMIZE_ICON_HTML;
  minimizeToggle.title = "Minimize";
  minimizeToggle.setAttribute("aria-label", "Minimize");
  minimizeToggle.setAttribute("aria-expanded", "true");

  const closeBtn = document.createElement("button");
  closeBtn.className = "knoww-stack-close";
  closeBtn.id = "knoww-stack-close";
  closeBtn.type = "button";
  closeBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12"/>
    </svg>
  `;
  closeBtn.title = "Close";
  closeBtn.setAttribute("aria-label", "Close markets panel");

  headerRight.appendChild(settingsBtn);
  headerRight.appendChild(sidebarBtn);
  headerRight.appendChild(searchToggle);
  headerRight.appendChild(minimizeToggle);
  headerRight.appendChild(closeBtn);
  header.appendChild(headerTitle);
  header.appendChild(headerRight);

  // Search container
  const searchContainer = document.createElement("div");
  searchContainer.className = "knoww-search-container";
  searchContainer.id = "knoww-search-container";

  const searchInputWrapper = document.createElement("div");
  searchInputWrapper.className = "knoww-search-input-wrapper";

  const searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.className = "knoww-search-input";
  searchInput.id = "knoww-search-input";
  searchInput.placeholder = "Search Polymarket...";

  const clearBtn = document.createElement("button");
  clearBtn.className = "knoww-search-clear";
  clearBtn.id = "knoww-search-clear";
  clearBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M18 6L6 18M6 6l12 12"/>
    </svg>
  `;
  clearBtn.style.display = "none";

  searchInputWrapper.appendChild(searchInput);
  searchInputWrapper.appendChild(clearBtn);

  const searchResults = document.createElement("div");
  searchResults.className = "knoww-search-results";
  searchResults.id = "knoww-search-results";

  searchContainer.appendChild(searchInputWrapper);
  searchContainer.appendChild(searchResults);

  const stackTabs = createStackTabs();
  stackTabs.id = "knoww-stack-tabs";

  // Content area — single container that holds EITHER the empty state
  // OR the market items. Never both at the same time.
  const contentArea = document.createElement("div");
  contentArea.className = "knoww-stack-content";
  contentArea.id = "knoww-stack-content";

  // Items container (hidden initially, shown when markets exist)
  const itemsContainer = document.createElement("div");
  itemsContainer.className = "knoww-stack-items";
  itemsContainer.id = "knoww-stack-items";
  itemsContainer.style.setProperty("display", "none", "important");

  // Empty state (visible initially)
  const emptyState = document.createElement("div");
  emptyState.className = "knoww-stack-empty";
  emptyState.id = "knoww-stack-empty";
  emptyState.innerHTML = `
    <div class="knoww-stack-welcome" data-knoww-welcome style="display:none !important">
      <div class="knoww-stack-welcome-icon">${WELCOME_SPARKLE_ICON_HTML}</div>
      <div class="knoww-stack-welcome-title">Knoww is listening</div>
      <p class="knoww-stack-welcome-body">
        As you browse, we surface Polymarket positions matching predictive
        claims on this page. Nothing here yet? Keep scrolling &mdash; markets
        appear the moment we find one.
      </p>
      <button type="button" class="knoww-stack-welcome-cta" data-knoww-welcome-dismiss>
        Got it
      </button>
    </div>
    <div class="knoww-stack-scanning" data-knoww-scanning>
      <div class="knoww-stack-empty-title-row">
        <span class="knoww-stack-empty-pulse" aria-hidden="true"></span>
        <span class="knoww-stack-empty-title">No markets found on this page yet</span>
        <span class="knoww-stack-empty-dots" aria-hidden="true">
          <span></span><span></span><span></span>
        </span>
      </div>
      <span class="knoww-stack-empty-sub">Scroll your feed to discover matches &mdash; browse markets from the Knoww sidebar.</span>
    </div>
  `;

  contentArea.appendChild(itemsContainer);
  contentArea.appendChild(emptyState);

  // Wire up first-run welcome. If the user has never dismissed the welcome
  // card, swap the "Searching for markets…" scanning row for the richer
  // welcome message. Reverts permanently once they click "Got it".
  const welcomeEl = emptyState.querySelector<HTMLElement>(
    "[data-knoww-welcome]"
  );
  const scanningEl = emptyState.querySelector<HTMLElement>(
    "[data-knoww-scanning]"
  );
  const welcomeDismissBtn = emptyState.querySelector<HTMLButtonElement>(
    "[data-knoww-welcome-dismiss]"
  );

  const dismissWelcome = () => {
    // setProperty with "important" because .knoww-stack-welcome has
    // `display: flex !important` — a plain inline style would lose to it.
    if (welcomeEl) welcomeEl.style.setProperty("display", "none", "important");
    if (scanningEl) scanningEl.style.display = "";
    persistWelcomeSeen();
    void window.KNOWW_ANALYTICS?.track("welcome_dismissed", {});
  };

  welcomeDismissBtn?.addEventListener("click", dismissWelcome);

  void readPersistedWelcomeSeen().then((seen) => {
    if (!seen && welcomeEl && scanningEl) {
      welcomeEl.style.removeProperty("display");
      scanningEl.style.display = "none";
      void window.KNOWW_ANALYTICS?.track("welcome_shown", {});
    }
  });

  // Footer — live timestamp only; full browsing now lives in the sidebar.
  const footer = document.createElement("div");
  footer.className = "knoww-stack-footer";
  footer.id = "knoww-stack-footer";

  const liveLabel = document.createElement("span");
  liveLabel.className = "knoww-stack-footer-live";
  liveLabel.id = "knoww-stack-footer-live";
  liveLabel.textContent = formatLiveTimeLabel();

  applyStackExpandedState(container, cachedStackExpanded);

  footer.appendChild(liveLabel);

  container.appendChild(header);
  container.appendChild(searchContainer);
  container.appendChild(stackTabs);
  container.appendChild(contentArea);
  container.appendChild(footer);

  // Append to body with fixed positioning (all platforms)
  document.body.appendChild(container);
  log("Notification stack created with fixed position");

  // Keep the panel visible when the page enters fullscreen (e.g. a Twitch/
  // YouTube player). The browser only paints the fullscreen element's subtree,
  // so a body-level fixed panel would vanish — re-parent it into the
  // fullscreen element while fullscreen is active, and back to body on exit.
  setupFullscreenReparenting(container);

  startLiveTimeTicker();

  setupSearchFunctionality(
    searchToggle,
    searchContainer,
    searchInput,
    searchResults,
    clearBtn
  );

  // Apply the cached minimized state synchronously so there's no flash of
  // "expanded-then-collapsed" on subsequent stack re-creations. The initial
  // load happens asynchronously via readPersistedStackMinimized() below.
  applyMinimizedState(container, minimizeToggle, cachedStackMinimized);

  const toggleMinimized = () => {
    const next = !container.classList.contains("knoww-stack-minimized");
    cachedStackMinimized = next;
    applyMinimizedState(container, minimizeToggle, next);
    persistStackMinimized(next);
    void window.KNOWW_ANALYTICS?.track("notification_stack_toggled", {
      minimized: next,
    });
  };

  minimizeToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMinimized();
  });

  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    persistStackDismissed(true);
    disconnectNotificationStackLifecyclePort();
    container.style.setProperty("display", "none", "important");
    void window.KNOWW_ANALYTICS?.track("notification_stack_closed");
  });

  const showInvalidatedRuntimeMessage = () => {
    showScrollToast("Extension updated. Refresh this page to reconnect Knoww.");
  };

  settingsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    void window.KNOWW_UTILS.safeSendMessage({
      type: "KNOWW_OPEN_EXTENSION_SETTINGS",
    }).then((response?: { ok?: boolean; error?: string }) => {
      if (/Extension context invalidated/i.test(response?.error || "")) {
        showInvalidatedRuntimeMessage();
      }
    });
    void window.KNOWW_ANALYTICS?.track("extension_settings_opened", {
      surface: "notification_stack",
    });
  });

  const openSidePanelFromNotificationStack = () => {
    void window.KNOWW_UTILS.safeSendMessage({
      type: "KNOWW_OPEN_EXTENSION_SIDEPANEL",
    }).then((response?: { ok?: boolean; error?: string }) => {
      if (response?.ok !== true) {
        if (/Extension context invalidated/i.test(response?.error || "")) {
          showInvalidatedRuntimeMessage();
          return;
        }
        showScrollToast(
          response?.error ||
            "This browser does not support Knoww in the sidebar."
        );
      }
    });
  };

  sidebarBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openSidePanelFromNotificationStack();
    void window.KNOWW_ANALYTICS?.track("extension_sidepanel_opened", {
      surface: "notification_stack",
    });
  });

  // When minimized, clicking the title row (logo + "Markets" label) expands
  // the panel — matches the affordance you'd expect from a collapsed pill.
  headerTitle.addEventListener("click", () => {
    if (container.classList.contains("knoww-stack-minimized")) {
      toggleMinimized();
    }
  });

  // Streaming surface: keep the original header (icons), but slim the panel via
  // CSS — drop the footer and the "Live now" section label. The marker class is
  // the hook for those rules (see `.knoww-stack-stream` in knoww-inline.css).
  if (isStreamSurface()) {
    container.classList.add("knoww-stack-stream");
  }

  // Hydrate from persisted state on first creation.
  void readPersistedStackMinimized().then((persisted) => {
    if (persisted !== cachedStackMinimized) {
      cachedStackMinimized = persisted;
      applyMinimizedState(container, minimizeToggle, persisted);
    }
  });

  notificationStackContainer = container;
  return container;
}

/**
 * Set up search functionality
 */
function setupSearchFunctionality(
  toggleBtn: HTMLButtonElement,
  container: HTMLElement,
  input: HTMLInputElement,
  resultsContainer: HTMLElement,
  clearBtn: HTMLButtonElement
): void {
  const { log } = window.KNOWW_UTILS;

  let searchTimeout: ReturnType<typeof setTimeout> | null = null;
  let isSearchOpen = false;
  let currentSearchQuery = ""; // Track current query to ignore stale results

  toggleBtn.onclick = () => {
    const stack = container.closest<HTMLElement>(".knoww-notification-stack");
    const minimizeToggle = stack?.querySelector<HTMLElement>(
      "#knoww-stack-minimize"
    );
    if (stack?.classList.contains("knoww-stack-minimized") && minimizeToggle) {
      cachedStackMinimized = false;
      applyMinimizedState(stack, minimizeToggle, false);
      persistStackMinimized(false);
    }

    isSearchOpen = !isSearchOpen;
    container.classList.toggle("knoww-search-open", isSearchOpen);
    toggleBtn.classList.toggle("knoww-search-active", isSearchOpen);

    if (isSearchOpen) {
      void window.KNOWW_ANALYTICS?.track("extension_search_opened");
      input.focus();
      clearBtn.style.display = "flex";
    } else {
      input.value = "";
      resultsContainer.innerHTML = "";
      clearBtn.style.display = "none";
      currentSearchQuery = "";
    }
  };

  clearBtn.onclick = () => {
    void window.KNOWW_ANALYTICS?.track("extension_search_cleared");
    if (input.value.trim() === "") {
      isSearchOpen = false;
      container.classList.remove("knoww-search-open");
      toggleBtn.classList.remove("knoww-search-active");
      clearBtn.style.display = "none";
      currentSearchQuery = "";
    } else {
      input.value = "";
      resultsContainer.innerHTML = "";
      input.focus();
      currentSearchQuery = "";
    }
  };

  input.oninput = () => {
    const query = input.value.trim();
    currentSearchQuery = query;

    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    if (query.length < 2) {
      resultsContainer.innerHTML = "";
      return;
    }

    resultsContainer.innerHTML =
      '<div class="knoww-search-loading">Searching...</div>';

    const searchQuery = query; // Capture query for this search request
    searchTimeout = setTimeout(async () => {
      try {
        const { searchPolymarketEvents } = window.KNOWW_API;
        const events = await searchPolymarketEvents(searchQuery, []);
        void window.KNOWW_ANALYTICS?.track("extension_search_query_submitted", {
          queryLength: searchQuery.length,
          resultCount: events.length,
        });

        // Ignore stale results if query has changed
        if (currentSearchQuery !== searchQuery) {
          return;
        }

        if (events.length === 0) {
          resultsContainer.innerHTML =
            '<div class="knoww-search-empty">No markets found</div>';
          return;
        }

        resultsContainer.innerHTML = "";

        events.slice(0, 5).forEach((event) => {
          const resultItem = createSearchResultItem(event);
          resultsContainer.appendChild(resultItem);
        });
      } catch (e) {
        if (currentSearchQuery !== searchQuery) {
          return;
        }
        void window.KNOWW_ANALYTICS?.track("extension_search_failed", {
          query: searchQuery,
        });
        log("Search error:", e);
        resultsContainer.innerHTML =
          '<div class="knoww-search-empty">Search failed</div>';
      }
    }, 300);
  };

  document.addEventListener("click", (e) => {
    const target = e.target as Node;
    if (
      isSearchOpen &&
      !container.contains(target) &&
      !toggleBtn.contains(target)
    ) {
      void window.KNOWW_ANALYTICS?.track("extension_search_dismissed");
      isSearchOpen = false;
      container.classList.remove("knoww-search-open");
      toggleBtn.classList.remove("knoww-search-active");
    }
  });
}

/**
 * Create a search result item
 */
function createSearchResultItem(market: Market): HTMLElement {
  const { KNOWW_APP_URL } = window.KNOWW_CONFIG;

  const marketSource = market.source || "polymarket";
  const sourceConfig = SOURCE_CONFIG[marketSource] || SOURCE_CONFIG.polymarket;

  const item = document.createElement("div");
  item.className = `knoww-search-result-item knoww-source-${marketSource}`;

  const icon = document.createElement("div");
  icon.className = "knoww-search-result-icon";

  let imageUrl = market.image;
  if (!imageUrl && market.markets && market.markets.length > 0) {
    imageUrl = (market.markets[0] as NestedMarket & { image?: string }).image;
  }

  // Build a data URI fallback for when chrome.runtime is unavailable
  const kalshiFallbackIcon =
    getSafeRuntimeUrl("icons/icon-48.png") ||
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Crect fill='%234a5568' width='48' height='48' rx='8'/%3E%3Ctext x='24' y='32' font-size='24' text-anchor='middle' fill='white'%3EK%3C/text%3E%3C/svg%3E";

  if (imageUrl) {
    const img = document.createElement("img");
    img.alt = "";
    const renderFallback = () => {
      icon.innerHTML = "";
      if (marketSource === "kalshi") {
        const fallbackImg = document.createElement("img");
        fallbackImg.src = kalshiFallbackIcon;
        fallbackImg.alt = "Kalshi";
        icon.appendChild(fallbackImg);
      } else {
        icon.textContent = getMarketEmoji(market);
      }
    };
    img.onerror = renderFallback;
    setCspSafeImageSrc(img, imageUrl, renderFallback);
    icon.appendChild(img);
  } else {
    if (marketSource === "kalshi") {
      const img = document.createElement("img");
      img.src = kalshiFallbackIcon;
      img.alt = "Kalshi";
      icon.appendChild(img);
    } else {
      icon.textContent = getMarketEmoji(market);
    }
  }

  const content = document.createElement("div");
  content.className = "knoww-search-result-content";

  const title = document.createElement("div");
  title.className = "knoww-search-result-title";
  title.textContent = truncateText(market.title || "Untitled Market", 45);

  const parsed = parseMultiOutcomeData(market);
  let outcomes = parsed.outcomes;
  let priceData: number[] = parsed.prices;

  if (!parsed.isMultiOutcome && market.markets && market.markets.length > 0) {
    const firstMarket =
      market.markets[parsed.firstActiveMarketIndex] ?? market.markets[0];
    if (firstMarket.outcomePrices) {
      priceData = parseGammaPriceArray(firstMarket.outcomePrices);
    }
    if (firstMarket.outcomes) {
      outcomes = parseGammaStringArray(firstMarket.outcomes);
    }
    if (outcomes.length === 0) outcomes = ["Yes", "No"];
    if (priceData.length === 0) {
      priceData = [0.5, 0.5];
    }
  }

  const prices = document.createElement("div");
  prices.className = "knoww-search-result-prices";

  renderOutcomePrices(prices, outcomes, priceData, 2);

  content.appendChild(title);
  content.appendChild(prices);

  item.appendChild(icon);
  item.appendChild(content);

  const sourceIndicator = document.createElement("div");
  sourceIndicator.className = "knoww-search-source-indicator";
  sourceIndicator.style.backgroundColor = sourceConfig.color;
  sourceIndicator.textContent = sourceConfig.icon;
  sourceIndicator.title = sourceConfig.name;
  item.appendChild(sourceIndicator);

  item.onclick = () => {
    let marketUrl: string;

    if (marketSource === "kalshi") {
      marketUrl = buildKalshiUrl(market);
    } else {
      marketUrl = market.slug
        ? `${KNOWW_APP_URL}/events/detail/${market.slug}`
        : KNOWW_APP_URL;
    }

    void window.KNOWW_ANALYTICS?.track("extension_search_result_clicked", {
      marketId: market.id,
      source: marketSource,
    });
    window.open(marketUrl, "_blank", "noopener,noreferrer");
  };

  return item;
}

/**
 * Create a notification item for a market
 */
// Active stake (USD) for stream one-click trades, seeded from settings and
// adjustable via the stake chips. Module-level so it's shared across cards.
let streamStakeUsd: number | null = null;

function getStreamTradingSettings(): {
  defaultAmount: number;
  oneClickEnabled: boolean;
  confirmBeforeTrade: boolean;
} {
  return (
    window.KNOWW_CONFIG?.getStreamTradingSettings?.() || {
      defaultAmount: 20,
      oneClickEnabled: true,
      confirmBeforeTrade: true,
    }
  );
}

function getStreamStake(): number {
  if (streamStakeUsd == null) {
    streamStakeUsd = getStreamTradingSettings().defaultAmount;
  }
  return streamStakeUsd;
}

interface StreamBet {
  outcomes: string[];
  prices: number[];
  isMulti: boolean;
  marketIndex: number;
  multiOutcomeData: MultiOutcomeItem[];
}

/**
 * For a sports/esports event with many nested markets (Match Winner, map
 * winners, handicaps, over/unders…), find the "Match Winner" moneyline market
 * and return its two team outcomes + the nested-market index. That's what a
 * bettor wants on the card — "Team A vs Team B" — not a stray over/under.
 */
function getMatchWinnerBet(market: Market): StreamBet | null {
  const primarySportsMoneyline = resolvePrimarySportsMoneyline(market);
  if (!primarySportsMoneyline) return null;
  const primaryMoneylineOptions = primarySportsMoneyline.multiOutcomeData ?? [];

  return {
    outcomes: primarySportsMoneyline.outcomes,
    prices: primarySportsMoneyline.prices,
    isMulti: primaryMoneylineOptions.length > 0,
    marketIndex: primarySportsMoneyline.marketIndex,
    multiOutcomeData: primaryMoneylineOptions,
  };
}

/** Resolve which outcomes to show on a stream card's betting row. */
function resolveStreamBet(market: Market): StreamBet {
  const moneyline = getMatchWinnerBet(market);
  if (moneyline) return moneyline;

  const d = resolveMarketDisplayData(market);
  const firstActiveMarketIndex =
    parseMultiOutcomeData(market).firstActiveMarketIndex;
  return {
    outcomes: d.outcomes,
    prices: d.prices,
    isMulti: d.isMultiOutcome,
    marketIndex: firstActiveMarketIndex,
    multiOutcomeData: d.multiOutcomeData,
  };
}

interface StreamOption {
  name: string;
  price: number;
  outcomeIndex: number;
  isMulti: boolean;
  marketIndex: number;
  cls: string;
}

/**
 * The outcomes to show as quick-bet buttons on a stream card: the two teams /
 * Yes-No for a head-to-head, or the top 4 options (by price) for a multi-
 * outcome market.
 */
function streamOptionsFor(market: Market): StreamOption[] {
  const bet = resolveStreamBet(market);
  if (bet.isMulti && bet.multiOutcomeData.length > 0) {
    return [...bet.multiOutcomeData]
      .sort((a, b) => b.price - a.price)
      .slice(0, 4)
      .map((o, k) => ({
        name: o.name,
        price: o.price,
        outcomeIndex: 0,
        isMulti: true,
        marketIndex: o.marketIndex,
        cls: `option-${(k % 5) + 1}`,
      }));
  }
  const isYesNo =
    bet.outcomes[0]?.toLowerCase() === "yes" &&
    bet.outcomes[1]?.toLowerCase() === "no";
  return bet.outcomes.slice(0, 2).map((name, k) => ({
    name,
    price: bet.prices[k] ?? 0.5,
    outcomeIndex: k,
    isMulti: false,
    marketIndex: bet.marketIndex,
    cls: isYesNo ? (k === 0 ? "yes" : "no") : `option-${k + 1}`,
  }));
}

/** Resolve the CLOB token / condition / negRisk for a market order. */
async function resolveOrderTokens(
  market: Market,
  outcomeIndex: number,
  isMulti: boolean,
  marketIndex: number
): Promise<{ tokenId?: string; conditionId?: string; negRisk: boolean }> {
  let tokenId: string | undefined =
    (isMulti
      ? getTokenIdForMultiOutcome(market, marketIndex)
      : getTokenIdForOutcome(market, outcomeIndex, marketIndex)) ?? undefined;
  if (!tokenId) {
    tokenId =
      (await window.KNOWW_API.fetchClobTokenIds(
        market,
        outcomeIndex,
        isMulti,
        marketIndex
      )) || undefined;
  }
  const nestedMarket = market.markets?.[marketIndex];
  let conditionId: string | undefined;
  const negRisk = resolveNegRisk(nestedMarket, market);
  if (nestedMarket) {
    conditionId = nestedMarket.conditionId as string | undefined;
    const ids = parseGammaStringArray(nestedMarket.clobTokenIds);
    if (ids.length >= 2) {
      const corrected = isMulti ? ids[0] : ids[outcomeIndex];
      if (corrected) tokenId = corrected;
    }
  }
  return { tokenId, conditionId, negRisk };
}

/** Place a market BUY for the selected stream outcome. Throws on failure. */
async function submitStreamMarketOrder(
  market: Market,
  opt: StreamOption,
  stake: number
): Promise<void> {
  const ctx = TradingService.getContext();
  const tokens = await resolveOrderTokens(
    market,
    opt.outcomeIndex,
    opt.isMulti,
    opt.marketIndex
  );
  if (!tokens.tokenId) throw new Error("Could not resolve market token");
  const shares = Math.max(
    ctx.minOrderSize || 5,
    Math.round(stake / Math.max(opt.price, 0.01))
  );
  await TradingService.placeOrder({
    tokenId: tokens.tokenId,
    conditionId: tokens.conditionId,
    outcomeIndex: opt.outcomeIndex,
    side: "BUY",
    price: 0,
    size: shares,
    amount: stake,
    orderType: "FAK",
    negRisk: tokens.negRisk,
    isMarketableBuy: true,
  });
}

type StreamTxStatus = "idle" | "placing" | "placed" | "failed";

/** A short market label for the compact head, e.g. "FURIA vs MOUZ". Falls back
 *  to the market title, trimmed of any " - <event>" suffix. */
function streamShortTitle(market: Market): string {
  const title = market.title || "Market";
  return title.split(/\s[-–—|]\s/)[0].trim() || title;
}

/**
 * Build the card's betting area to match the design's "one-click trading":
 * the outcomes as a SEGMENT SELECTOR + a single contextual ACTION BUTTON that
 * carries every trade state inline (Trade → Confirm → Placing → Placed, plus
 * Connect / Insufficient / Approve). Selecting an outcome never opens a panel;
 * the big panel is only a setup fallback for connect / approve / deposit.
 */
function buildStreamBetting(market: Market): HTMLElement {
  const marketSource = market.source || "polymarket";
  const isKalshi = marketSource === "kalshi";
  const options = streamOptionsFor(market);

  const wrap = document.createElement("div");
  wrap.className = "knoww-stream-bet";

  // Head: just the BUY/SELL toggle (the market title lives in the collapsed
  // pill directly above, so it isn't repeated here). Hidden by default; shown
  // only when there's a sellable position (see renderHead).
  const head = document.createElement("div");
  head.className = "knoww-stream-head knoww-stream-hidden";
  const buysell = document.createElement("div");
  buysell.className = "knoww-stream-buysell";
  head.appendChild(buysell);

  const segRow = document.createElement("div");
  segRow.className = "knoww-stream-seg-row";

  // Action row: inline stepper + contextual trade button on one line.
  const actionRow = document.createElement("div");
  actionRow.className = "knoww-stream-actionrow";
  const stepperWrap = document.createElement("div");
  stepperWrap.className = "knoww-stream-stepper";
  const actionWrap = document.createElement("div");
  actionWrap.className = "knoww-stream-action";
  actionRow.appendChild(stepperWrap);
  actionRow.appendChild(actionWrap);

  // Contextual hint (full width, below the action row) so a wrapped hint can
  // never inflate the stepper/trade row height.
  const hintHost = document.createElement("div");
  hintHost.className = "knoww-stream-hint-host";

  // Holdings footer (2-outcome markets only; filled once balances load).
  const holdFooter = document.createElement("div");
  holdFooter.className = "knoww-stream-hold knoww-stream-hidden";

  // Host for the inline deposit flow (unchanged behavior).
  const depositHost = document.createElement("div");
  depositHost.className = "knoww-stream-deposit-host";

  wrap.appendChild(head);
  wrap.appendChild(segRow);
  wrap.appendChild(actionRow);
  wrap.appendChild(hintHost);
  wrap.appendChild(holdFooter);
  wrap.appendChild(depositHost);

  let selectedIdx = 0;
  let side: "BUY" | "SELL" = "BUY";
  let holding: StreamHolding | null = null;
  let txStatus: StreamTxStatus = "idle";
  let depositing = false;
  let lastError: string | null = null;
  let busy: string | null = null;
  let holdingGen = 0;
  // Holdings footer + BUY/SELL apply ONLY to genuine binary (Yes/No) markets:
  // getOutcomeBalances and pickHolding assume a Yes/No token pair. A
  // multi-outcome market reduced to 2 active options gives every option
  // outcomeIndex 0 (distinguished by marketIndex), which would mis-target the
  // sell — so exclude those. They keep BUY + the stepper, no footer/toggle.
  const twoSided =
    options.length === 2 && !options[0].isMulti && !options[1].isMulti;

  const runSetup = (label: string, fn: () => Promise<unknown>): void => {
    busy = label;
    renderAction();
    fn()
      .catch(() => {
        /* leave state; the action re-renders to the current readiness */
      })
      .finally(() => {
        busy = null;
        renderAction();
      });
  };

  // Balance settles asynchronously after a trade/deposit (V2 fill settlement,
  // bridge credit). An immediate refresh reads the pre-change value, so poll a
  // few times until ctx.balance moves off `before` — the card's onStateChange
  // subscription re-renders the action once it lands.
  const pollBalanceChange = (before: number): void => {
    let tries = 0;
    const tick = async (): Promise<void> => {
      await TradingService.refreshBalance();
      tries += 1;
      if (tries < 6 && TradingService.getContext().balance === before) {
        window.setTimeout(() => void tick(), 2500);
      }
    };
    void tick();
  };

  const doPlace = (): void => {
    const opt = options[selectedIdx];
    const balanceBefore = TradingService.getContext().balance;
    txStatus = "placing";
    renderAction();
    submitStreamMarketOrder(market, opt, getStreamStake())
      .then(() => {
        txStatus = "placed";
        lastError = null;
        window.KNOWW_PREFERENCES?.recordClick(market);
        // Reflect the spent collateral once the fill settles on-chain.
        pollBalanceChange(balanceBefore);
      })
      .catch((err: unknown) => {
        txStatus = "failed";
        lastError = err instanceof Error ? err.message : String(err) || null;
        // The balance may be stale (e.g. funds withdrawn elsewhere), which is
        // how an unaffordable trade slipped through. Refresh so the card
        // re-renders to the correct "Deposit to trade" state after the failure.
        void TradingService.refreshBalance();
      })
      .finally(() => {
        renderAction();
        window.setTimeout(() => {
          if (txStatus === "placed" || txStatus === "failed") {
            txStatus = "idle";
            renderAction();
          }
        }, 2800);
      });
  };

  function doSell(): void {
    if (!holding) return;
    const opt = options[holding.outcomeIndex];
    const balanceBefore = TradingService.getContext().balance;
    txStatus = "placing";
    renderAction();
    submitStreamMarketSell(market, opt, holding.shares)
      .then(() => {
        txStatus = "placed";
        lastError = null;
        pollBalanceChange(balanceBefore);
        void loadHolding();
      })
      .catch((err: unknown) => {
        txStatus = "failed";
        lastError = err instanceof Error ? err.message : String(err) || null;
        void TradingService.refreshBalance();
      })
      .finally(() => {
        renderAction();
        window.setTimeout(() => {
          if (txStatus === "placed" || txStatus === "failed") {
            txStatus = "idle";
            renderAction();
          }
        }, 2800);
      });
  }

  // Open the deposit flow INLINE inside the card: hide the bet controls and let
  // the trading panel's deposit engine render into `depositHost`. Keeps the
  // funding flow on one surface instead of spawning a separate floating panel.
  const openInlineDeposit = (): void => {
    const opt = options[selectedIdx];
    depositing = true;
    streamInlineDepositActive = true;
    // Toggle a class (not inline styles) — the bet-control rules use !important,
    // which inline styles can't override.
    wrap.classList.add("depositing");
    // The deposit form is taller than the bet controls, but the stack only
    // enables scrolling via `.knoww-has-overflow` inside updateNotificationStack
    // — which we suppress while depositing. Enable scroll directly so the
    // confirm button is always reachable, and bring the form into view.
    const itemsContainer = document.getElementById("knoww-stack-items");
    itemsContainer?.classList.add("knoww-has-overflow");
    TradingPanel.mountInlineDeposit({
      host: depositHost,
      opts: {
        market,
        outcomeName: opt.name,
        outcomeIndex: opt.outcomeIndex,
        price: opt.price,
        side: "BUY",
        tokenId: "",
        anchorElement: wrap,
        isMultiOutcome: opt.isMulti,
        initialAmountUsd: getStreamStake(),
        streamDeposit: true,
      },
      onClose: () => {
        depositing = false;
        streamInlineDepositActive = false;
        wrap.classList.remove("depositing");
        renderSegments();
        renderStepper();
        renderAction();
        // The bridge can report "complete" a beat before the on-chain pUSD
        // balance is readable, so on return the card may still show the old
        // balance. Poll until it changes — the subscription re-renders.
        pollBalanceChange(TradingService.getContext().balance);
      },
    });
    requestAnimationFrame(() => {
      depositHost.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  };

  function renderSegments(): void {
    segRow.innerHTML = "";
    options.forEach((opt, i) => {
      const seg = document.createElement("button");
      seg.type = "button";
      const sideCls = twoSided ? (i === 0 ? "yes" : "no") : "opt";
      seg.className = `knoww-stream-seg ${sideCls}${
        i === selectedIdx ? " sel" : ""
      }`;
      const cents = Math.round(opt.price * 100);
      const label = document.createElement("span");
      label.className = "knoww-stream-seg-name";
      label.textContent = opt.name;
      const price = document.createElement("span");
      price.className = "knoww-stream-seg-price";
      price.textContent = `${cents}¢`;
      seg.appendChild(label);
      seg.appendChild(price);
      seg.onclick = (e) => {
        e.stopPropagation();
        if (isKalshi) {
          window.open(buildKalshiUrl(market), "_blank", "noopener,noreferrer");
          return;
        }
        selectedIdx = i;
        txStatus = "idle";
        renderSegments();
        renderStepper();
        renderAction();
      };
      segRow.appendChild(seg);
    });
  }

  function renderStepper(): void {
    stepperWrap.innerHTML = "";
    const stake = getStreamStake();
    const normalizedStake = clampStake(stake);
    const setInputWidth = (input: HTMLInputElement): void => {
      input.style.width = `${Math.max(2, input.value.length)}ch`;
    };
    const mk = (label: string, dir: 1 | -1): HTMLButtonElement => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "knoww-stream-step-btn";
      b.textContent = label;
      const nextVal = stepStake(stake, dir);
      b.disabled = nextVal === stake;
      b.onclick = (e) => {
        e.stopPropagation();
        streamStakeUsd = stepStake(getStreamStake(), dir);
        txStatus = "idle";
        renderStepper();
        renderAction();
      };
      return b;
    };
    const val = document.createElement("label");
    val.className = "knoww-stream-step-val";
    const dollar = document.createElement("span");
    dollar.className = "knoww-stream-step-prefix";
    dollar.textContent = "$";
    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.className = "knoww-stream-step-input";
    input.setAttribute("aria-label", "Trade amount in dollars");
    input.value = String(normalizedStake);
    setInputWidth(input);
    input.onpointerdown = (e) => e.stopPropagation();
    input.onclick = (e) => e.stopPropagation();
    input.onfocus = (e) => {
      e.stopPropagation();
      input.select();
    };
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        input.blur();
      } else if (e.key === "Escape") {
        input.value = String(clampStake(getStreamStake()));
        input.blur();
      }
    };
    input.oninput = (e) => {
      e.stopPropagation();
      setInputWidth(input);
      const parsed = parseStreamStakeInput(input.value);
      if (parsed == null) return;
      streamStakeUsd = parsed;
      txStatus = "idle";
      renderAction();
    };
    input.onblur = () => {
      streamStakeUsd =
        parseStreamStakeInput(input.value) ?? clampStake(getStreamStake());
      window.setTimeout(() => {
        if (!wrap.isConnected) return;
        renderStepper();
        renderAction();
      }, 0);
    };
    val.appendChild(dollar);
    val.appendChild(input);
    stepperWrap.appendChild(mk("−", -1));
    stepperWrap.appendChild(val);
    stepperWrap.appendChild(mk("+", 1));
  }

  function renderPill(): void {
    const item = wrap.closest(".knoww-notification-item--stream");
    const chip = item?.querySelector<HTMLElement>(".knoww-stream-pill-hold");
    if (!chip) return;
    if (holding) {
      chip.textContent = `${holding.sharesLabel} ${holding.name}`;
      chip.style.display = "";
    } else {
      chip.style.display = "none";
    }
  }

  function renderHead(): void {
    buysell.innerHTML = "";
    // The head (BUY/SELL toggle) only appears when there's a sellable position in
    // THIS market — otherwise there's nothing to sell, so we stay BUY-only and
    // hide the head entirely, keeping the card small.
    const ctx = TradingService.getContext();
    const sellable = twoSided && canSellHolding(holding, ctx.minOrderSize || 0);
    head.classList.toggle("knoww-stream-hidden", !sellable);
    if (!sellable) {
      if (side === "SELL") side = "BUY";
      return;
    }
    (["BUY", "SELL"] as const).forEach((s) => {
      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = `knoww-stream-bs-opt${s === side ? " sel" : ""}`;
      opt.textContent = s;
      opt.disabled = txStatus === "placing";
      opt.onclick = (e) => {
        e.stopPropagation();
        if (txStatus === "placing") return;
        if (side === s) return;
        side = s;
        txStatus = "idle";
        renderHead();
        renderStepper();
        renderAction();
      };
      buysell.appendChild(opt);
    });
  }

  function renderHold(): void {
    if (!twoSided || !holding) {
      holdFooter.classList.add("knoww-stream-hidden");
      holdFooter.innerHTML = "";
      return;
    }
    holdFooter.classList.remove("knoww-stream-hidden");
    holdFooter.innerHTML = "";
    const text = document.createElement("span");
    text.className = "knoww-stream-hold-text";
    const label = document.createElement("span");
    label.className = "knoww-stream-hold-label";
    label.textContent = "YOU HOLD ";
    const val = document.createElement("span");
    val.className = "knoww-stream-hold-val";
    val.textContent = formatHoldingLine(holding);
    text.appendChild(label);
    text.appendChild(val);

    const sell = document.createElement("button");
    sell.type = "button";
    sell.className = "knoww-stream-hold-sell";
    sell.textContent = "Sell";
    const ctx = TradingService.getContext();
    sell.disabled = !canSellHolding(holding, ctx.minOrderSize || 0);
    sell.onclick = (e) => {
      e.stopPropagation();
      if (!holding) return;
      selectedIdx = holding.outcomeIndex;
      side = "SELL";
      renderHead();
      renderSegments();
      renderStepper();
      doSell();
    };
    holdFooter.appendChild(text);
    holdFooter.appendChild(sell);
  }

  async function loadHolding(): Promise<void> {
    if (!twoSided) return;
    const gen = ++holdingGen;
    try {
      const [yesTok, noTok] = await Promise.all([
        resolveOrderTokens(
          market,
          options[0].outcomeIndex,
          options[0].isMulti,
          options[0].marketIndex
        ),
        resolveOrderTokens(
          market,
          options[1].outcomeIndex,
          options[1].isMulti,
          options[1].marketIndex
        ),
      ]);
      if (gen !== holdingGen || !wrap.isConnected) return;
      if (!yesTok.tokenId || !noTok.tokenId) return;
      const balances = await TradingService.getOutcomeBalances(
        yesTok.tokenId,
        noTok.tokenId
      );
      if (gen !== holdingGen || !wrap.isConnected) return;
      holding = pickHolding([
        {
          outcomeIndex: options[0].outcomeIndex,
          name: options[0].name,
          balance: balances.yesBalance,
          price: options[0].price,
        },
        {
          outcomeIndex: options[1].outcomeIndex,
          name: options[1].name,
          balance: balances.noBalance,
          price: options[1].price,
        },
      ]);
      if (side === "SELL" && !holding) {
        // The whole position was just sold (or vanished). Fall back to BUY and
        // clear the trade status so the BUY-worded "Trade placed ✓" can't flash
        // after a sell — the SELL "Sold ✓" was already shown by doSell.
        side = "BUY";
        txStatus = "idle";
      }
      // Holding changed → refresh the BUY/SELL toggle visibility (renderHead
      // gates it on a sellable position), the stepper, footer, pill and action.
      renderHead();
      renderStepper();
      renderHold();
      renderPill();
      renderAction();
    } catch {
      /* balances are best-effort; leave the footer hidden */
    }
  }

  function renderAction(): void {
    actionWrap.innerHTML = "";
    hintHost.innerHTML = "";

    const showStepper =
      side === "BUY" &&
      !busy &&
      (txStatus === "idle" || txStatus === "failed" || txStatus === "placed");

    if (side === "SELL") {
      actionRow.classList.add("full");
      stepperWrap.classList.add("knoww-stream-hidden");
      const ctx = TradingService.getContext();
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "knoww-stream-trade rose";
      if (!holding || !canSellHolding(holding, ctx.minOrderSize || 0)) {
        btn.classList.remove("rose");
        btn.classList.add("ghost");
        btn.disabled = true;
        btn.textContent = holding
          ? "Position too small to sell"
          : "Nothing to sell";
      } else if (txStatus === "placing") {
        btn.classList.remove("rose");
        btn.classList.add("ghost");
        btn.disabled = true;
        btn.innerHTML = `<span class="knoww-stream-spin"></span> Selling…`;
      } else if (txStatus === "placed") {
        btn.classList.remove("rose");
        btn.classList.add("green");
        btn.disabled = true;
        btn.textContent = "Sold ✓";
      } else if (txStatus === "failed") {
        btn.classList.remove("rose");
        btn.classList.add("ghost");
        btn.textContent = "Unable to sell — retry";
        btn.onclick = (e) => {
          e.stopPropagation();
          doSell();
        };
      } else {
        btn.textContent = sellButtonLabel(holding);
        btn.onclick = (e) => {
          e.stopPropagation();
          doSell();
        };
      }
      actionWrap.appendChild(btn);
      return;
    }

    actionRow.classList.toggle("full", !showStepper);
    stepperWrap.classList.toggle("knoww-stream-hidden", !showStepper);

    const opt = options[selectedIdx];
    const stake = getStreamStake();
    const ctx = TradingService.getContext();
    const pct = Math.round(opt.price * 100);
    const sideColor =
      options.length === 2 && selectedIdx === 1 ? "rose" : "green";

    // Busy (inline setup in flight) → spinner, short-circuit everything.
    if (busy) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "knoww-stream-trade ghost";
      b.disabled = true;
      b.innerHTML = `<span class="knoww-stream-spin"></span> ${busy}`;
      actionWrap.appendChild(b);
      return;
    }

    let kind:
      | "ready"
      | "placing"
      | "placed"
      | "failed"
      | "connect"
      | "setup"
      | "enable"
      | "insufficient"
      | "approve"
      | "kalshi";
    if (isKalshi) kind = "kalshi";
    else if (txStatus === "placing") kind = "placing";
    else if (txStatus === "placed") kind = "placed";
    else if (txStatus === "failed") kind = "failed";
    else if (!ctx.address) kind = "connect";
    else if (isTradingWalletDeploymentRequired(ctx)) kind = "setup";
    else if (!ctx.hasCredentials || ctx.state !== "ready") kind = "enable";
    else if (stake > ctx.balance) kind = "insufficient";
    else {
      const nested = market.markets?.[opt.marketIndex];
      const negRisk = resolveNegRisk(nested, market);
      const allowance = negRisk ? ctx.usdcAllowanceNegRisk : ctx.usdcAllowance;
      kind = allowance < stake ? "approve" : "ready";
    }

    const hint = document.createElement("div");
    hint.className = "knoww-stream-hint";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "knoww-stream-trade";

    switch (kind) {
      case "kalshi":
        btn.classList.add("ghost");
        btn.textContent = "Trade on Kalshi";
        btn.onclick = (e) => {
          e.stopPropagation();
          window.open(buildKalshiUrl(market), "_blank", "noopener,noreferrer");
        };
        break;
      case "connect":
        btn.classList.add("ghost");
        btn.textContent = "Connect to trade";
        hint.textContent = "Connect a wallet to place trades";
        btn.onclick = (e) => {
          e.stopPropagation();
          // Inline: triggers the wallet's own connect + signature popups.
          runSetup("Connecting…", () => TradingService.ensureReady());
        };
        break;
      case "setup":
        btn.classList.add("ghost");
        btn.textContent = "Set up trading";
        hint.textContent = "Create your trading wallet in the side panel";
        btn.onclick = (e) => {
          e.stopPropagation();
          openTradingSetupSidePanel();
        };
        break;
      case "enable":
        btn.classList.add("ghost");
        btn.textContent = "Enable trading";
        hint.textContent = "One-time signature to enable trading";
        btn.onclick = (e) => {
          e.stopPropagation();
          runSetup("Enabling…", () => TradingService.ensureReady());
        };
        break;
      case "insufficient":
        btn.classList.add("deposit");
        btn.textContent = `Deposit to trade $${stake}`;
        hint.textContent = `Balance $${ctx.balance.toFixed(2)} · add funds to place this trade`;
        btn.onclick = (e) => {
          e.stopPropagation();
          openInlineDeposit();
        };
        break;
      case "approve":
        btn.classList.add("ghost");
        btn.textContent = "Approve to trade";
        hint.textContent = "One-time approval, then trade instantly";
        btn.onclick = (e) => {
          e.stopPropagation();
          const nested = market.markets?.[opt.marketIndex];
          const negRisk = resolveNegRisk(nested, market);
          runSetup("Approving…", () => TradingService.approveUsdc(negRisk));
        };
        break;
      case "placing":
        btn.classList.add("ghost");
        btn.disabled = true;
        btn.innerHTML = `<span class="knoww-stream-spin"></span> Placing trade…`;
        break;
      case "placed":
        btn.classList.add("green");
        btn.disabled = true;
        btn.textContent = "Trade placed ✓";
        hint.classList.add("good");
        hint.textContent = `Filled · ${opt.name} ${pct}¢`;
        break;
      case "failed":
        btn.classList.add("ghost");
        btn.textContent = "Unable to place — retry";
        hint.classList.add("warn");
        hint.textContent = lastError
          ? truncateText(lastError, 110)
          : "Something went wrong · tap to retry";
        btn.onclick = (e) => {
          e.stopPropagation();
          doPlace();
        };
        break;
      default:
        // ready
        btn.classList.add(sideColor);
        btn.innerHTML = `<span>Trade $${stake}</span><span class="knoww-stream-trade-sub">${opt.name} · ${pct}¢</span>`;
        btn.onclick = (e) => {
          e.stopPropagation();
          // Instant one-click placement — no confirm step. The user has already
          // expanded the card and picked an amount, so the trade button is the
          // commit action.
          doPlace();
        };
        break;
    }

    actionWrap.appendChild(btn);
    if (hint.textContent) hintHost.appendChild(hint);
  }

  renderHead();
  renderSegments();
  renderStepper();
  renderAction();
  renderHold();
  renderPill();
  void loadHolding();

  // Each card reads wallet readiness from the shared TradingService at render
  // time. Re-render the stepper/action/footer on global state changes; skip
  // while an inline setup/deposit is in flight, and self-unsubscribe once the
  // card leaves the DOM.
  const unsubState = TradingService.onStateChange(() => {
    if (!wrap.isConnected) {
      unsubState();
      return;
    }
    if (busy || depositing) return;
    renderHead();
    renderStepper();
    renderAction();
    renderHold();
  });

  // Refresh holdings when this card is (re)expanded (see the item click handler).
  wrap.addEventListener("knoww-stream-expanded", () => void loadHolding());

  return wrap;
}

/** Place a market SELL of `shares` of the given stream outcome. Throws on failure. */
async function submitStreamMarketSell(
  market: Market,
  opt: StreamOption,
  shares: number
): Promise<void> {
  const tokens = await resolveOrderTokens(
    market,
    opt.outcomeIndex,
    opt.isMulti,
    opt.marketIndex
  );
  if (!tokens.tokenId) throw new Error("Could not resolve market token");
  await TradingService.placeOrder({
    tokenId: tokens.tokenId,
    conditionId: tokens.conditionId,
    outcomeIndex: opt.outcomeIndex,
    side: "SELL",
    price: 0,
    size: shares,
    amount: 0,
    orderType: "FAK",
    negRisk: tokens.negRisk,
    isMarketableBuy: false,
  });
}

function createNotificationItem(
  marketData: InjectedMarketEntry,
  index: number,
  isActive = true
): HTMLElement {
  const { log } = window.KNOWW_UTILS;
  const { market, cardRef, postKey } = marketData;

  const marketSource = market.source || "polymarket";

  const item = document.createElement("div");
  item.className = `knoww-notification-item knoww-source-${marketSource} ${
    isActive ? "knoww-notification-active" : "knoww-notification-unavailable"
  }`;
  item.tabIndex = 0;
  item.setAttribute("role", "button");
  item.setAttribute("data-market-id", market.id);
  item.setAttribute("data-market-source", marketSource);
  item.setAttribute("data-market-status", isActive ? "active" : "scrolled-out");
  item.setAttribute(
    "aria-label",
    isActive
      ? `Scroll to ${market.title || "market"}`
      : `Restore or open ${market.title || "market"}`
  );
  if (!isActive) {
    item.title = "Restore this market card or open the market";
  }
  item.style.animationDelay = `${index * 50}ms`;

  const icon = renderRowThumbnail(market);

  const content = document.createElement("div");
  content.className = "knoww-notification-content";

  const title = document.createElement("div");
  title.className = "knoww-notification-title";
  title.textContent = market.title || "Untitled Market";

  const meta = document.createElement("div");
  meta.className = "knoww-notification-meta";
  const categoryLabel = market.category || market.tags?.[0]?.label || "";
  const volumeLabel = formatMarketVolume(market);
  if (categoryLabel) {
    const cat = document.createElement("span");
    cat.textContent = categoryLabel;
    meta.appendChild(cat);
  }
  if (categoryLabel && volumeLabel) {
    const dot = document.createElement("span");
    dot.className = "knoww-notification-meta-dot";
    meta.appendChild(dot);
  }
  if (volumeLabel) {
    const vol = document.createElement("span");
    vol.textContent = volumeLabel;
    meta.appendChild(vol);
  }
  if (!isActive) {
    if (meta.childNodes.length > 0) {
      const dot = document.createElement("span");
      dot.className = "knoww-notification-meta-dot";
      meta.appendChild(dot);
    }
    const action = document.createElement("span");
    action.className = "knoww-notification-action-label";
    action.textContent = "Restore";
    meta.appendChild(action);
  }

  const pricesDiv = document.createElement("div");
  pricesDiv.className = "knoww-notification-prices";

  const parsed = parseMultiOutcomeData(market);
  let outcomes = parsed.outcomes;
  let priceData: number[] = parsed.prices;
  const isMultiOutcome = parsed.isMultiOutcome;

  if (!isMultiOutcome && market.markets && market.markets.length > 0) {
    const firstMarket =
      market.markets[parsed.firstActiveMarketIndex] ?? market.markets[0];

    if (firstMarket.outcomePrices) {
      priceData = parseGammaPriceArray(firstMarket.outcomePrices);
    }

    if (firstMarket.outcomes) {
      outcomes = parseGammaStringArray(firstMarket.outcomes);
    }

    if (outcomes.length === 0 || priceData.length === 0) {
      outcomes = ["Yes", "No"];
      priceData = [0.5, 0.5];
    }
  }

  if (outcomes.length === 0) {
    outcomes = ["Yes", "No"];
    priceData = [0.5, 0.5];
  }

  renderEditorialPrice(pricesDiv, outcomes, priceData);

  content.appendChild(title);
  if (meta.childNodes.length > 0) content.appendChild(meta);

  item.appendChild(icon);
  item.appendChild(content);

  const isStream = marketData.isStreamSurface === true;
  if (isStream) {
    // Stream surface: collapsed by default — the row shows the title + price
    // like a normal market. Clicking it expands the inline betting area
    // (segment selector + action button). Accordion: only one open at a time.
    item.classList.add("knoww-notification-item--stream");

    // Compact collapsed pill: the market title (+ optional holdings chip +
    // chevron). Outcome names and prices live in the expanded segments, so the
    // collapsed row stays focused on identifying the market.
    content.innerHTML = "";
    const pill = document.createElement("div");
    pill.className = "knoww-stream-pill";
    const pillTitle = document.createElement("span");
    pillTitle.className = "knoww-stream-pill-title";
    pillTitle.textContent = streamShortTitle(market);
    const holdChip = document.createElement("span");
    holdChip.className = "knoww-stream-pill-hold";
    holdChip.style.display = "none";
    const chev = document.createElement("span");
    chev.className = "knoww-stream-pill-chev";
    chev.setAttribute("aria-hidden", "true");
    chev.textContent = "⌄";
    pill.appendChild(pillTitle);
    pill.appendChild(holdChip);
    pill.appendChild(chev);
    content.appendChild(pill);

    item.appendChild(buildStreamBetting(market));

    item.setAttribute("aria-label", `Markets for ${market.title || "market"}`);
    item.onclick = (e) => {
      // Don't toggle when interacting with the betting controls themselves.
      if ((e.target as Element).closest(".knoww-stream-bet")) return;
      const willExpand = !item.classList.contains("expanded");
      // Accordion: collapse any other expanded market.
      const siblings = item.parentElement?.querySelectorAll(
        ".knoww-notification-item--stream.expanded"
      );
      siblings?.forEach((el) => {
        if (el !== item) el.classList.remove("expanded");
      });
      item.classList.toggle("expanded", willExpand);
      if (willExpand) {
        item
          .querySelector(".knoww-stream-bet")
          ?.dispatchEvent(new CustomEvent("knoww-stream-expanded"));
      }
    };
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        item.click();
      }
    });
    return item;
  }
  item.appendChild(pricesDiv);

  // Click handler to scroll to the market card, or open URL if card is gone
  item.onclick = () => {
    void window.KNOWW_ANALYTICS?.track("notification_stack_item_clicked", {
      marketId: market.id,
      source: marketSource,
      itemStatus: isActive ? "active" : "scrolled_out",
    });
    if (!isActive) {
      const restored =
        postKey &&
        window.KNOWW_INJECTION?.restoreTrackedMarket?.(postKey, market.id);
      if (restored) {
        scrollToMarket(null, market.id, market, postKey);
      } else {
        const marketUrl = buildMarketUrl(market);
        log("Opening scrolled-out market directly:", marketUrl);
        window.open(marketUrl, "_blank", "noopener,noreferrer");
      }
      window.KNOWW_PREFERENCES?.recordClick(market);
      return;
    }
    scrollToMarket(
      cardRef as WeakRef<HTMLElement> | null,
      market.id,
      market,
      postKey
    );
    window.KNOWW_PREFERENCES?.recordClick(market);
  };
  item.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      item.click();
    }
  });

  return item;
}

/**
 * Create a section header within the notification stack list.
 * `kind` controls the dot color: green for active/trending, gray otherwise.
 */
function createNotificationSectionHeader(
  title: string,
  count: number,
  kind: "active" | "scrolled-out" | "trending" = "scrolled-out"
): HTMLElement {
  const header = document.createElement("div");
  header.className = "knoww-stack-section-header";
  const countLabel = count < 10 ? `0${count}` : String(count);
  header.innerHTML = `
    <span class="knoww-stack-section-title">
      <span class="knoww-stack-section-dot ${kind}" aria-hidden="true"></span>
      <span>${title}</span>
    </span>
    <span class="knoww-stack-section-count">${countLabel}</span>
  `;
  return header;
}

/**
 * Truncate text with ellipsis
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

function showScrollToast(message: string): void {
  const existing = document.querySelector(".knoww-scroll-toast");
  existing?.remove();

  const toast = document.createElement("div");
  toast.className = "knoww-scroll-toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("knoww-toast-hide");
    setTimeout(() => toast.remove(), 350);
  }, 2600);
}

/**
 * Scroll to a market card in the feed.
 * If the card has been removed from the DOM (host site virtualization / GC),
 * opens the market URL directly in a new tab so the user is never stuck.
 */
function scrollToMarket(
  cardRefOrElement: WeakRef<HTMLElement> | HTMLElement | null | undefined,
  marketId: string,
  market?: Market,
  postKey?: string
): void {
  const { log } = window.KNOWW_UTILS;

  let targetCard: HTMLElement | undefined | null =
    cardRefOrElement && "deref" in cardRefOrElement
      ? cardRefOrElement.deref()
      : (cardRefOrElement as HTMLElement | null);

  if (
    !targetCard ||
    !(targetCard instanceof Node) ||
    !document.body.contains(targetCard)
  ) {
    const escapedMarketId = escapeSelectorValue(marketId);
    const escapedPostKey = postKey ? escapeSelectorValue(postKey) : undefined;
    const scopedSelector = postKey
      ? `.knoww-market-card[data-knoww-market-id="${escapedMarketId}"][data-knoww-post-key="${escapedPostKey}"]`
      : `[data-knoww-market-id="${escapedMarketId}"]`;
    targetCard = document.querySelector(scopedSelector) as HTMLElement | null;
  }

  if (
    !targetCard ||
    !(targetCard instanceof Node) ||
    !document.body.contains(targetCard)
  ) {
    const restored =
      postKey &&
      window.KNOWW_INJECTION?.restoreTrackedMarket?.(postKey, marketId);
    if (restored) {
      const escapedMarketId = escapeSelectorValue(marketId);
      const escapedPostKey = postKey ? escapeSelectorValue(postKey) : undefined;
      const restoredSelector = postKey
        ? `.knoww-market-card[data-knoww-market-id="${escapedMarketId}"][data-knoww-post-key="${escapedPostKey}"]`
        : `[data-knoww-market-id="${escapedMarketId}"]`;
      targetCard = document.querySelector(
        restoredSelector
      ) as HTMLElement | null;
    }
  }

  if (
    !targetCard ||
    !(targetCard instanceof Node) ||
    !document.body.contains(targetCard)
  ) {
    // Card is no longer in the DOM — open the market URL directly
    log("Card not in DOM, opening market URL in new tab");
    if (market) {
      const url = buildMarketUrl(market);
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }
    }
    // Final fallback: no market data available
    log("No market data available to build URL");
    return;
  }

  targetCard.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
}

/**
 * Check if a card element is still in the DOM and visible
 */
function isCardStillAvailable(
  cardRef: InjectedMarketEntry["cardRef"],
  marketTitle?: string
): boolean {
  const noop = () => {};
  const { log } = window.KNOWW_UTILS || { log: noop };
  const shortTitle = marketTitle ? marketTitle.slice(0, 30) : "Unknown";

  const cardElement = cardRef?.deref?.();

  // Card was garbage collected or doesn't exist
  if (!cardElement) {
    log(`🗑️ [NotificationFilter] Card GC'd/missing: "${shortTitle}..."`);
    return false;
  }

  // Card is no longer in the DOM
  if (!document.body.contains(cardElement)) {
    log(
      `📜 [NotificationFilter] Card scrolled away (not in DOM): "${shortTitle}..."`
    );
    return false;
  }

  log(`✅ [NotificationFilter] Card still available: "${shortTitle}..."`);
  return true;
}

function isCardInViewport(cardElement: HTMLElement): boolean {
  const rect = cardElement.getBoundingClientRect();
  const width = Math.max(0, rect.width);
  const height = Math.max(0, rect.height);
  if (width === 0 || height === 0) return false;

  const visibleWidth = Math.max(
    0,
    Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0)
  );
  const visibleHeight = Math.max(
    0,
    Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0)
  );
  const visibleRatio = (visibleWidth * visibleHeight) / (width * height);

  return visibleRatio >= 0.25;
}

interface ClassifiedInjectedMarketEntry {
  entry: InjectedMarketEntry;
  status: "active" | "scrolled-out";
}

function classifyInjectedMarketEntry(
  marketData: InjectedMarketEntry,
  now: number
): ClassifiedInjectedMarketEntry {
  // Streaming-surface markets have no injected post card to track — they are
  // always "active" (the stream is what's live), so skip the DOM availability
  // checks that would otherwise classify them as scrolled-out.
  if (marketData.isStreamSurface) {
    marketData.isInViewport = true;
    marketData.lastVisibleAt = now;
    return { entry: marketData, status: "active" };
  }

  const isCardAvailable = isCardStillAvailable(
    marketData.cardRef,
    marketData.market.title
  );
  const cardElement = marketData.cardRef?.deref?.();
  const currentlyInViewport =
    !!cardElement && isCardAvailable && isCardInViewport(cardElement);

  if (currentlyInViewport) {
    marketData.isInViewport = true;
    marketData.lastVisibleAt = now;
  }

  const isVisible =
    currentlyInViewport ||
    (typeof marketData.isInViewport === "boolean"
      ? marketData.isInViewport
      : true);
  const lastVisibleAt = marketData.lastVisibleAt ?? marketData.timestamp;
  const recentlyVisible = now - lastVisibleAt <= SCROLLED_OUT_GRACE_MS;
  const status =
    isCardAvailable && (isVisible || recentlyVisible)
      ? "active"
      : "scrolled-out";

  return { entry: marketData, status };
}

function selectRepresentativeMarketEntries(markets: InjectedMarketEntry[]): {
  activeMarkets: InjectedMarketEntry[];
  scrolledOutMarkets: InjectedMarketEntry[];
} {
  const now = Date.now();
  const representatives = new Map<string, ClassifiedInjectedMarketEntry>();

  for (const marketData of markets) {
    if (!marketData?.market?.id) continue;

    const classified = classifyInjectedMarketEntry(marketData, now);
    const current = representatives.get(marketData.market.id);

    if (!current) {
      representatives.set(marketData.market.id, classified);
      continue;
    }

    if (current.status !== "active" && classified.status === "active") {
      representatives.set(marketData.market.id, classified);
      continue;
    }

    if (
      current.status === classified.status &&
      classified.entry.timestamp > current.entry.timestamp
    ) {
      representatives.set(marketData.market.id, classified);
    }
  }

  const selected = Array.from(representatives.values()).sort(
    (a, b) => a.entry.timestamp - b.entry.timestamp
  );

  return {
    activeMarkets: selected
      .filter((marketData) => marketData.status === "active")
      .map((marketData) => marketData.entry),
    scrolledOutMarkets: selected
      .filter((marketData) => marketData.status === "scrolled-out")
      .map((marketData) => marketData.entry),
  };
}

/**
 * Switch the notification stack content area between the empty state
 * and the items list. Only one is visible at a time.
 *
 * Uses setProperty with "important" because the stylesheet declares
 * display with !important to resist host-page overrides — a plain
 * inline style (element.style.display = "none") would lose to it.
 */
function showNotificationContent(view: "empty" | "items"): void {
  const itemsContainer = document.getElementById("knoww-stack-items");
  const emptyState = document.getElementById("knoww-stack-empty");
  if (!itemsContainer || !emptyState) return;

  if (view === "items") {
    emptyState.style.setProperty("display", "none", "important");
    itemsContainer.style.removeProperty("display");
  } else {
    itemsContainer.style.setProperty("display", "none", "important");
    emptyState.style.removeProperty("display");
    if (isStreamSurface()) applyStreamEmptyState(emptyState);
  }
}

/**
 * Rewrite the empty state for a streaming surface: it's not "scanning a feed",
 * it's "this game has no markets". Shows a static message and drops the feed-
 * oriented loading dots (trending is suppressed here).
 */
function applyStreamEmptyState(emptyState: HTMLElement): void {
  const welcome = emptyState.querySelector<HTMLElement>("[data-knoww-welcome]");
  const scanning = emptyState.querySelector<HTMLElement>(
    "[data-knoww-scanning]"
  );
  if (welcome) welcome.style.setProperty("display", "none", "important");
  if (scanning) scanning.style.removeProperty("display");

  const title = emptyState.querySelector(".knoww-stack-empty-title");
  if (title) title.textContent = "No markets for this stream";
  const sub = emptyState.querySelector(".knoww-stack-empty-sub");
  if (sub) {
    sub.textContent = "This game has no live prediction markets right now.";
  }
  for (const sel of [".knoww-stack-empty-dots", ".knoww-stack-empty-pulse"]) {
    emptyState
      .querySelector<HTMLElement>(sel)
      ?.style.setProperty("display", "none", "important");
  }
}

/**
 * Create a notification item for a trending market (fallback display)
 */
function createTrendingMarketItem(market: Market, index: number): HTMLElement {
  const marketSource = market.source || "polymarket";

  const item = document.createElement("div");
  item.className = `knoww-notification-item knoww-trending-item knoww-source-${marketSource} knoww-notification-active`;
  item.tabIndex = 0;
  item.setAttribute("role", "button");
  item.setAttribute("data-market-id", market.id);
  item.setAttribute("data-market-source", marketSource);
  item.setAttribute("aria-label", `Open ${market.title || "trending market"}`);
  item.style.animationDelay = `${index * 60}ms`;

  const icon = renderRowThumbnail(market);

  const content = document.createElement("div");
  content.className = "knoww-notification-content";

  const title = document.createElement("div");
  title.className = "knoww-notification-title";
  title.textContent = market.title || "Untitled Market";

  const meta = document.createElement("div");
  meta.className = "knoww-notification-meta";
  const categoryLabel = market.category || market.tags?.[0]?.label || "";
  const volumeLabel = formatMarketVolume(market);
  if (categoryLabel) {
    const cat = document.createElement("span");
    cat.textContent = categoryLabel;
    meta.appendChild(cat);
  }
  if (categoryLabel && volumeLabel) {
    const dot = document.createElement("span");
    dot.className = "knoww-notification-meta-dot";
    meta.appendChild(dot);
  }
  if (volumeLabel) {
    const vol = document.createElement("span");
    vol.textContent = volumeLabel;
    meta.appendChild(vol);
  }

  const pricesDiv = document.createElement("div");
  pricesDiv.className = "knoww-notification-prices";

  const parsed = parseMultiOutcomeData(market);
  let outcomes = parsed.outcomes;
  let priceData: number[] = parsed.prices;

  if (!parsed.isMultiOutcome && market.markets && market.markets.length > 0) {
    const firstMarket =
      market.markets[parsed.firstActiveMarketIndex] ?? market.markets[0];
    if (firstMarket.outcomePrices) {
      priceData = parseGammaPriceArray(firstMarket.outcomePrices);
    }
    if (firstMarket.outcomes) {
      outcomes = parseGammaStringArray(firstMarket.outcomes);
    }
    if (outcomes.length === 0 || priceData.length === 0) {
      outcomes = ["Yes", "No"];
      priceData = [0.5, 0.5];
    }
  }

  if (outcomes.length === 0) {
    outcomes = ["Yes", "No"];
    priceData = [0.5, 0.5];
  }

  renderEditorialPrice(pricesDiv, outcomes, priceData);

  content.appendChild(title);
  if (meta.childNodes.length > 0) content.appendChild(meta);

  item.appendChild(icon);
  item.appendChild(content);
  item.appendChild(pricesDiv);

  item.onclick = () => {
    void window.KNOWW_ANALYTICS?.track("notification_trending_clicked", {
      marketSlug: market.slug || market.id,
    });
    const marketUrl = buildMarketUrl(market);
    window.open(marketUrl, "_blank", "noopener,noreferrer");
    window.KNOWW_PREFERENCES?.recordClick(market);
  };
  item.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      item.click();
    }
  });

  return item;
}

/**
 * Pick MAX_TRENDING_DISPLAY random markets from the pool
 * using a Fisher-Yates partial shuffle (no array copy needed).
 */
function pickRandomTrending(): Market[] {
  if (trendingPool.length <= MAX_TRENDING_DISPLAY) return [...trendingPool];

  const indices = Array.from({ length: trendingPool.length }, (_, i) => i);
  for (
    let i = indices.length - 1;
    i > indices.length - 1 - MAX_TRENDING_DISPLAY;
    i--
  ) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  return indices
    .slice(indices.length - MAX_TRENDING_DISPLAY)
    .map((i) => trendingPool[i]);
}

/**
 * Shuffle the visible trending pair and refresh the notification stack.
 */
function shuffleTrending(): void {
  const { log } = window.KNOWW_UTILS;

  if (trendingPool.length <= MAX_TRENDING_DISPLAY) return;

  visibleTrending = pickRandomTrending();
  log(
    `🔀 [Trending] Shuffled — now showing: ${visibleTrending.map((m) => m.title?.slice(0, 30)).join(", ")}`
  );

  const currentMarkets = getStackBaseMarkets();
  updateNotificationStack(currentMarkets);
}

/**
 * Fetch trending markets, cache the full pool, pick 2 to display,
 * and start the 60-second shuffle interval.
 */
async function fetchAndCacheTrending(): Promise<void> {
  const { log } = window.KNOWW_UTILS;

  // Streaming surfaces only show markets relevant to the stream — no trending.
  if (isStreamSurface()) return;
  if (trendingFetchInFlight) return;
  trendingFetchInFlight = true;
  log("🔥 [Trending] Fetching trending markets...");

  try {
    const { fetchTrendingMarkets } = window.KNOWW_API;
    const trending = await fetchTrendingMarkets();
    trendingPool = trending;
    visibleTrending = pickRandomTrending();
    log(
      `🔥 [Trending] Pool: ${trendingPool.length}, showing: ${visibleTrending.length}`
    );

    startTrendingShuffleTimer();

    const currentMarkets = getStackBaseMarkets();
    updateNotificationStack(currentMarkets);
  } catch (e) {
    log("🔥 [Trending] Failed to fetch trending markets:", e);
  } finally {
    trendingFetchInFlight = false;
  }
}

/**
 * Start the 60-second shuffle interval.
 */
function startTrendingShuffleTimer(): void {
  if (trendingShuffleTimer) return;
  if (trendingPool.length <= MAX_TRENDING_DISPLAY) return;

  trendingShuffleTimer = setInterval(
    shuffleTrending,
    TRENDING_SHUFFLE_INTERVAL_MS
  );
}

/**
 * Stop the shuffle interval.
 */
function stopTrendingShuffleTimer(): void {
  if (trendingShuffleTimer) {
    clearInterval(trendingShuffleTimer);
    trendingShuffleTimer = null;
  }
}

function getVisibleTrendingMarkets(
  realMarketIds: Set<string>,
  expandedTrending: boolean,
  limitOverride?: number
): Market[] {
  const requestedLimit =
    typeof limitOverride === "number" && limitOverride > 0
      ? Math.floor(limitOverride)
      : undefined;
  const limit =
    requestedLimit ??
    (expandedTrending ? MAX_EXPANDED_TRENDING_DISPLAY : MAX_TRENDING_DISPLAY);
  const cappedLimit = Math.min(limit, MAX_EXPANDED_TRENDING_DISPLAY);
  const source =
    expandedTrending || cappedLimit > MAX_TRENDING_DISPLAY
      ? trendingPool
      : visibleTrending;

  return source.filter((m) => !realMarketIds.has(m.id)).slice(0, cappedLimit);
}

/**
 * Append the trending section to the items container.
 * Skips any trending market whose id already appears in the
 * real-market set to avoid duplicates.
 */
function appendTrendingSection(
  itemsContainer: HTMLElement,
  realMarketIds: Set<string>,
  animationIndex: number,
  expandedTrending = false
): number {
  const trendingToShow = getVisibleTrendingMarkets(
    realMarketIds,
    expandedTrending
  );

  if (trendingToShow.length === 0) return animationIndex;

  const header = createNotificationSectionHeader(
    "Trending now",
    trendingToShow.length,
    "trending"
  );
  header.classList.add("knoww-trending-header");
  itemsContainer.appendChild(header);

  trendingToShow.forEach((market, index) => {
    const item = createTrendingMarketItem(market, animationIndex + index);
    itemsContainer.appendChild(item);
  });

  return animationIndex + trendingToShow.length;
}

/**
 * Schedule the initial trending fetch.
 * Fires after TRENDING_FETCH_DELAY_MS so the extension has time
 * to discover feed-relevant markets first.
 */
function startTrendingFetchTimer(): void {
  // No trending on streaming surfaces.
  if (isStreamSurface()) return;
  if (trendingPool.length > 0 || trendingFetchTimer || trendingFetchInFlight) {
    return;
  }

  trendingFetchTimer = setTimeout(() => {
    trendingFetchTimer = null;
    fetchAndCacheTrending();
  }, TRENDING_FETCH_DELAY_MS);
}

/**
 * Cancel the trending fetch timer and shuffle interval.
 */
function cancelTrendingFetchTimer(): void {
  stopTrendingShuffleTimer();
  if (trendingFetchTimer) {
    clearTimeout(trendingFetchTimer);
    trendingFetchTimer = null;
  }
}

// On streaming surfaces (Twitch/YouTube) there is no feed scan, so the
// canonical `getInjectedMarkets()` store is empty. The streaming module pushes
// its markets here instead; when set, every internal stack refresh (trending
// fetch, shuffle, theme/resize re-render, snapshots) reads from this store so
// the stream markets are never clobbered by an empty feed store.
let streamMarketEntries: InjectedMarketEntry[] | null = null;
// True while an inline deposit owns a stream card. Suppresses the periodic
// stack rebuild so a price refresh can't wipe the in-progress deposit form.
let streamInlineDepositActive = false;
// Whether the "Other markets" dropdown on a stream surface is expanded. Default
// collapsed; remembered across price refreshes and SPA navigation within the
// session (the content script stays alive, so a module flag is enough).
let streamOthersExpanded = false;

/**
 * Render the stream-surface active section: the watched match (entry[0]) is
 * featured on top, every other market is tucked into a collapsible "Other
 * markets" dropdown. Returns the next animation index.
 */
function renderStreamActiveSection(
  container: HTMLElement,
  entries: InjectedMarketEntry[],
  startIndex: number
): number {
  let index = startIndex;
  const featured = entries[0];
  const others = entries.slice(1);

  container.appendChild(
    createNotificationSectionHeader("Live now", entries.length, "active")
  );
  container.appendChild(createNotificationItem(featured, index++, true));

  if (others.length === 0) return index;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "knoww-stream-others-toggle";
  toggle.innerHTML = `
    <span class="knoww-stream-others-label">
      <span class="knoww-stream-others-chevron" aria-hidden="true">▾</span>
      <span>Other markets</span>
    </span>
    <span class="knoww-stream-others-count">${others.length}</span>
  `;

  const list = document.createElement("div");
  list.className = "knoww-stream-others-list";
  others.forEach((entry) => {
    list.appendChild(createNotificationItem(entry, index++, true));
  });

  const applyExpanded = (): void => {
    toggle.classList.toggle("expanded", streamOthersExpanded);
    list.classList.toggle("expanded", streamOthersExpanded);
    toggle.setAttribute("aria-expanded", String(streamOthersExpanded));
    // Expanding grows the list past the stack's max-height, but the scroll
    // class is only set during updateNotificationStack (when collapsed → fits).
    // Re-evaluate now so the expanded list is actually scrollable.
    const items = document.getElementById("knoww-stack-items");
    if (items) {
      items.classList.toggle(
        "knoww-has-overflow",
        items.scrollHeight > items.clientHeight
      );
    }
  };
  applyExpanded();

  toggle.onclick = (e) => {
    e.stopPropagation();
    streamOthersExpanded = !streamOthersExpanded;
    applyExpanded();
  };

  container.appendChild(toggle);
  container.appendChild(list);
  return index;
}

/** True on streaming surfaces (Twitch/YouTube). Trending is suppressed there. */
function isStreamSurface(): boolean {
  return window.KNOWW_PLATFORM?.getCurrentPlatform?.()?.surface === "stream";
}

function getStackBaseMarkets(): InjectedMarketEntry[] {
  if (streamMarketEntries) return streamMarketEntries;
  return window.KNOWW_INJECTION?.getInjectedMarkets?.() || [];
}

/**
 * Set the markets for a streaming surface and render them. This is the entry
 * point the streaming module calls instead of feeding the per-post scan.
 */
function setStreamMarkets(markets: InjectedMarketEntry[]): void {
  streamMarketEntries = markets;
  updateNotificationStack(markets);
}

/**
 * Update the notification stack with current markets
 */
function updateNotificationStack(markets: InjectedMarketEntry[]): void {
  const { log } = window.KNOWW_UTILS;

  // Don't rebuild the stack while an inline deposit is mid-flow — it would
  // destroy the deposit form's DOM (and state) on the next price refresh.
  if (streamInlineDepositActive) {
    log("📋 [NotificationStack] Skipped rebuild — inline deposit active");
    return;
  }

  log(`\n📋 [NotificationStack] ========== UPDATE START ==========`);
  log(
    `📋 [NotificationStack] Total markets in tracking array: ${markets.length}`
  );

  if (!notificationStackContainer) {
    createNotificationStack();
  }

  const itemsContainer = document.getElementById("knoww-stack-items");
  const emptyState = document.getElementById("knoww-stack-empty");

  if (!itemsContainer || !emptyState) {
    log(`⏳ [NotificationStack] Containers not ready, retrying in 100ms...`);
    setTimeout(() => updateNotificationStack(markets), 100);
    return;
  }

  log(
    `🔍 [NotificationFilter] Checking availability for ${markets.length} tracked entries:`
  );

  // Deduplicate by market id (prefer visible active cards).
  const { activeMarkets, scrolledOutMarkets } =
    selectRepresentativeMarketEntries(markets);

  // Keep bounded lists for readability (platform-aware caps)
  const caps = resolveNotificationCaps();
  const recentActiveMarkets = cachedStackExpanded
    ? [...activeMarkets].reverse()
    : activeMarkets.slice(-caps.active).reverse();
  const recentScrolledMarkets = cachedStackExpanded
    ? [...scrolledOutMarkets].reverse()
    : scrolledOutMarkets.slice(-caps.scrolled).reverse();
  const activeFilter = cachedStackExpanded ? cachedStackFilter : "all";
  const showActiveSection = activeFilter === "all" || activeFilter === "active";
  const showSeenSection = activeFilter === "all" || activeFilter === "seen";
  const showTrendingSection =
    !isStreamSurface() &&
    (activeFilter === "all" || activeFilter === "trending");
  const displayedActiveMarkets = showActiveSection ? recentActiveMarkets : [];
  const displayedScrolledMarkets = showSeenSection ? recentScrolledMarkets : [];

  const totalDisplayed =
    displayedActiveMarkets.length + displayedScrolledMarkets.length;

  if (
    totalDisplayed === 0 &&
    (!showTrendingSection || visibleTrending.length === 0)
  ) {
    log(`📭 [NotificationStack] No markets to show, displaying empty state`);
    itemsContainer.innerHTML = "";
    showNotificationContent("empty");
    log(`📋 [NotificationStack] ========== UPDATE END ==========\n`);
    return;
  }

  // Markets to display (real and/or trending)
  itemsContainer.innerHTML = "";
  showNotificationContent("items");

  log(`\n📊 [NotificationFilter] SUMMARY:`);
  log(`   • Total markets tracked: ${markets.length}`);
  log(
    `   • Unique markets tracked: ${activeMarkets.length + scrolledOutMarkets.length}`
  );
  log(`   • Active markets: ${activeMarkets.length}`);
  log(`   • Scrolled-out markets: ${scrolledOutMarkets.length}`);
  log(`   • Displayed in stack: ${totalDisplayed}`);

  let animationIndex = 0;

  if (displayedActiveMarkets.length > 0) {
    if (isStreamSurface()) {
      // Stream: feature the watched match, collapse the rest into a dropdown.
      animationIndex = renderStreamActiveSection(
        itemsContainer,
        displayedActiveMarkets,
        animationIndex
      );
    } else {
      itemsContainer.appendChild(
        createNotificationSectionHeader(
          "Active now",
          displayedActiveMarkets.length,
          "active"
        )
      );
      displayedActiveMarkets.forEach((marketData) => {
        const item = createNotificationItem(marketData, animationIndex, true);
        animationIndex++;
        itemsContainer.appendChild(item);
      });
    }
  }

  // Trending appears between active markets and seen-earlier markets.
  // Collect real market IDs so we can skip duplicates.
  const realMarketIds = new Set<string>();
  for (const entry of [...activeMarkets, ...scrolledOutMarkets]) {
    realMarketIds.add(entry.market.id);
  }
  if (showTrendingSection) {
    animationIndex = appendTrendingSection(
      itemsContainer,
      realMarketIds,
      animationIndex,
      cachedStackExpanded && activeFilter === "trending"
    );
  }

  if (displayedScrolledMarkets.length > 0) {
    itemsContainer.appendChild(
      createNotificationSectionHeader(
        "Seen earlier",
        displayedScrolledMarkets.length,
        "scrolled-out"
      )
    );
    displayedScrolledMarkets.forEach((marketData) => {
      const item = createNotificationItem(marketData, animationIndex, false);
      animationIndex++;
      itemsContainer.appendChild(item);
    });
  }

  setTimeout(() => {
    if (itemsContainer.scrollHeight > itemsContainer.clientHeight) {
      itemsContainer.classList.add("knoww-has-overflow");
    } else {
      itemsContainer.classList.remove("knoww-has-overflow");
    }
  }, 50);

  log(`📋 [NotificationStack] ========== UPDATE END ==========\n`);
}

/**
 * Update the notification stack theme based on current platform theme
 */
function updateNotificationStackTheme(): void {
  if (!notificationStackContainer) return;

  const platform = window.KNOWW_PLATFORM?.getCurrentPlatform?.();
  if (!platform || typeof platform.detectTheme !== "function") return;

  const theme = platform.detectTheme();
  const platformName = window.KNOWW_PLATFORM?.getPlatformName?.() || "unknown";

  // Remove existing theme classes
  notificationStackContainer.classList.remove(
    "knoww-theme-dark",
    "knoww-theme-light",
    "knoww-theme-dim"
  );

  // Add the current theme class
  notificationStackContainer.classList.add(`knoww-theme-${theme}`);
  applyPlatformStyleVariables(
    notificationStackContainer,
    platform.getCardStyles?.(theme)
  );

  // Ensure the platform class is set
  if (
    !notificationStackContainer.classList.contains(
      `knoww-notification-stack-${platformName}`
    )
  ) {
    notificationStackContainer.classList.add(
      `knoww-notification-stack-${platformName}`
    );
  }
}

function openNotificationStack(
  log: (...args: unknown[]) => void,
  created = false
): void {
  ensureNotificationStackLifecyclePort();

  if (!notificationStackContainer) {
    createNotificationStack();
    created = true;
  } else {
    notificationStackContainer.style.removeProperty("display");
  }

  if (created) {
    void window.KNOWW_ANALYTICS?.track("notification_stack_opened");
    log("Notification stack initialized");
  }

  // Fetch trending markets after a short delay so they appear in
  // the notification stack alongside (or in place of) feed-discovered markets.
  startTrendingFetchTimer();
  log("Trending markets fetch scheduled (10s)");

  // Update theme immediately after creation (DOM might be more ready now)
  setTimeout(() => {
    updateNotificationStackTheme();
    log("Notification stack theme updated");
  }, 100);

  // Also update theme after a longer delay to catch late theme detection
  setTimeout(() => {
    updateNotificationStackTheme();
  }, 1000);

  // Guard: only attach global listeners/observers once to prevent accumulation on re-init
  if (!notificationStackListenersAttached) {
    notificationStackListenersAttached = true;
    document.addEventListener("keydown", handleNotificationStackKeydown);

    // PERFORMANCE: Debounce theme observer — theme changes are rare,
    // but body class/style mutations fire frequently on Twitter.
    let themeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedThemeUpdate = (): void => {
      if (themeDebounceTimer) clearTimeout(themeDebounceTimer);
      themeDebounceTimer = setTimeout(updateNotificationStackTheme, 500);
    };

    // Watch for theme changes via MutationObserver on body/html
    const observer = new MutationObserver(debouncedThemeUpdate);

    // Observe body for class/style changes (Twitter changes body background for themes)
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    // Also observe html element
    if (document.documentElement) {
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "style"],
      });
    }

    // Watch for prefers-color-scheme changes
    if (window.matchMedia) {
      window
        .matchMedia("(prefers-color-scheme: dark)")
        .addEventListener("change", debouncedThemeUpdate);
    }

    window.addEventListener("resize", () => {
      if (notificationStackContainer) {
        clampNotificationStackToViewport(notificationStackContainer);
      }
    });

    // ============================================
    // DRAGGABLE NOTIFICATION STACK (all platforms)
    // ============================================
    setupDraggable(log);
  }
}

/**
 * Initialize the notification stack
 */
function setNotificationStackVisibility(visible: boolean): void {
  if (visible) {
    persistStackDismissed(false);
    ensureNotificationStackLifecyclePort();
    openNotificationStack(window.KNOWW_UTILS.log);
    if (notificationStackContainer) {
      resetNotificationStackToPreferredPosition(notificationStackContainer);
    }
    return;
  }

  persistStackDismissed(true);
  disconnectNotificationStackLifecyclePort();
  if (notificationStackContainer) {
    notificationStackContainer.style.setProperty(
      "display",
      "none",
      "important"
    );
  }
}

function summarizeSnapshotMarket(
  market: Market,
  status: "active" | "seen" | "trending"
): Record<string, string> {
  const parsed = parseMultiOutcomeData(market);
  let outcomes = parsed.outcomes;
  let prices = parsed.prices;

  if (!parsed.isMultiOutcome && market.markets?.length) {
    const firstMarket =
      market.markets[parsed.firstActiveMarketIndex] ?? market.markets[0];
    if (firstMarket.outcomePrices) {
      prices = parseGammaPriceArray(firstMarket.outcomePrices);
    }
    if (firstMarket.outcomes) {
      outcomes = parseGammaStringArray(firstMarket.outcomes);
    }
  }

  let leadingIdx = 0;
  let leadingPriceDecimal = toDecimal(prices[0]) ?? new Decimal(0);
  for (let i = 1; i < prices.length; i++) {
    const candidatePrice = toDecimal(prices[i]) ?? new Decimal(0);
    if (candidatePrice.gt(leadingPriceDecimal)) {
      leadingIdx = i;
      leadingPriceDecimal = candidatePrice;
    }
  }
  const priceCents = Decimal.max(
    0,
    Decimal.min(99, leadingPriceDecimal.mul(100))
  )
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    .toString();
  const priceSideLabel =
    outcomes[leadingIdx] || (outcomes.length === 2 ? "Yes" : "Top");

  return {
    id: market.id,
    title: market.title || "Untitled market",
    source: market.source || "polymarket",
    imageUrl: market.image || "",
    volume: formatMarketVolume(market) || "",
    category: market.category || market.tags?.[0]?.label || "",
    priceCents,
    priceSideLabel,
    status,
    url: buildMarketUrl(market),
  };
}

function summarizeNotificationMarket(
  entry: InjectedMarketEntry,
  status: "active" | "seen"
): Record<string, string> {
  return summarizeSnapshotMarket(entry.market, status);
}

function getNotificationStackSnapshot(
  trendingLimit?: number
): Record<string, unknown> {
  startTrendingFetchTimer();
  const markets = getStackBaseMarkets();
  const { activeMarkets, scrolledOutMarkets } =
    selectRepresentativeMarketEntries(markets);
  const realMarketIds = new Set<string>();
  for (const entry of [...activeMarkets, ...scrolledOutMarkets]) {
    realMarketIds.add(entry.market.id);
  }
  const trendingMarkets = getVisibleTrendingMarkets(
    realMarketIds,
    false,
    trendingLimit
  );
  return {
    platform: window.KNOWW_PLATFORM?.getPlatformName?.() || "unknown",
    active: activeMarkets
      .slice(-8)
      .reverse()
      .map((entry) => summarizeNotificationMarket(entry, "active")),
    seen: scrolledOutMarkets
      .slice(-8)
      .reverse()
      .map((entry) => summarizeNotificationMarket(entry, "seen")),
    trending: trendingMarkets.map((market) =>
      summarizeSnapshotMarket(market, "trending")
    ),
  };
}

async function searchNotificationStackMarkets(
  query: string
): Promise<Record<string, string>[]> {
  const events = await window.KNOWW_API.searchPolymarketEvents(query, []);
  return events
    .slice(0, 5)
    .map((market) => summarizeSnapshotMarket(market, "trending"));
}

function focusNotificationStackMarket(marketId: string): boolean {
  const markets = getStackBaseMarkets();
  const { activeMarkets, scrolledOutMarkets } =
    selectRepresentativeMarketEntries(markets);
  const injectedEntry = [...activeMarkets, ...scrolledOutMarkets].find(
    (entry) => entry.market.id === marketId
  );

  if (injectedEntry) {
    void window.KNOWW_ANALYTICS?.track("notification_sidepanel_item_clicked", {
      marketId,
      source: injectedEntry.market.source || "polymarket",
    });
    scrollToMarket(
      injectedEntry.cardRef as WeakRef<HTMLElement> | null,
      injectedEntry.market.id,
      injectedEntry.market,
      injectedEntry.postKey
    );
    window.KNOWW_PREFERENCES?.recordClick(injectedEntry.market);
    return true;
  }

  const trendingMarket = [...visibleTrending, ...trendingPool].find(
    (market) => market.id === marketId
  );
  if (trendingMarket) {
    void window.KNOWW_ANALYTICS?.track(
      "notification_sidepanel_trending_clicked",
      {
        marketSlug: trendingMarket.slug || trendingMarket.id,
      }
    );
    window.open(
      buildMarketUrl(trendingMarket),
      "_blank",
      "noopener,noreferrer"
    );
    window.KNOWW_PREFERENCES?.recordClick(trendingMarket);
    return true;
  }

  return false;
}

function initNotificationStack(): void {
  const { log } = window.KNOWW_UTILS;

  void readPersistedStackDismissed().then((dismissed) => {
    if (dismissed) return;
    createNotificationStack();
    openNotificationStack(log, true);
  });
}

// Register the wallet bridge (incl. the `trading:signing-request` listener)
// eagerly on every supported page. Otherwise it only initialises lazily on the
// first wallet action, so a tab that connected and later reloaded would have no
// signing listener — and portfolio deposit/withdraw signatures relayed to it
// would fail with "Receiving end does not exist".
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  WalletBridge.init();
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener(
    (
      message: {
        type?: string;
        marketId?: string;
        query?: string;
        address?: string;
        walletUuid?: string;
        visible?: boolean;
        trendingLimit?: number;
      },
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response: { success: boolean; data?: unknown }) => void
    ) => {
      if (message?.type === "KNOWW_OPEN_EXTENSION") {
        setNotificationStackVisibility(true);
        sendResponse({ success: true });
        return true;
      }

      if (message?.type === "KNOWW_SET_NOTIFICATION_STACK_VISIBILITY") {
        setNotificationStackVisibility(message.visible !== false);
        sendResponse({ success: true });
        return true;
      }

      if (message?.type === "KNOWW_GET_NOTIFICATION_STACK_SNAPSHOT") {
        sendResponse({
          success: true,
          data: getNotificationStackSnapshot(message.trendingLimit),
        });
        return true;
      }

      if (message?.type === "KNOWW_FOCUS_NOTIFICATION_MARKET") {
        sendResponse({
          success:
            typeof message.marketId === "string" &&
            focusNotificationStackMarket(message.marketId),
        });
        return true;
      }

      if (message?.type === "KNOWW_SEARCH_NOTIFICATION_MARKETS") {
        const query = typeof message.query === "string" ? message.query : "";
        void searchNotificationStackMarkets(query)
          .then((data) => sendResponse({ success: true, data }))
          .catch(() => sendResponse({ success: false, data: [] }));
        return true;
      }

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
          const hadCachedAddress = Boolean(TradingService.getContext().address);
          const address = await TradingService.getConnectedWalletAddress();
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
              await connectAndAuthorizePortfolioWallet(message.walletUuid);
            } catch {
              // WalletConnect pairing errors are exposed through the polled
              // bridge state; installed-wallet failures are returned below.
            }
          })();
          return false;
        }

        void (async () => {
          try {
            const address = await connectAndAuthorizePortfolioWallet(
              message.walletUuid
            );
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
            const address = await switchAndAuthorizePortfolioWallet();
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
            let address = TradingService.getContext().address;
            if (!address) {
              await TradingService.connectWallet();
              address = TradingService.getContext().address;
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
                  err instanceof Error
                    ? err.message
                    : "Re-authorization failed",
              },
            });
          }
        })();
        return true;
      }

      if (message?.type === "KNOWW_CANCEL_PORTFOLIO_WALLETCONNECT") {
        void WalletBridge.cancelMobileConnect().catch(() => {});
        sendResponse({ success: true, data: { status: "cancelled" } });
        return false;
      }

      if (message?.type === "KNOWW_GET_PORTFOLIO_WALLETCONNECT_STATE") {
        const wcState = WalletBridge.getMobileConnectionState();
        let qrSvg: string | null = null;
        if (wcState.qrUri) {
          try {
            qrSvg = renderWalletConnectQrSvg(wcState.qrUri);
          } catch {
            qrSvg = null;
          }
        }
        sendResponse({
          success: true,
          data: { status: wcState.status, error: wcState.error, qrSvg },
        });
        return false;
      }

      if (message?.type === "KNOWW_ENABLE_PORTFOLIO_TRADING") {
        const requestedAddress =
          typeof message.address === "string" ? message.address : "";
        sendResponse({
          success: true,
          data: { status: "started" },
        });
        void (async () => {
          if (!requestedAddress) {
            throw new Error("Missing wallet address");
          }

          const currentAddress = TradingService.getContext().address;
          if (
            !currentAddress ||
            currentAddress.toLowerCase() !== requestedAddress.toLowerCase()
          ) {
            await TradingService.connectWallet();
          }

          const connectedAddress = TradingService.getContext().address;
          if (
            !connectedAddress ||
            connectedAddress.toLowerCase() !== requestedAddress.toLowerCase()
          ) {
            throw new Error("Connected wallet does not match portfolio wallet");
          }

          await TradingService.deriveCredentials();
        })().catch(() => {});
        return false;
      }

      if (message?.type === "KNOWW_APPROVE_PORTFOLIO_TRADING") {
        const requestedAddress =
          typeof message.address === "string" ? message.address : "";
        const rawApprovalAmount = (message as { approvalAmount?: unknown })
          .approvalAmount;
        const rawAmount =
          typeof rawApprovalAmount === "string" ? rawApprovalAmount : "";
        void (async () => {
          if (!requestedAddress) {
            throw new Error("Missing wallet address");
          }

          const currentAddress = TradingService.getContext().address;
          if (
            !currentAddress ||
            currentAddress.toLowerCase() !== requestedAddress.toLowerCase()
          ) {
            await TradingService.connectWallet();
          }

          const connectedAddress = TradingService.getContext().address;
          if (
            !connectedAddress ||
            connectedAddress.toLowerCase() !== requestedAddress.toLowerCase()
          ) {
            throw new Error("Connected wallet does not match portfolio wallet");
          }

          const amount = Number(rawAmount);
          await TradingService.approveUsdc(
            false,
            Number.isFinite(amount) && amount > 0 ? amount : undefined
          );
          sendResponse({
            success: true,
            data: { status: "approved" },
          });
        })().catch((err) => {
          sendResponse({
            success: false,
            data: {
              error: err instanceof Error ? err.message : "Approval failed",
            },
          });
        });
        return true;
      }

      return false;
    }
  );
}

// ============================================
// DRAGGABLE NOTIFICATION STACK
// Makes the notification stack draggable via its header
// ============================================

/**
 * Make the notification stack draggable via its header.
 */
function setupDraggable(log: (...args: unknown[]) => void): void {
  if (!notificationStackContainer) return;

  const header = notificationStackContainer.querySelector(
    ".knoww-stack-header"
  ) as HTMLElement | null;
  if (!header) return;

  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let activePointerId: number | null = null;

  // Pointer Events + setPointerCapture: unlike document-level mousemove, this
  // keeps every move event routed to the header even while the cursor passes
  // over the video player / iframes / other pointer-capturing elements (which
  // is exactly what swallows a mouse-event drag on Twitch/YouTube).
  header.addEventListener("pointerdown", (e: PointerEvent) => {
    if (!notificationStackContainer || e.button !== 0) return;

    // Don't drag when starting on a button inside the header.
    if ((e.target as Element).closest("button")) return;

    const rect = notificationStackContainer.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    isDragging = true;
    activePointerId = e.pointerId;
    try {
      header.setPointerCapture(e.pointerId);
    } catch {
      // capture is best-effort
    }

    notificationStackContainer.classList.add("knoww-dragging");
    e.preventDefault();
  });

  header.addEventListener("pointermove", (e: PointerEvent) => {
    if (!isDragging || !notificationStackContainer) return;

    const rect = notificationStackContainer.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width;
    const maxTop = window.innerHeight - rect.height;
    const newLeft = Math.max(0, Math.min(e.clientX - dragOffsetX, maxLeft));
    const newTop = Math.max(0, Math.min(e.clientY - dragOffsetY, maxTop));

    // setProperty with 'important' beats the !important top/right in CSS.
    // Also neutralize right/bottom so the box moves instead of stretching.
    const style = notificationStackContainer.style;
    style.setProperty("left", `${newLeft}px`, "important");
    style.setProperty("top", `${newTop}px`, "important");
    style.setProperty("right", "auto", "important");
    style.setProperty("bottom", "auto", "important");

    e.preventDefault();
  });

  const endDrag = (): void => {
    if (!isDragging || !notificationStackContainer) return;
    isDragging = false;
    if (activePointerId !== null) {
      try {
        header.releasePointerCapture(activePointerId);
      } catch {
        // ignore
      }
      activePointerId = null;
    }
    notificationStackContainer.classList.remove("knoww-dragging");
  };

  header.addEventListener("pointerup", endDrag);
  header.addEventListener("pointercancel", endDrag);

  log("Draggable behavior initialized on notification stack header");
}

// Export UI functions
export const KNOWW_UI = {
  createInlineMarketCard,
  getMarketEmoji,
  buildMarketUrl,
  buildKnowwUrl,
  buildKnowwUrlForOutcome,
  buildKalshiUrl,
  createNotificationStack,
  createNotificationItem,
  updateNotificationStack,
  setStreamMarkets,
  updateNotificationStackTheme,
  scrollToMarket,
  initNotificationStack,
  fetchAndCacheTrending,
  cancelTrendingFetchTimer,
  SOURCE_CONFIG,
};

window.KNOWW_UI = KNOWW_UI;
