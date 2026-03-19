"use client";

import { useEffect, useMemo, useState } from "react";
import type { TradingSide } from "@/types/market";

interface PriceInputProps {
  price: number;
  onPriceChange: (price: number) => void;
  tickSize: number;
  bestBid?: number;
  bestAsk?: number;
  side: TradingSide;
}

export function PriceInput({
  price,
  onPriceChange,
  tickSize,
  bestBid,
  bestAsk,
  side,
}: PriceInputProps) {
  // Local state for the input value to allow free typing
  const [inputValue, setInputValue] = useState(() =>
    (price * 100).toFixed(tickSize < 0.01 ? 2 : 1)
  );
  const [isFocused, setIsFocused] = useState(false);

  // Sync input value with external price changes (but not while focused)
  useEffect(() => {
    if (!isFocused) {
      setInputValue((price * 100).toFixed(tickSize < 0.01 ? 2 : 1));
    }
  }, [price, tickSize, isFocused]);

  // Round price to nearest tick size
  const roundToTick = (value: number): number => {
    const rounded = Math.round(value / tickSize) * tickSize;
    return Math.max(0.01, Math.min(0.99, Number(rounded.toFixed(4))));
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Allow free typing - just update local state
    setInputValue(e.target.value);
  };

  const handleBlur = () => {
    setIsFocused(false);
    const val = Number.parseFloat(inputValue);
    if (!Number.isNaN(val) && val > 0) {
      // Convert cents to decimal and round to tick
      const priceDecimal = val / 100;
      const roundedPrice = roundToTick(priceDecimal);
      onPriceChange(roundedPrice);
      // Update input to show the rounded value
      setInputValue((roundedPrice * 100).toFixed(tickSize < 0.01 ? 2 : 1));
    } else {
      // Invalid input - reset to current price
      setInputValue((price * 100).toFixed(tickSize < 0.01 ? 2 : 1));
    }
  };

  const handleFocus = () => {
    setIsFocused(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.currentTarget.blur();
    }
  };

  const handleIncrement = (delta: number) => {
    const newPrice = price + delta * tickSize;
    const roundedPrice = roundToTick(newPrice);
    onPriceChange(roundedPrice);
    setInputValue((roundedPrice * 100).toFixed(tickSize < 0.01 ? 2 : 1));
  };

  // Determine order position relative to spread
  const orderPositionInfo = useMemo(() => {
    if (side === "BUY") {
      if (bestAsk !== undefined && price >= bestAsk) {
        return {
          label: "Crosses spread - will execute immediately",
          color: "text-emerald-500",
          bgColor: "bg-emerald-500/10",
        };
      }
      if (bestBid !== undefined && price > bestBid) {
        return {
          label: "Above best bid - near top of book",
          color: "text-blue-500",
          bgColor: "bg-blue-500/10",
        };
      }
      if (bestBid !== undefined && price === bestBid) {
        return {
          label: "At best bid - joins queue",
          color: "text-muted-foreground",
          bgColor: "bg-secondary/50",
        };
      }
      return {
        label: "Below best bid - deeper in book",
        color: "text-amber-500",
        bgColor: "bg-amber-500/10",
      };
    }
    // SELL side
    if (bestBid !== undefined && price <= bestBid) {
      return {
        label: "Crosses spread - will execute immediately",
        color: "text-emerald-500",
        bgColor: "bg-emerald-500/10",
      };
    }
    if (bestAsk !== undefined && price < bestAsk) {
      return {
        label: "Below best ask - near top of book",
        color: "text-blue-500",
        bgColor: "bg-blue-500/10",
      };
    }
    if (bestAsk !== undefined && price === bestAsk) {
      return {
        label: "At best ask - joins queue",
        color: "text-muted-foreground",
        bgColor: "bg-secondary/50",
      };
    }
    return {
      label: "Above best ask - deeper in book",
      color: "text-amber-500",
      bgColor: "bg-amber-500/10",
    };
  }, [side, price, bestBid, bestAsk]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-foreground">Limit Price</span>
        <div className="flex gap-2">
          {bestBid !== undefined && (
            <button
              type="button"
              className="text-[10px] text-emerald-600 dark:text-emerald-400 hover:opacity-80 font-medium"
              onClick={() => {
                onPriceChange(bestBid);
                setInputValue((bestBid * 100).toFixed(tickSize < 0.01 ? 2 : 1));
              }}
              title="Set price to best bid"
            >
              Bid: {(bestBid * 100).toFixed(1)}¢
            </button>
          )}
          {bestAsk !== undefined && (
            <button
              type="button"
              className="text-[10px] text-red-600 dark:text-red-400 hover:opacity-80 font-medium"
              onClick={() => {
                onPriceChange(bestAsk);
                setInputValue((bestAsk * 100).toFixed(tickSize < 0.01 ? 2 : 1));
              }}
              title="Set price to best ask"
            >
              Ask: {(bestAsk * 100).toFixed(1)}¢
            </button>
          )}
        </div>
      </div>

      <div className="flex items-stretch gap-1.5">
        <button
          type="button"
          className="px-3 py-2 text-sm font-medium text-muted-foreground rounded-lg border border-border hover:bg-secondary/50 hover:text-foreground transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => handleIncrement(-1)}
          disabled={price <= 0.01}
        >
          −
        </button>

        <div className="relative flex-1">
          <input
            type="number"
            value={inputValue}
            onChange={handleInputChange}
            onBlur={handleBlur}
            onFocus={handleFocus}
            onKeyDown={handleKeyDown}
            step={tickSize * 100}
            min={1}
            max={99}
            className="w-full bg-secondary/30 border border-border rounded-xl px-2 py-2.5 text-center text-base font-semibold font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 pr-8"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
            ¢
          </span>
        </div>

        <button
          type="button"
          className="px-3 py-2 text-sm font-medium text-muted-foreground rounded-lg border border-border hover:bg-secondary/50 hover:text-foreground transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => handleIncrement(1)}
          disabled={price >= 0.99}
        >
          +
        </button>
      </div>

      {/* Order Position Indicator */}
      {(bestBid !== undefined || bestAsk !== undefined) && (
        <div
          className={`px-2 py-1.5 rounded-lg text-[11px] ${orderPositionInfo.bgColor} ${orderPositionInfo.color}`}
        >
          {orderPositionInfo.label}
        </div>
      )}

      {/* Tick Size Info */}
      <div className="text-[10px] text-muted-foreground text-center">
        Tick size: {(tickSize * 100).toFixed(tickSize < 0.01 ? 2 : 1)}¢
      </div>
    </div>
  );
}
