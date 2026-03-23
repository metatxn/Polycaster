import type { OrderBookLevel } from "./market";

/**
 * WebSocket event types from Polymarket Market Channel
 * @see https://docs.polymarket.com/developers/CLOB/websocket/market-channel
 */
export type WebSocketEventType =
  | "book"
  | "price_change"
  | "last_trade_price"
  | "tick_size_change";

/**
 * Full order book snapshot event
 * Emitted on subscribe and after trades
 */
export interface BookEvent {
  event_type: "book";
  asset_id: string;
  market: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: string;
  hash: string;
}

/**
 * Price change entry for incremental updates
 */
export interface PriceChange {
  asset_id: string;
  price: string;
  size: string;
  side: "BUY" | "SELL";
  hash: string;
  best_bid: string;
  best_ask: string;
}

/**
 * Price change event (incremental update)
 * Emitted when orders are placed or cancelled
 */
export interface PriceChangeEvent {
  event_type: "price_change";
  market: string;
  price_changes: PriceChange[];
  timestamp: string;
}

/**
 * Last trade price event
 * Emitted when a trade is executed
 */
export interface LastTradePriceEvent {
  event_type: "last_trade_price";
  asset_id: string;
  market: string;
  price: string;
  size: string;
  side: "BUY" | "SELL";
  fee_rate_bps: string;
  timestamp: string;
}

/**
 * Tick size change event
 * Emitted when market tick size changes (price > 0.96 or < 0.04)
 */
export interface TickSizeChangeEvent {
  event_type: "tick_size_change";
  asset_id: string;
  market: string;
  old_tick_size: string;
  new_tick_size: string;
  side: string;
  timestamp: string;
}

/**
 * Union type for all WebSocket events
 */
export type WebSocketEvent =
  | BookEvent
  | PriceChangeEvent
  | LastTradePriceEvent
  | TickSizeChangeEvent;

/**
 * WebSocket connection state
 */
export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";
