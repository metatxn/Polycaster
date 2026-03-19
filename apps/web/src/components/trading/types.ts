import type { OrderBook, OutcomeData, TradingSide } from "@/types/market";

/**
 * Props for the TradingForm component
 */
export interface TradingFormProps {
  /** Market question/title */
  marketTitle: string;
  /** Token ID for the selected outcome */
  tokenId: string;
  /** Available outcomes for this market */
  outcomes: OutcomeData[];
  /** Currently selected outcome index */
  selectedOutcomeIndex: number;
  /** Callback when outcome selection changes */
  onOutcomeChange: (index: number) => void;
  /** Whether this is a negative risk market */
  negRisk?: boolean;
  /** User's USDC balance (optional) */
  userBalance?: number;
  /** Market tick size (default: 0.01) */
  tickSize?: number;
  /** Market minimum order size in shares (default: 1) */
  minOrderSize?: number;
  /** Best bid price from order book (for spread warning) */
  bestBid?: number;
  /** Best ask price from order book (for spread warning) */
  bestAsk?: number;
  /** Full order book for slippage calculation */
  orderBook?: OrderBook;
  /** Max slippage percentage for market orders (default: 2 = 2%) */
  maxSlippagePercent?: number;
  /** Callback after successful order submission */
  onOrderSuccess?: (order: unknown) => void;
  /** Callback after order error */
  onOrderError?: (error: Error) => void;
  /** Market image URL for header */
  marketImage?: string;
  /** Yes probability for header display */
  yesProbability?: number;
  /** Whether order book data is from live WebSocket */
  isLiveData?: boolean;
  /** Initial side for the trading form (BUY or SELL) */
  initialSide?: TradingSide;
  /** Initial number of shares */
  initialShares?: number;
  /** Condition ID for the market (required for split/merge) */
  conditionId?: string;
  /** Disable internal sticky wrapper when parent already handles sticky */
  disableSticky?: boolean;
}
