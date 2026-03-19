/**
 * Type definitions for Polymarket Gamma API responses
 * Used for data transformation in API routes
 */

/**
 * Raw event data from Gamma API
 */
export interface GammaEvent {
  id: string;
  slug: string;
  title: string;
  description?: string;
  image?: string;
  volume?: string;
  volume24hr?: number | string;
  volume1wk?: number | string;
  volume1mo?: number | string;
  volume1yr?: number | string;
  liquidity?: number | string;
  liquidityClob?: number | string;
  active?: boolean;
  closed?: boolean;
  live?: boolean;
  ended?: boolean;
  competitive?: number;
  enableNegRisk?: boolean;
  negRiskAugmented?: boolean;
  score?: string;
  startDate?: string;
  endDate?: string;
  markets?: GammaMarket[];
  tags?: (GammaTag | string)[];
}

/**
 * Raw market data from Gamma API
 */
export interface GammaMarket {
  id: string;
  question?: string;
  slug?: string;
  outcomes?: string;
  outcomePrices?: string;
  groupItemTitle?: string;
  image?: string;
  icon?: string;
  clobTokenIds?: string;
  conditionId?: string;
  gameStartTime?: string;
}

/**
 * Raw tag data from Gamma API
 */
export interface GammaTag {
  id?: string;
  slug?: string;
  label?: string;
}

/**
 * Pagination info from Gamma API
 */
export interface GammaPagination {
  hasMore: boolean;
  totalResults: number;
}

/**
 * Full response from Gamma API events endpoint
 */
export interface GammaEventsResponse {
  data: GammaEvent[];
  pagination: GammaPagination;
}
