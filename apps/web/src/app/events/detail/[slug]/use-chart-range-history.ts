"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { TimeRange } from "@/components/market-price-chart";
import { qk } from "@/lib/query-keys";
import {
  getChartRangePriceHistoryRequest,
  toDisplayPercentagePointChange,
} from "./chart-range";
import { fetchPriceHistoryBatch } from "./order-book-api";

interface SortedMarketEntry {
  yesTokenId: string;
  yesPrice: string;
}

/**
 * Fetches price-history for the outcome-table sparklines / range-change column
 * and derives per-token percentage-point changes for the selected time range.
 *
 * @param chartTimeRange  The currently selected chart time range.
 * @param restQuoteTokenIds  YES token IDs for the visible outcome rows (capped at MAX_MARKETS_WITH_REST_QUOTES).
 * @param earliestCreatedAt  ISO timestamp of the earliest market creation date — used for the ALL range start.
 * @param sortedMarketData  The sorted market rows (need yesTokenId + yesPrice to compute the change).
 * @returns chartRangeChangeByTokenId  Map from YES token ID → percentage-point change over the selected range.
 */
export function useChartRangeHistory(
  chartTimeRange: TimeRange,
  restQuoteTokenIds: readonly string[],
  earliestCreatedAt: string | undefined,
  sortedMarketData: SortedMarketEntry[]
): {
  chartRangeChangeByTokenId: Map<string, number>;
} {
  const chartRangeHistoryRequest = useMemo(
    () => getChartRangePriceHistoryRequest(chartTimeRange, earliestCreatedAt),
    [chartTimeRange, earliestCreatedAt]
  );

  const { data: chartRangePriceHistories } = useQuery({
    queryKey: qk.market.outcomeTablePriceHistory(
      chartTimeRange,
      restQuoteTokenIds,
      chartRangeHistoryRequest.startTs,
      chartRangeHistoryRequest.fidelity
    ),
    queryFn: () =>
      fetchPriceHistoryBatch(
        restQuoteTokenIds,
        chartRangeHistoryRequest.startTs,
        chartRangeHistoryRequest.fidelity
      ),
    enabled: restQuoteTokenIds.length > 0,
    // Partial batches (server timed out on some tokens) go immediately
    // stale AND actively re-poll — stale alone never triggers a refetch
    // while the component stays mounted, so without the interval the
    // missing sparklines would stay empty until a remount. The interval
    // switches off as soon as a complete response lands.
    staleTime: (query) => (query.state.data?.partial ? 0 : 60_000),
    refetchInterval: (query) => (query.state.data?.partial ? 30_000 : false),
    refetchOnWindowFocus: false,
  });

  const chartRangeChangeByTokenId = useMemo(() => {
    const map = new Map<string, number>();

    if (!chartRangePriceHistories) return map;

    const entries = chartRangePriceHistories.histories;

    const currentPriceByTokenId = new Map(
      sortedMarketData.map((market) => [
        market.yesTokenId,
        Number.parseFloat(market.yesPrice),
      ])
    );

    for (const entry of entries) {
      const history = entry.history || [];
      const reference = history.find((point) => Number.isFinite(point.p));
      const current = currentPriceByTokenId.get(entry.tokenId);

      if (!reference || !Number.isFinite(current)) continue;

      const change = toDisplayPercentagePointChange(
        (current ?? 0) - reference.p
      );
      map.set(entry.tokenId, change);
    }

    return map;
  }, [chartRangePriceHistories, sortedMarketData]);

  return { chartRangeChangeByTokenId };
}
