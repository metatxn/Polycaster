import { useEffect, useRef } from "react";
import type { TimeRange } from "@/components/market-price-chart";
import { registerWebMcpTools } from "@/lib/webmcp";
import type { PreparedTradeTicket } from "@/types/market";
import {
  createEventWebMcpTools,
  type EventWebMcpSnapshot,
} from "./event-webmcp";

interface UseEventWebMcpOptions {
  snapshot: EventWebMcpSnapshot | null;
  selectMarket: (marketId: string, outcomeIndex: number) => void;
  setChartRange: (range: TimeRange) => void;
  prepareTrade: (draft: PreparedTradeTicket) => void;
}

/** Keeps one page-level WebMCP registration wired to the latest React state. */
export function useEventWebMcp(options: UseEventWebMcpOptions): void {
  const latestRef = useRef(options);

  useEffect(() => {
    latestRef.current = options;
  }, [options]);

  useEffect(() => {
    const tools = createEventWebMcpTools({
      getSnapshot: () => latestRef.current.snapshot,
      selectMarket: (marketId, outcomeIndex) =>
        latestRef.current.selectMarket(marketId, outcomeIndex),
      setChartRange: (range) => latestRef.current.setChartRange(range),
      prepareTrade: (draft) => latestRef.current.prepareTrade(draft),
    });

    return registerWebMcpTools(tools);
  }, []);
}
