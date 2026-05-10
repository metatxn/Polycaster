import { createLogger } from "@knoww/logger";
import { fetchClobJson } from "@knoww/shared-types/clob";
import Decimal from "decimal.js";
import type { AgentEvidencePack, AgentWatchlistItem } from "./types.ts";

const log = createLogger("agent.evidence");

const NEWS_TIMEOUT_MS = 5000;
const MAX_NEWS_BYTES = 80_000;

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

async function fetchNewsUrl(
  url: string
): Promise<AgentEvidencePack["news"][number] | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NEWS_TIMEOUT_MS);
  const fetchedAt = new Date().toISOString();
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "text/html,text/plain;q=0.9,*/*;q=0.7",
        "User-Agent": "KnowwPaperAgent/1.0",
      },
    });
    if (!response.ok) return null;
    const text = (await response.text()).slice(0, MAX_NEWS_BYTES);
    return {
      url,
      title: extractTitle(text) || url,
      excerpt: stripHtml(text).slice(0, 1000),
      fetchedAt,
    };
  } catch (error) {
    log.error("news.fetch.failed", { url, error });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function buildEvidencePack(
  item: AgentWatchlistItem
): Promise<AgentEvidencePack> {
  const [orderBook, news] = await Promise.all([
    fetchOrderBook(item.tokenId).catch((error) => {
      log.error("orderbook.fetch.failed", { tokenId: item.tokenId, error });
      return null;
    }),
    Promise.all(item.newsUrls.slice(0, 5).map(fetchNewsUrl)),
  ]);

  const bids = readLevels(orderBook, "bid");
  const asks = readLevels(orderBook, "ask");
  const bestBid = bestPrice(bids, "bid");
  const bestAsk = bestPrice(asks, "ask");
  const midPrice = midpoint(bestBid, bestAsk);
  const liquidityUsd = estimateLiquidityUsd([...bids, ...asks]);
  const price = midPrice ?? "0.5";

  return {
    watchlistItem: item,
    capturedAt: new Date().toISOString(),
    market: {
      question: item.question,
      tokenId: item.tokenId,
      conditionId: item.conditionId,
      marketSlug: item.marketSlug,
      outcomeLabel: item.outcomeLabel,
      eventStartTime: item.eventStartTime,
      eventEndTime: item.eventEndTime,
      resolutionSource: item.resolutionSource,
      price,
      bestBid,
      bestAsk,
      midPrice,
      liquidityUsd,
      stale: !orderBook || (!bestBid && !bestAsk),
      raw: orderBook,
    },
    news: news.filter((entry): entry is NonNullable<typeof entry> => !!entry),
    social: item.socialNotes.slice(0, 10).map((text) => ({
      source: "watchlist-note",
      text,
    })),
  };
}
