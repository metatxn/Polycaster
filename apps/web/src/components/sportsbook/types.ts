import type { LiveGameState } from "@/hooks/use-sports-websocket";

// Re-export LiveGameState so other sportsbook modules can import from one place
export type { LiveGameState };

// ── Types ──────────────────────────────────────────────────────────

export interface EventMarket {
  id: string;
  question?: string;
  outcomes?: string;
  outcomePrices?: string;
  groupItemTitle?: string;
  image?: string;
  icon?: string;
  clobTokenIds?: string[];
  conditionId?: string;
  gameStartTime?: string;
  sportsMarketType?: string;
  parentEventId?: string | number;
  parentEventTitle?: string;
  negRisk?: boolean;
  enableNegRisk?: boolean;
  negRiskAugmented?: boolean;
  neg_risk?: boolean | string | number;
  enable_neg_risk?: boolean | string | number;
}

export interface LiveEvent {
  id: string;
  slug?: string;
  title: string;
  image?: string;
  volume?: string;
  volume24hr?: number | string;
  score?: string;
  live?: boolean;
  startDate?: string;
  startTime?: string;
  negRisk?: boolean;
  enableNegRisk?: boolean;
  negRiskAugmented?: boolean;
  neg_risk?: boolean | string | number;
  enable_neg_risk?: boolean | string | number;
  markets?: EventMarket[];
  tags?: Array<string | { id?: string; slug?: string; label?: string }>;
}

export interface ParsedBettingLine {
  outcomes: string[];
  prices: number[];
  label?: string;
  market: EventMarket;
  /** Maps display index to original market outcome index (e.g. [1,0] if swapped) */
  idx?: number[];
}

export interface MoneylineChoice {
  line: ParsedBettingLine;
  outcomeIndex: number;
  price: number;
}

export interface MoneylineDisplayData {
  teamNames: [string, string];
  home: MoneylineChoice | null;
  away: MoneylineChoice | null;
  draw: MoneylineChoice | null;
  primaryLine: ParsedBettingLine | null;
}

export interface SelectedMarketInfo {
  marketId: string;
  eventId: string;
  eventSlug?: string;
  eventTitle: string;
  marketTitle: string;
  marketImage?: string;
  outcomes: Array<{
    name: string;
    tokenId: string;
    price: number;
    probability: number;
  }>;
  conditionId?: string;
  negRisk?: boolean;
}
