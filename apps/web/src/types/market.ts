/**
 * Market and Order Book types for Polymarket CLOB
 *
 * Core trading types are re-exported from @knoww/shared-types
 * to keep them in sync with the Chrome extension.
 */

import type {
  OrderTypeSelection,
  TradingSide,
} from "@knoww/shared-types/polymarket";

export type {
  OrderTypeSelection,
  TradingSide,
} from "@knoww/shared-types/polymarket";
export type {
  OrderBook,
  OrderBookLevel,
} from "@knoww/shared-types/slippage";

/**
 * Outcome data for the trading form
 */
export interface OutcomeData {
  name: string;
  tokenId: string;
  price: number; // Current price (0-1)
  probability: number; // Current probability (0-100)
}

/** A validated draft that may prefill the trading form but cannot submit it. */
export interface PreparedTradeTicket {
  revision: number;
  marketId: string;
  outcomeIndex: number;
  side: TradingSide;
  orderType: OrderTypeSelection;
  amountUsd?: number;
  shares?: number;
  limitPrice?: number;
  allowPartialFill?: boolean;
}
