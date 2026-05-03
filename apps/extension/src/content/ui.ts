// ============================================
// UI COMPONENTS - Multi-Source Market Cards
// ============================================

import {
  parseGammaNumberArray,
  parseGammaStringArray,
  resolveNegRisk,
} from "@knoww/shared-types/polymarket";
import type {
  InjectedMarketEntry,
  Market,
  NestedMarket,
} from "../types/market";
import { TradingPanel } from "./trading/trading-panel";
import { escapeHtml, escapeSelectorValue } from "./utils";

function clampGammaPrice(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function parseGammaPriceArray(
  raw: string | readonly unknown[] | null | undefined
): number[] {
  return parseGammaNumberArray(raw).map(clampGammaPrice);
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
  marketIndex?: number
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

  if (result.multiOutcomeData.length <= 1) {
    result.isMultiOutcome = false;
    result.multiOutcomeData = [];
    return result;
  }

  result.outcomes = result.multiOutcomeData.map((d) => d.name);
  result.prices = result.multiOutcomeData.map((d) => d.price);

  return result;
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

  const parsed = parseMultiOutcomeData(market);
  let outcomes = parsed.outcomes;
  let prices: number[] = parsed.prices;
  const isMultiOutcomeEvent = parsed.isMultiOutcome;
  const multiOutcomeData = parsed.multiOutcomeData;
  const firstActiveMarketIdx = parsed.firstActiveMarketIndex;
  let hasMultipleOptions = multiOutcomeData.length > 2;

  // If not a multi-outcome event, try standard parsing
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

  // Fallback: check if outcomes/prices are directly on the market object
  if (outcomes.length === 0 && market.outcomes) {
    outcomes = market.outcomes.map((o) => o.title || o.name || "Unknown");
    prices = market.outcomes.map((o) => o.price || 0.5);
    hasMultipleOptions = outcomes.length > 2;
  }

  // Ensure we always have at least Yes/No for display
  if (outcomes.length === 0) {
    outcomes = ["Yes", "No"];
    prices = [0.5, 0.5];
  }

  // Ensure prices array matches outcomes length
  while (prices.length < outcomes.length) {
    prices.push(0.5);
  }

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
    img.src = imageUrl;
    img.alt = "";
    img.decoding = "async";
    img.onerror = () => {
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
let trendingFetchTimer: ReturnType<typeof setTimeout> | null = null;
let trendingShuffleTimer: ReturnType<typeof setInterval> | null = null;
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

// ─── Minimize / expand state ───────────────────────────────────────────
//
// The notification stack can be collapsed to just its header when users
// want the panel out of the way. The collapsed preference is persisted
// per-origin so it survives page navigations and reloads.

const STACK_MINIMIZED_STORAGE_KEY = "knoww-stack-minimized";

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

let cachedStackMinimized = false;

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

function persistStackMinimized(value: boolean): void {
  try {
    chrome.storage?.local.set({ [STACK_MINIMIZED_STORAGE_KEY]: value });
  } catch {
    // Non-fatal; the UI state stays consistent for the current session.
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

  // Brand mark — the diamond-cutout K logo, served from the extension's
  // bundled `icons/` folder so it matches the toolbar icon, the web's
  // <KnowwMark />, and the favicons exactly.
  const brandIconUrl =
    getSafeRuntimeUrl("icons/icon-48.png") || "icons/icon-48.png";
  headerTitle.innerHTML = `
    <div class="knoww-stack-icon">
      <img src="${brandIconUrl}" alt="" width="20" height="20" />
    </div>
    <span>Markets</span>
  `;

  const headerRight = document.createElement("div");
  headerRight.className = "knoww-stack-header-right";

  const searchToggle = document.createElement("button");
  searchToggle.className = "knoww-search-toggle";
  searchToggle.id = "knoww-search-toggle";
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

  headerRight.appendChild(searchToggle);
  headerRight.appendChild(minimizeToggle);
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
        <span class="knoww-stack-empty-title">Searching for markets</span>
        <span class="knoww-stack-empty-dots" aria-hidden="true">
          <span></span><span></span><span></span>
        </span>
      </div>
      <span class="knoww-stack-empty-sub">Scroll your feed to discover markets</span>
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

  container.appendChild(header);
  container.appendChild(searchContainer);
  container.appendChild(contentArea);

  // Append to body with fixed positioning (all platforms)
  document.body.appendChild(container);
  log("Notification stack created with fixed position");

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

  // When minimized, clicking the title row (logo + "Markets" label) expands
  // the panel — matches the affordance you'd expect from a collapsed pill.
  headerTitle.addEventListener("click", () => {
    if (container.classList.contains("knoww-stack-minimized")) {
      toggleMinimized();
    }
  });

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
    img.src = imageUrl;
    img.alt = "";
    img.onerror = () => {
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
  item.setAttribute("data-market-id", market.id);
  item.setAttribute("data-market-source", marketSource);
  item.setAttribute("data-market-status", isActive ? "active" : "scrolled-out");
  item.style.animationDelay = `${index * 50}ms`;

  const icon = document.createElement("div");
  icon.className = "knoww-notification-icon";

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
    img.src = imageUrl;
    img.alt = "";
    img.onerror = () => {
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
  content.className = "knoww-notification-content";

  const title = document.createElement("div");
  title.className = "knoww-notification-title";
  title.textContent = truncateText(market.title || "Untitled Market", 50);

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

  renderOutcomePrices(pricesDiv, outcomes, priceData, 2);

  content.appendChild(title);
  content.appendChild(pricesDiv);

  const arrow = document.createElement("div");
  arrow.className = "knoww-notification-arrow";
  arrow.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M5 12h14M12 5l7 7-7 7"/>
    </svg>
  `;

  item.appendChild(icon);
  item.appendChild(content);
  item.appendChild(arrow);

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

  return item;
}

/**
 * Create a section header within the notification stack list
 */
function createNotificationSectionHeader(
  title: string,
  count: number
): HTMLElement {
  const header = document.createElement("div");
  header.className = "knoww-stack-section-header";
  header.innerHTML = `
    <span class="knoww-stack-section-title">${title}</span>
    <span class="knoww-stack-section-count">${count}</span>
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

  targetCard.classList.add("knoww-highlight");

  setTimeout(() => {
    if (targetCard) {
      targetCard.classList.remove("knoww-highlight");
    }
  }, 2000);
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
  }
}

/**
 * Create a notification item for a trending market (fallback display)
 */
function createTrendingMarketItem(market: Market, index: number): HTMLElement {
  const marketSource = market.source || "polymarket";

  const item = document.createElement("div");
  item.className = `knoww-notification-item knoww-trending-item knoww-source-${marketSource} knoww-notification-active`;
  item.setAttribute("data-market-id", market.id);
  item.setAttribute("data-market-source", marketSource);
  item.style.animationDelay = `${index * 60}ms`;

  const icon = document.createElement("div");
  icon.className = "knoww-notification-icon";

  let imageUrl = market.image;
  if (!imageUrl && market.markets && market.markets.length > 0) {
    imageUrl = (market.markets[0] as NestedMarket & { image?: string }).image;
  }

  const kalshiFallbackIcon =
    getSafeRuntimeUrl("icons/icon-48.png") ||
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Crect fill='%234a5568' width='48' height='48' rx='8'/%3E%3Ctext x='24' y='32' font-size='24' text-anchor='middle' fill='white'%3EK%3C/text%3E%3C/svg%3E";

  if (imageUrl) {
    const img = document.createElement("img");
    img.src = imageUrl;
    img.alt = "";
    img.onerror = () => {
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
  content.className = "knoww-notification-content";

  const title = document.createElement("div");
  title.className = "knoww-notification-title";
  title.textContent = truncateText(market.title || "Untitled Market", 50);

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

  renderOutcomePrices(pricesDiv, outcomes, priceData, 2);

  content.appendChild(title);
  content.appendChild(pricesDiv);

  const arrow = document.createElement("div");
  arrow.className = "knoww-notification-arrow";
  arrow.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M5 12h14M12 5l7 7-7 7"/>
    </svg>
  `;

  item.appendChild(icon);
  item.appendChild(content);
  item.appendChild(arrow);

  item.onclick = () => {
    void window.KNOWW_ANALYTICS?.track("notification_trending_clicked", {
      marketSlug: market.slug || market.id,
    });
    const marketUrl = buildMarketUrl(market);
    window.open(marketUrl, "_blank", "noopener,noreferrer");
    window.KNOWW_PREFERENCES?.recordClick(market);
  };

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

  const currentMarkets = window.KNOWW_INJECTION?.getInjectedMarkets?.() || [];
  updateNotificationStack(currentMarkets);
}

/**
 * Fetch trending markets, cache the full pool, pick 2 to display,
 * and start the 60-second shuffle interval.
 */
async function fetchAndCacheTrending(): Promise<void> {
  const { log } = window.KNOWW_UTILS;

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

    const currentMarkets = window.KNOWW_INJECTION?.getInjectedMarkets?.() || [];
    updateNotificationStack(currentMarkets);
  } catch (e) {
    log("🔥 [Trending] Failed to fetch trending markets:", e);
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

/**
 * Append the trending section to the items container.
 * Skips any trending market whose id already appears in the
 * real-market set to avoid duplicates.
 */
function appendTrendingSection(
  itemsContainer: HTMLElement,
  realMarketIds: Set<string>,
  animationIndex: number
): void {
  const trendingToShow = visibleTrending
    .filter((m) => !realMarketIds.has(m.id))
    .slice(0, MAX_TRENDING_DISPLAY);

  if (trendingToShow.length === 0) return;

  const header = document.createElement("div");
  header.className = "knoww-stack-section-header knoww-trending-header";
  header.innerHTML = `
    <span class="knoww-stack-section-title">
      <span class="knoww-trending-icon" aria-hidden="true">🔥</span>
      Trending now
    </span>
    <span class="knoww-stack-section-count">${trendingToShow.length}</span>
  `;
  itemsContainer.appendChild(header);

  trendingToShow.forEach((market, index) => {
    const item = createTrendingMarketItem(market, animationIndex + index);
    itemsContainer.appendChild(item);
  });
}

/**
 * Schedule the initial trending fetch.
 * Fires after TRENDING_FETCH_DELAY_MS so the extension has time
 * to discover feed-relevant markets first.
 */
function startTrendingFetchTimer(): void {
  cancelTrendingFetchTimer();

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

/**
 * Update the notification stack with current markets
 */
function updateNotificationStack(markets: InjectedMarketEntry[]): void {
  const { log } = window.KNOWW_UTILS;

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

  // Deduplicate by market id (keep most recent entry)
  const dedupedMarkets: InjectedMarketEntry[] = [];
  const seenMarketIds = new Set<string>();
  for (let i = markets.length - 1; i >= 0; i--) {
    const entry = markets[i];
    if (!entry?.market?.id || seenMarketIds.has(entry.market.id)) continue;
    seenMarketIds.add(entry.market.id);
    dedupedMarkets.push(entry);
  }
  dedupedMarkets.reverse();

  log(
    `🔍 [NotificationFilter] Checking availability for ${dedupedMarkets.length} unique markets:`
  );

  // Split into active (in DOM) vs recently scrolled out (not in DOM anymore)
  const activeMarkets: InjectedMarketEntry[] = [];
  const scrolledOutMarkets: InjectedMarketEntry[] = [];

  dedupedMarkets.forEach((marketData) => {
    const now = Date.now();
    const isCardAvailable = isCardStillAvailable(
      marketData.cardRef,
      marketData.market.title
    );
    const isVisible =
      typeof marketData.isInViewport === "boolean"
        ? marketData.isInViewport
        : true;
    const lastVisibleAt = marketData.lastVisibleAt ?? marketData.timestamp;
    const recentlyVisible = now - lastVisibleAt <= SCROLLED_OUT_GRACE_MS;

    if (isCardAvailable && (isVisible || recentlyVisible)) {
      activeMarkets.push(marketData);
    } else {
      scrolledOutMarkets.push(marketData);
    }
  });

  // Keep bounded lists for readability (platform-aware caps)
  const caps = resolveNotificationCaps();
  const recentActiveMarkets = activeMarkets.slice(-caps.active).reverse();
  const recentScrolledMarkets = scrolledOutMarkets
    .slice(-caps.scrolled)
    .reverse();

  const totalDisplayed =
    recentActiveMarkets.length + recentScrolledMarkets.length;

  if (totalDisplayed === 0 && visibleTrending.length === 0) {
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
  log(`   • Unique markets tracked: ${dedupedMarkets.length}`);
  log(`   • Active markets: ${activeMarkets.length}`);
  log(`   • Scrolled-out markets: ${scrolledOutMarkets.length}`);
  log(`   • Displayed in stack: ${totalDisplayed}`);

  let animationIndex = 0;

  if (recentActiveMarkets.length > 0) {
    itemsContainer.appendChild(
      createNotificationSectionHeader("Active now", recentActiveMarkets.length)
    );
    recentActiveMarkets.forEach((marketData) => {
      const item = createNotificationItem(marketData, animationIndex, true);
      animationIndex++;
      itemsContainer.appendChild(item);
    });
  }

  if (recentScrolledMarkets.length > 0) {
    itemsContainer.appendChild(
      createNotificationSectionHeader(
        "Recently scrolled out",
        recentScrolledMarkets.length
      )
    );
    recentScrolledMarkets.forEach((marketData) => {
      const item = createNotificationItem(marketData, animationIndex, false);
      animationIndex++;
      itemsContainer.appendChild(item);
    });
  }

  // Trending section — always appended at the bottom when available.
  // Collect real market IDs so we can skip duplicates.
  const realMarketIds = new Set<string>();
  for (const entry of dedupedMarkets) {
    realMarketIds.add(entry.market.id);
  }
  appendTrendingSection(itemsContainer, realMarketIds, animationIndex);

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

/**
 * Initialize the notification stack
 */
function initNotificationStack(): void {
  const { log } = window.KNOWW_UTILS;

  if (!notificationStackContainer) {
    createNotificationStack();
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

    // ============================================
    // DRAGGABLE NOTIFICATION STACK (all platforms)
    // ============================================
    setupDraggable(log);
  }
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

  header.addEventListener("mousedown", (e: MouseEvent) => {
    if (!notificationStackContainer || e.button !== 0) return;

    // Don't drag if clicking on a button inside the header
    if ((e.target as Element).closest("button")) return;

    isDragging = true;
    dragOffsetX =
      e.clientX - notificationStackContainer.getBoundingClientRect().left;
    dragOffsetY =
      e.clientY - notificationStackContainer.getBoundingClientRect().top;

    notificationStackContainer.classList.add("knoww-dragging");
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e: MouseEvent) => {
    if (!isDragging || !notificationStackContainer) return;

    const newLeft = e.clientX - dragOffsetX;
    const newTop = e.clientY - dragOffsetY;

    // Clamp to viewport
    const rect = notificationStackContainer.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width;
    const maxTop = window.innerHeight - rect.height;

    // Use setProperty with 'important' to override the !important in CSS
    notificationStackContainer.style.setProperty(
      "left",
      `${Math.max(0, Math.min(newLeft, maxLeft))}px`,
      "important"
    );
    notificationStackContainer.style.setProperty(
      "top",
      `${Math.max(0, Math.min(newTop, maxTop))}px`,
      "important"
    );
    notificationStackContainer.style.setProperty("right", "auto", "important");

    e.preventDefault();
  });

  document.addEventListener("mouseup", () => {
    if (!isDragging || !notificationStackContainer) return;
    isDragging = false;
    notificationStackContainer.classList.remove("knoww-dragging");
  });

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
  scrollToMarket,
  initNotificationStack,
  fetchAndCacheTrending,
  cancelTrendingFetchTimer,
  SOURCE_CONFIG,
};

window.KNOWW_UI = KNOWW_UI;
