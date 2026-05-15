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
  /** Kickoff/start time for sports events, ISO string */
  startTime?: string;
  markets?: GammaMarket[];
  tags?: (GammaTag | string)[];
  /** Sports event teams (length 2 for team-vs-team games) */
  teams?: GammaTeam[];
  /** Numeric parent event id when this event is a child (e.g. negRisk linked) */
  parentEventId?: number | string;
}

/** Sports team metadata from Gamma `event.teams` */
export interface GammaTeam {
  id?: number | string;
  name: string;
  abbreviation?: string;
  alias?: string;
  logo?: string;
  color?: string;
  league?: string;
  record?: string;
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
  sportsMarketType?: string;
  negRisk?: boolean;
  negRiskMarketID?: string;
  /** Set when fanned out from a parent event so the UI can group/title rows. */
  parentEventId?: number | string;
  parentEventTitle?: string;
  /** Long-form rules text shown in the per-market About panel. */
  description?: string;
  /** Resolution deadline for this specific market (ISO). */
  endDate?: string;
  /** ISO timestamp the market opened — labeled "Market Opened" on Polymarket. */
  createdAt?: string;
  /** Public URL of the canonical resolution source (e.g. ESPN cricinfo). */
  resolutionSource?: string;
  /** On-chain resolver address; rendered as a Polygonscan link. */
  resolvedBy?: string;
  /** UMA status for markets whose result is under dispute/resolution. */
  umaResolutionStatus?: string;
  /** Gamma returns this as a stringified array in list/keyset payloads. */
  umaResolutionStatuses?: string;
}

/**
 * Raw tag data from Gamma API
 */
export interface GammaTag {
  id?: string;
  slug?: string;
  label?: string;
}
