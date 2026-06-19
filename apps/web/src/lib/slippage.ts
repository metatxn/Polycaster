/**
 * Re-export slippage utilities from the shared package.
 *
 * The canonical implementation now lives in @knoww/shared-types/slippage
 * so both the web app and the Chrome extension use the same code.
 */
export {
  calculateBuySlippage,
  calculateBuySlippageForAmount,
  calculateMarketOrderPrice,
  calculateSellSlippage,
  calculateSlippage,
  formatSlippageDisplay,
  type MarketOrderPriceResult,
  type OrderBook,
  type OrderBookLevel,
  roundDownToTick,
  roundToTick,
  roundUpToTick,
  type SlippageResult,
} from "@knoww/shared-types/slippage";
