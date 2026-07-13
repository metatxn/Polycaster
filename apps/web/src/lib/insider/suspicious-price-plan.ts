import type { AccountLoaderInput } from "./archetypes/account-loader";
import { scoreTrade, type TradeContext } from "./detector";

export interface PriceIndependentTradeContext
  extends Omit<TradeContext, "accountLoader"> {
  accountLoader: Omit<AccountLoaderInput, "referencePrice">;
}

export interface SuspiciousPriceCandidate {
  assetId: string;
  context: PriceIndependentTradeContext;
}

function maximumContrarianReferencePrice(side: "BUY" | "SELL"): 0 | 1 {
  return side === "BUY" ? 0 : 1;
}

export function canMeetSuspicionThreshold(
  context: PriceIndependentTradeContext,
  minSuspicionScore: number
): boolean {
  const ensemble = scoreTrade({
    ...context,
    accountLoader: {
      ...context.accountLoader,
      referencePrice: maximumContrarianReferencePrice(
        context.accountLoader.tradeSide
      ),
    },
  });
  return ensemble.anyFired || ensemble.maxScore >= minSuspicionScore;
}

export function planSuspiciousPriceCandidates(
  candidates: readonly SuspiciousPriceCandidate[],
  minSuspicionScore: number
): string[] {
  const tokenIds = new Set<string>();
  for (const candidate of candidates) {
    if (canMeetSuspicionThreshold(candidate.context, minSuspicionScore)) {
      tokenIds.add(candidate.assetId);
    }
  }
  return [...tokenIds];
}
