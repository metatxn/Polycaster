import Decimal from "decimal.js";

export interface TradingOutcomeQuote {
  lastTradePrice?: number | null;
  midpoint?: number | null;
  bestBid?: number | null;
  bestAsk?: number | null;
}

export interface TradingOutcomeLike {
  name: string;
  tokenId: string;
  price: number;
  probability: number;
}

function normalizePrice(price: number | null | undefined): number | null {
  if (price === null || price === undefined || !Number.isFinite(price)) {
    return null;
  }

  return Math.max(0, Math.min(1, price));
}

export function getLiveTradingOutcomePrice(
  quote: TradingOutcomeQuote | undefined
): number | null {
  if (!quote) return null;

  const livePrice =
    normalizePrice(quote.bestAsk) ??
    normalizePrice(quote.midpoint) ??
    normalizePrice(quote.lastTradePrice) ??
    normalizePrice(quote.bestBid);

  return livePrice;
}

export function applyLiveTradingOutcomeQuotes<T extends TradingOutcomeLike>(
  outcomes: readonly T[],
  quotesByTokenId: ReadonlyMap<string, TradingOutcomeQuote>
): T[] {
  return outcomes.map((outcome) => {
    const livePrice = getLiveTradingOutcomePrice(
      quotesByTokenId.get(outcome.tokenId)
    );

    if (livePrice === null) {
      return outcome;
    }

    return {
      ...outcome,
      price: livePrice,
      probability: new Decimal(livePrice).mul(100).round().toNumber(),
    };
  });
}
