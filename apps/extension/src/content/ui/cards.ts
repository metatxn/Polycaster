import {
  parseGammaNumberArray,
  parseGammaStringArray,
} from "@knoww/shared-types/polymarket";
import { Decimal } from "decimal.js";
import type { Market, NestedMarket } from "../../types/market";
import { escapeHtml } from "../html-escape";
import { setCspSafeImageSrc } from "../image-proxy";
import { prioritizeByPreferredOutcomeNames } from "../market-context";
import type { PanelOpenArgs, TradingRuntime } from "../trading-runtime-types";
import { resolvePrimarySportsMoneyline } from "./stream-bet-calc";

export interface CardTradingRuntimePort {
  load(): Promise<Pick<TradingRuntime, "openTradingPanel">>;
  getLoaded(): Pick<TradingRuntime, "hideTradingPanel"> | null;
  showError(message: string): void;
}

let cardTradingRuntimePort: CardTradingRuntimePort | null = null;
const activatingTradingTriggers = new WeakSet<HTMLElement>();

export function configureCardTradingRuntimePort(
  port: CardTradingRuntimePort
): void {
  cardTradingRuntimePort = port;
}

export function resetCardTradingRuntimePort(): void {
  cardTradingRuntimePort = null;
}

function tradingRuntimePort(): CardTradingRuntimePort {
  if (!cardTradingRuntimePort) {
    throw new Error("Card trading runtime port is not configured");
  }
  return cardTradingRuntimePort;
}

async function openTradingPanel(
  market: Market,
  outcomeName: string,
  outcomeIndex: number,
  price: number,
  anchorElement: HTMLElement,
  isMultiOutcome: boolean,
  marketIndex?: number
): Promise<void> {
  const trigger = anchorElement;
  if (activatingTradingTriggers.has(trigger)) return;
  const card = trigger.closest<HTMLElement>(".knoww-market-card");
  if (!card || !trigger.isConnected || !card.isConnected) return;

  if (__STORE_BUILD__) {
    // The Chrome Web Store–compliant build ships no in-page trading panel.
    // Hand the user off to the knoww.app market page instead of loading the
    // (absent) trading runtime. See docs/chrome-prediction-market-ban-assessment.md.
    // Multi-outcome options are their own nested binary markets: link the
    // option's conditionId with outcome "yes", not markets[0] with yes/no.
    const url = isMultiOutcome
      ? buildKnowwUrlForOutcome(market, {
          name: outcomeName,
          price,
          marketIndex: marketIndex ?? 0,
          conditionId:
            typeof marketIndex === "number"
              ? market.markets?.[marketIndex]?.conditionId
              : undefined,
        } satisfies MultiOutcomeItem)
      : buildKnowwUrl(market, outcomeIndex, "BUY");
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  activatingTradingTriggers.add(trigger);
  const port = tradingRuntimePort();
  const previousStyle = trigger.getAttribute("style");
  const previousBusy = trigger.getAttribute("aria-busy");
  const previousDisabled = trigger.getAttribute("aria-disabled");
  const wasButtonDisabled =
    trigger instanceof HTMLButtonElement ? trigger.disabled : null;

  if (trigger instanceof HTMLButtonElement) trigger.disabled = true;
  trigger.setAttribute("aria-disabled", "true");
  trigger.setAttribute("aria-busy", "true");
  trigger.style.pointerEvents = "none";
  trigger.style.opacity = "0.6";

  try {
    const runtime = await port.load();
    if (!trigger.isConnected || !card.isConnected) return;
    runtime.openTradingPanel({
      market,
      outcomeName,
      outcomeIndex,
      price,
      anchorElement,
      isMultiOutcome,
      marketIndex,
    });
  } catch {
    if (trigger.isConnected && card.isConnected) {
      port.showError("Trading is unavailable right now. Please try again.");
    }
  } finally {
    if (previousStyle === null) trigger.removeAttribute("style");
    else trigger.setAttribute("style", previousStyle);
    if (previousBusy === null) trigger.removeAttribute("aria-busy");
    else trigger.setAttribute("aria-busy", previousBusy);
    if (previousDisabled === null) trigger.removeAttribute("aria-disabled");
    else trigger.setAttribute("aria-disabled", previousDisabled);
    if (wasButtonDisabled !== null) {
      (trigger as HTMLButtonElement).disabled = wasButtonDisabled;
    }
    activatingTradingTriggers.delete(trigger);
  }
}

export function hideLoadedTradingPanel(): void {
  // No-op when the port is unconfigured (store build, or a dismiss/minimize
  // that races ahead of configuration) — there is no loaded panel to hide.
  cardTradingRuntimePort?.getLoaded()?.hideTradingPanel();
}

export async function activateCardTradingIntentForTest(
  trigger: HTMLElement,
  args: Omit<PanelOpenArgs, "anchorElement">
): Promise<void> {
  await openTradingPanel(
    args.market,
    args.outcomeName,
    args.outcomeIndex,
    args.price,
    trigger,
    args.isMultiOutcome,
    args.marketIndex
  );
}

function clampGammaPrice(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function toDecimal(
  value: number | string | null | undefined
): Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    const decimal = new Decimal(value);
    return decimal.isFinite() ? decimal : null;
  } catch {
    return null;
  }
}

export function parseGammaPriceArray(
  raw: string | readonly unknown[] | null | undefined
): number[] {
  return parseGammaNumberArray(raw).map(clampGammaPrice);
}

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

export const SOURCE_CONFIG: Record<string, SourceConfigItem> = {
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
export interface MultiOutcomeItem {
  name: string;
  price: number;
  marketIndex: number;
  conditionId?: string;
}

export interface ParsedOutcomeData {
  isMultiOutcome: boolean;
  outcomes: string[];
  prices: number[];
  multiOutcomeData: MultiOutcomeItem[];
  firstActiveMarketIndex: number;
}

export interface MarketDisplayData extends ParsedOutcomeData {
  hasMultipleOptions: boolean;
}

const LIVE_MARKET_REFRESH_INTERVAL_MS = 30000;
const LIVE_MARKET_REFRESH_INITIAL_DELAY_MS = 5000;

/**
 * Safely resolve extension asset URLs.
 * Guards against "Extension context invalidated" after hot-reload/update.
 */
export function getSafeRuntimeUrl(path: string): string | null {
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

export function applyPlatformStyleVariables(
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
export function parseMultiOutcomeData(market: Market): ParsedOutcomeData {
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

export function resolveMarketDisplayData(market: Market): MarketDisplayData {
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
export function renderOutcomePrices(
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
export function buildMarketUrl(
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
export function buildKalshiUrl(market: Market): string {
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
export function buildKnowwUrl(
  market: Market,
  outcomeIndex = 0,
  side = "BUY"
): string {
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
export function buildKnowwUrlForOutcome(
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

export function reconcileMultiOutcomeData(
  currentOptions: MultiOutcomeItem[],
  refreshedOptions: readonly MultiOutcomeItem[]
): void {
  const refreshedByName = new Map(
    refreshedOptions.map((option) => [
      normalizeOutcomeName(option.name),
      option,
    ])
  );

  for (let index = 0; index < currentOptions.length; index++) {
    const currentOption = currentOptions[index];
    const refreshedOption =
      refreshedByName.get(normalizeOutcomeName(currentOption.name)) ??
      refreshedOptions[index];
    if (!refreshedOption) continue;

    currentOption.price = refreshedOption.price;
    currentOption.marketIndex = refreshedOption.marketIndex;
    currentOption.conditionId = refreshedOption.conditionId;
  }
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

  reconcileMultiOutcomeData(
    state.multiOutcomeData,
    displayData.multiOutcomeData
  );

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
export function createInlineMarketCard(
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

    hideLoadedTradingPanel();

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
        void openTradingPanel(
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
          void openTradingPanel(
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
          void openTradingPanel(
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
      hideLoadedTradingPanel();
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
export function getMarketEmoji(market: Market): string {
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
