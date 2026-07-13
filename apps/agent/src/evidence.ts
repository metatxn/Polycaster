import { createLogger } from "@knoww/logger";
import {
  type ClobPriceHistoryPoint,
  fetchClobJson,
  fetchClobPriceHistory,
} from "@knoww/shared-types/clob";
import Decimal from "decimal.js";
import { collectSearchEvidenceWithDiagnostics } from "./search-tools.ts";
import type {
  AgentEventType,
  AgentEvidencePack,
  AgentMarketType,
  AgentWatchlistItem,
} from "./types.ts";

const log = createLogger("agent.evidence");

const NEWS_TIMEOUT_MS = 5000;
const MAX_NEWS_BYTES = 80_000;
const MAX_NEWS_REDIRECTS = 3;
const NEWS_TEXT_CONTENT_TYPES = new Set([
  "application/xhtml+xml",
  "text/html",
  "text/plain",
]);
// Keep this deliberately narrower than a generic "public internet" policy.
// These hosts are the established editorial/market sources already supported
// by the product. Additions should be reviewed as outbound network access.
const AGENT_NEWS_HOSTS = new Set([
  "9to5google.com",
  "9to5mac.com",
  "aljazeera.com",
  "apnews.com",
  "arstechnica.com",
  "axios.com",
  "bankless.com",
  "bbc.com",
  "beincrypto.com",
  "bitcoinmagazine.com",
  "blockworks.com",
  "bloomberg.com",
  "cbssports.com",
  "cnbc.com",
  "cnet.com",
  "cnn.com",
  "coindesk.com",
  "cointelegraph.com",
  "cryptopanic.com",
  "decrypt.co",
  "defillama.com",
  "dlnews.com",
  "edition.cnn.com",
  "engadget.com",
  "espn.com",
  "espn.in",
  "espncricinfo.com",
  "finance.yahoo.com",
  "forbes.com",
  "foxsports.com",
  "ft.com",
  "gizmodo.com",
  "hindustantimes.com",
  "indianexpress.com",
  "investing.com",
  "kalshi.com",
  "macrumors.com",
  "manifold.markets",
  "marketwatch.com",
  "metaculus.com",
  "nytimes.com",
  "politico.com",
  "reuters.com",
  "seekingalpha.com",
  "skysports.com",
  "sportingnews.com",
  "techcrunch.com",
  "theatlantic.com",
  "theblock.co",
  "theguardian.com",
  "thehindu.com",
  "theverge.com",
  "time.com",
  "timesofindialive.com",
  "tomshardware.com",
  "tradingview.com",
  "unchainedcrypto.com",
  "usatoday.com",
  "washingtonpost.com",
  "wired.com",
  "wsj.com",
  "zdnet.com",
  "zerohedge.com",
]);
const GAMMA_EVENT_BY_SLUG_BASE = "https://gamma-api.polymarket.com/events/slug";
const GAMMA_TIMEOUT_MS = 4000;
const MAX_DESCRIPTION_CHARS = 2000;
const PRICE_HISTORY_LOOKBACK_SECONDS = 24 * 60 * 60;
const PRICE_HISTORY_FIDELITY_MINUTES = 5;
const THIN_BOOK_USD = new Decimal(20);
const BOOK_IMBALANCE_HEAVY_THRESHOLD = new Decimal("0.2");
const VOLATILE_RANGE_THRESHOLD = new Decimal("0.15");
const FLAT_CHANGE_THRESHOLD = new Decimal("0.01");

function getClobHost(): string {
  return (
    process.env.POLYMARKET_HOST ||
    process.env.NEXT_PUBLIC_POLYMARKET_HOST ||
    "https://clob.polymarket.com"
  );
}

async function fetchOrderBook(tokenId: string): Promise<unknown> {
  return fetchClobJson("book", { token_id: tokenId }, { host: getClobHost() });
}

async function fetchPriceHistory(
  tokenId: string,
  nowSec = Math.floor(Date.now() / 1000)
): Promise<ClobPriceHistoryPoint[]> {
  try {
    const data = await fetchClobPriceHistory(
      tokenId,
      {
        startTs: nowSec - PRICE_HISTORY_LOOKBACK_SECONDS,
        endTs: nowSec,
        fidelity: PRICE_HISTORY_FIDELITY_MINUTES,
      },
      { host: getClobHost(), fetchImpl: globalThis.fetch }
    );
    return Array.isArray(data.history) ? data.history : [];
  } catch (error) {
    log.error("price_history.fetch.failed", { tokenId, error });
    return [];
  }
}

interface OrderLevel {
  price?: string | number;
  size?: string | number;
}

interface OrderBookLike {
  bids?: OrderLevel[];
  asks?: OrderLevel[];
  buys?: OrderLevel[];
  sells?: OrderLevel[];
}

function readLevels(book: unknown, side: "bid" | "ask"): OrderLevel[] {
  if (!book || typeof book !== "object") return [];
  const value = book as OrderBookLike;
  const direct = side === "bid" ? value.bids : value.asks;
  const polymarket = side === "bid" ? value.buys : value.sells;
  return Array.isArray(direct)
    ? direct
    : Array.isArray(polymarket)
      ? polymarket
      : [];
}

function bestPrice(levels: OrderLevel[], side: "bid" | "ask"): string | null {
  const prices = levels
    .map((level) => new Decimal(level.price ?? "0"))
    .filter((price) => price.gt(0));
  if (prices.length === 0) return null;
  const best = side === "bid" ? Decimal.max(...prices) : Decimal.min(...prices);
  return best.toDecimalPlaces(6).toString();
}

function estimateLiquidityUsd(levels: OrderLevel[]): string {
  const total = levels.reduce((sum, level) => {
    const price = new Decimal(level.price ?? "0");
    const size = new Decimal(level.size ?? "0");
    if (price.lte(0) || size.lte(0)) return sum;
    return sum.add(price.mul(size));
  }, new Decimal(0));
  return total.toDecimalPlaces(6).toString();
}

function midpoint(
  bestBid: string | null,
  bestAsk: string | null
): string | null {
  if (!bestBid || !bestAsk) return null;
  return new Decimal(bestBid).add(bestAsk).div(2).toDecimalPlaces(6).toString();
}

function decimalString(value: Decimal): string {
  return value.toDecimalPlaces(6).toString();
}

function spread(bestBid: string | null, bestAsk: string | null): string | null {
  if (!bestBid || !bestAsk) return null;
  const value = new Decimal(bestAsk).sub(bestBid);
  if (value.lt(0)) return null;
  return decimalString(value);
}

function spreadPct(
  spreadValue: string | null,
  midPrice: string | null
): string | null {
  if (!spreadValue || !midPrice) return null;
  const mid = new Decimal(midPrice);
  if (mid.lte(0)) return null;
  return decimalString(new Decimal(spreadValue).div(mid).mul(100));
}

function levelNotional(level: OrderLevel): Decimal {
  const price = new Decimal(level.price ?? "0");
  const size = new Decimal(level.size ?? "0");
  if (price.lte(0) || size.lte(0)) return new Decimal(0);
  return price.mul(size);
}

function topDepthUsd(levels: OrderLevel[], side: "bid" | "ask"): Decimal {
  const sorted = [...levels].sort((a, b) => {
    const left = new Decimal(a.price ?? "0");
    const right = new Decimal(b.price ?? "0");
    return side === "bid" ? right.cmp(left) : left.cmp(right);
  });
  return sorted
    .slice(0, 5)
    .reduce((sum, level) => sum.add(levelNotional(level)), new Decimal(0));
}

function summarizeOrderBook(
  bids: OrderLevel[],
  asks: OrderLevel[]
): AgentEvidencePack["market"]["orderBook"] {
  const bidDepth = topDepthUsd(bids, "bid");
  const askDepth = topDepthUsd(asks, "ask");
  const totalDepth = bidDepth.add(askDepth);
  const thin = totalDepth.lt(THIN_BOOK_USD);
  const imbalance = totalDepth.gt(0)
    ? bidDepth.sub(askDepth).div(totalDepth)
    : new Decimal(0);
  const bookPressure = thin
    ? "thin"
    : imbalance.gte(BOOK_IMBALANCE_HEAVY_THRESHOLD)
      ? "bid-heavy"
      : imbalance.lte(BOOK_IMBALANCE_HEAVY_THRESHOLD.neg())
        ? "ask-heavy"
        : "balanced";

  return {
    bidDepthUsdTop5: decimalString(bidDepth),
    askDepthUsdTop5: decimalString(askDepth),
    bidAskImbalanceTop5: decimalString(imbalance),
    bookPressure,
    thin,
  };
}

function priceAtOrBefore(
  history: ClobPriceHistoryPoint[],
  timestampSec: number
): ClobPriceHistoryPoint | null {
  const sorted = history
    .filter(
      (point) =>
        Number.isFinite(point.t) &&
        Number.isFinite(point.p) &&
        point.p >= 0 &&
        point.p <= 1
    )
    .sort((a, b) => a.t - b.t);
  if (sorted.length === 0 || timestampSec < sorted[0].t) return null;
  let match = sorted[0];
  for (const point of sorted) {
    if (point.t > timestampSec) break;
    match = point;
  }
  return match;
}

function summarizePriceMovement(
  currentPrice: string,
  history: ClobPriceHistoryPoint[],
  nowSec = Math.floor(Date.now() / 1000)
): AgentEvidencePack["market"]["priceMovement"] {
  const sorted = history
    .filter(
      (point) =>
        Number.isFinite(point.t) &&
        Number.isFinite(point.p) &&
        point.p >= 0 &&
        point.p <= 1
    )
    .sort((a, b) => a.t - b.t);
  const current = new Decimal(currentPrice);
  const last = sorted.at(-1) ?? null;
  const prices = sorted.map((point) => new Decimal(point.p));
  const recentHigh = prices.length ? Decimal.max(...prices) : null;
  const recentLow = prices.length ? Decimal.min(...prices) : null;
  const changeFrom = (secondsAgo: number): string | null => {
    const point = priceAtOrBefore(sorted, nowSec - secondsAgo);
    if (!point) return null;
    return decimalString(current.sub(point.p));
  };
  const priceChange5m = changeFrom(5 * 60);
  const priceChange1h = changeFrom(60 * 60);
  const priceChange24h = changeFrom(24 * 60 * 60);
  const range =
    recentHigh && recentLow ? recentHigh.sub(recentLow).abs() : new Decimal(0);
  const referenceChange = priceChange1h ?? priceChange24h ?? priceChange5m;
  const trend =
    sorted.length === 0
      ? "unknown"
      : range.gte(VOLATILE_RANGE_THRESHOLD)
        ? "volatile"
        : !referenceChange ||
            new Decimal(referenceChange).abs().lte(FLAT_CHANGE_THRESHOLD)
          ? "flat"
          : new Decimal(referenceChange).gt(0)
            ? "up"
            : "down";

  return {
    currentPrice: currentPrice,
    lastTradePrice: last ? decimalString(new Decimal(last.p)) : null,
    lastTradeAt: last ? new Date(last.t * 1000).toISOString() : null,
    recentHigh: recentHigh ? decimalString(recentHigh) : null,
    recentLow: recentLow ? decimalString(recentLow) : null,
    priceChange5m,
    priceChange1h,
    priceChange24h,
    trend,
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>(.*?)<\/title>/i);
  return stripHtml(match?.[1] ?? "").slice(0, 160);
}

function allowedAgentNewsUrl(value: string | URL): URL | null {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (url.port && url.port !== "443") return null;
    const normalizedHost = hostname.startsWith("www.")
      ? hostname.slice("www.".length)
      : hostname;
    return AGENT_NEWS_HOSTS.has(hostname) ||
      AGENT_NEWS_HOSTS.has(normalizedHost)
      ? url
      : null;
  } catch {
    return null;
  }
}

export function isAllowedAgentNewsUrl(value: string): boolean {
  return allowedAgentNewsUrl(value) !== null;
}

function isRedirectResponse(response: Response): boolean {
  return [301, 302, 303, 307, 308].includes(response.status);
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cancellation is best-effort; the shared abort signal is the backstop.
  }
}

function declaredBodyTooLarge(response: Response): boolean {
  const rawLength = response.headers.get("content-length")?.trim();
  if (!rawLength || !/^\d+$/.test(rawLength)) return false;
  try {
    return BigInt(rawLength) > BigInt(MAX_NEWS_BYTES);
  } catch {
    return true;
  }
}

function hasAllowedTextContentType(response: Response): boolean {
  const mediaType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  return mediaType ? NEWS_TEXT_CONTENT_TYPES.has(mediaType) : false;
}

async function readBoundedNewsText(
  response: Response,
  controller: AbortController
): Promise<string | null> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let byteCount = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteCount += value.byteLength;
      if (byteCount > MAX_NEWS_BYTES) {
        controller.abort();
        await reader.cancel();
        return null;
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // The stream may already have been cancelled by the abort signal.
    }
    throw error;
  }
}

export async function fetchAgentNewsUrl(
  rawUrl: string
): Promise<AgentEvidencePack["news"][number] | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NEWS_TIMEOUT_MS);
  const fetchedAt = new Date().toISOString();
  try {
    let currentUrl = allowedAgentNewsUrl(rawUrl);
    if (!currentUrl) return null;

    for (let redirectCount = 0; ; redirectCount += 1) {
      const response = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          Accept: "text/html,text/plain;q=0.9",
          "User-Agent": "KnowwPaperAgent/1.0",
        },
      });

      if (isRedirectResponse(response)) {
        const location = response.headers.get("location");
        await cancelBody(response);
        if (!location || redirectCount >= MAX_NEWS_REDIRECTS) return null;
        currentUrl = allowedAgentNewsUrl(new URL(location, currentUrl));
        if (!currentUrl) return null;
        continue;
      }

      if (!response.ok) {
        await cancelBody(response);
        return null;
      }
      if (
        declaredBodyTooLarge(response) ||
        !hasAllowedTextContentType(response)
      ) {
        controller.abort();
        await cancelBody(response);
        return null;
      }

      const text = await readBoundedNewsText(response, controller);
      if (text === null) return null;
      const finalUrl = currentUrl.toString();
      return {
        url: finalUrl,
        title: extractTitle(text) || finalUrl,
        excerpt: stripHtml(text).slice(0, 1000),
        fetchedAt,
      };
    }
  } catch (error) {
    // Do not log the raw URL: rejected credential-bearing URLs must not leak
    // userinfo into logs.
    log.error("news.fetch.failed", { error });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

interface GammaDescription {
  /** The event-level description (typically the resolution rule). */
  event: string | null;
  /** The market-level description, if it differs from the event one. */
  market: string | null;
  /** Top candidate markets/outcomes from the same Gamma event. */
  relatedMarkets: AgentEvidencePack["relatedMarkets"];
}

function gammaStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseGammaStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function classifyGammaMarketType(outcomes: string[]): AgentMarketType {
  const normalized = outcomes.map((outcome) => outcome.trim().toLowerCase());
  return normalized.length === 2 &&
    normalized.includes("yes") &&
    normalized.includes("no")
    ? "binary"
    : normalized.length > 0
      ? "multi_outcome"
      : "unknown";
}

function classifyGammaEventType(markets: unknown[]): AgentEventType {
  return markets.length > 1
    ? "multi_market"
    : markets.length === 1
      ? "single_market"
      : "unknown";
}

function gammaBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function gammaPriceScore(price: string | null): Decimal {
  try {
    return new Decimal(price ?? "0");
  } catch {
    return new Decimal(0);
  }
}

const DEADLINE_PATTERN = /\bby\s+([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})\b/;

const MONTH_INDEX: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

function deadlineFromQuestion(question: string): string | null {
  const match = question.match(DEADLINE_PATTERN);
  if (!match) return null;
  const month = MONTH_INDEX[match[1].toLowerCase()];
  const day = Number.parseInt(match[2], 10);
  const year = Number.parseInt(match[3], 10);
  if (month === undefined || !Number.isInteger(day) || day < 1 || day > 31) {
    return null;
  }
  return new Date(Date.UTC(year, month, day)).toISOString();
}

function gammaRelatedMarkets(
  event: Record<string, unknown>,
  item: AgentWatchlistItem
): AgentEvidencePack["relatedMarkets"] {
  const markets = Array.isArray(event.markets) ? event.markets : [];
  const eventType = classifyGammaEventType(markets);
  const candidates = markets.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const market = entry as Record<string, unknown>;
    const outcomes = parseGammaStringArray(market.outcomes);
    const tokenIds = parseGammaStringArray(market.clobTokenIds);
    const prices = parseGammaStringArray(market.outcomePrices);
    const marketType = classifyGammaMarketType(outcomes);
    return outcomes.flatMap((outcomeLabel, index) => {
      const tokenId = tokenIds[index];
      if (!tokenId) return [];
      const question =
        gammaStringValue(market.question) ??
        gammaStringValue(event.title) ??
        item.question;
      return [
        {
          question,
          tokenId,
          conditionId: gammaStringValue(market.conditionId),
          marketSlug: gammaStringValue(market.slug) ?? item.marketSlug,
          outcomeLabel,
          marketType,
          eventType,
          eventEndTime:
            deadlineFromQuestion(question) ??
            gammaStringValue(market.endDate) ??
            gammaStringValue(event.endDate),
          price: prices[index] ?? null,
          active:
            gammaBoolean(event.archived, false) !== true &&
            gammaBoolean(market.archived, false) !== true &&
            gammaBoolean(market.active, true) !== false &&
            gammaBoolean(market.closed, false) !== true &&
            gammaBoolean(market.acceptingOrders, true) !== false,
          selected: tokenId === item.tokenId,
        },
      ];
    });
  });

  const selected = candidates.find((candidate) => candidate.selected);
  const openCandidates = candidates.filter(
    (candidate) =>
      candidate.active && candidate.outcomeLabel.toLowerCase() !== "no"
  );
  const topCandidates = openCandidates
    .sort((a, b) => gammaPriceScore(b.price).cmp(gammaPriceScore(a.price)))
    .slice(0, 3);
  const related = selected
    ? [selected, ...topCandidates.filter((candidate) => !candidate.selected)]
    : topCandidates;
  return related.slice(0, 3);
}

async function fetchGammaDescription(
  marketSlug: string | undefined,
  item: AgentWatchlistItem
): Promise<GammaDescription> {
  if (!marketSlug) return { event: null, market: null, relatedMarkets: [] };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GAMMA_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${GAMMA_EVENT_BY_SLUG_BASE}/${encodeURIComponent(marketSlug)}`,
      { signal: controller.signal }
    );
    if (!response.ok) return { event: null, market: null, relatedMarkets: [] };
    const data = (await response.json()) as Record<string, unknown>;
    const eventDescription = gammaStringValue(data.description);
    const markets = Array.isArray(data.markets) ? data.markets : [];
    const firstMarket = markets[0] as Record<string, unknown> | undefined;
    const marketDescription = gammaStringValue(firstMarket?.description);
    return {
      event: eventDescription
        ? eventDescription.slice(0, MAX_DESCRIPTION_CHARS)
        : null,
      market:
        marketDescription && marketDescription !== eventDescription
          ? marketDescription.slice(0, MAX_DESCRIPTION_CHARS)
          : null,
      relatedMarkets: gammaRelatedMarkets(data, item),
    };
  } catch (error) {
    log.error("gamma.description.fetch.failed", { marketSlug, error });
    return { event: null, market: null, relatedMarkets: [] };
  } finally {
    clearTimeout(timeout);
  }
}

export async function buildEvidencePack(
  item: AgentWatchlistItem
): Promise<AgentEvidencePack> {
  const [orderBook, priceHistory, news, gamma, searchCollection] =
    await Promise.all([
      fetchOrderBook(item.tokenId).catch((error) => {
        log.error("orderbook.fetch.failed", { tokenId: item.tokenId, error });
        return null;
      }),
      fetchPriceHistory(item.tokenId),
      Promise.all(item.newsUrls.slice(0, 5).map(fetchAgentNewsUrl)),
      fetchGammaDescription(item.marketSlug, item),
      collectSearchEvidenceWithDiagnostics(item),
    ]);

  const bids = readLevels(orderBook, "bid");
  const asks = readLevels(orderBook, "ask");
  const bestBid = bestPrice(bids, "bid");
  const bestAsk = bestPrice(asks, "ask");
  const midPrice = midpoint(bestBid, bestAsk);
  const liquidityUsd = estimateLiquidityUsd([...bids, ...asks]);
  const price = midPrice ?? "0.5";
  const spreadValue = spread(bestBid, bestAsk);

  return {
    watchlistItem: item,
    capturedAt: new Date().toISOString(),
    market: {
      question: item.question,
      tokenId: item.tokenId,
      conditionId: item.conditionId,
      marketSlug: item.marketSlug,
      outcomeLabel: item.outcomeLabel,
      marketType: item.marketType,
      eventType: item.eventType,
      outcomes: item.outcomes,
      oppositeOutcomeLabel: item.oppositeOutcomeLabel,
      oppositeTokenId: item.oppositeTokenId,
      eventMarketCount: item.eventMarketCount,
      eventStartTime: item.eventStartTime,
      eventEndTime: item.eventEndTime,
      resolutionSource: item.resolutionSource,
      price,
      bestBid,
      bestAsk,
      midPrice,
      spread: spreadValue,
      spreadPct: spreadPct(spreadValue, midPrice),
      liquidityUsd,
      stale: !orderBook || (!bestBid && !bestAsk),
      orderBook: summarizeOrderBook(bids, asks),
      priceMovement: summarizePriceMovement(price, priceHistory),
      raw: orderBook,
    },
    news: news.filter((entry): entry is NonNullable<typeof entry> => !!entry),
    relatedMarkets: gamma.relatedMarkets,
    search: searchCollection.results,
    searchDiagnostics: searchCollection.diagnostics,
    // Polymarket-native context first so models read the resolution rule
    // before any user-supplied notes.
    social: [
      ...(gamma.event
        ? [{ source: "polymarket-rule" as const, text: gamma.event }]
        : []),
      ...(gamma.market
        ? [{ source: "polymarket-description" as const, text: gamma.market }]
        : []),
      ...item.socialNotes
        .slice(0, 10)
        .map((text) => ({ source: "watchlist-note" as const, text })),
    ],
  };
}
