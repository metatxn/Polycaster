"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { type ChartConfig, ChartContainer } from "@/components/ui/chart";

/**
 * Price history data point from Polymarket API
 * @see https://docs.polymarket.com/api-reference/pricing/get-price-history-for-a-traded-token
 */
interface PriceHistoryPoint {
  t: number; // UTC timestamp
  p: number; // Price (0-1)
}

interface PriceHistoryResponse {
  success: boolean;
  history?: PriceHistoryPoint[];
  error?: string;
}

interface TokenInfo {
  tokenId: string;
  name: string;
  color: string;
}

interface MarketPriceChartProps {
  /** Array of token IDs with their names for fetching price history */
  tokens?: TokenInfo[];
  /** Fallback: outcome names (used if tokens not provided) */
  outcomes?: string[];
  /** Fallback: current outcome prices (used if tokens not provided) */
  outcomePrices?: string[];
  /** ISO date string for when the market/event started */
  startDate?: string;
  /** Default time range selection (defaults to "ALL") */
  defaultTimeRange?: TimeRange;
}

type TimeRange = "1H" | "6H" | "1D" | "1W" | "1M" | "ALL";

// Map time range to startTs offset (seconds ago from now)
const timeRangeToStartTsOffset: Record<TimeRange, number> = {
  "1H": 60 * 60, // 1 hour ago
  "6H": 6 * 60 * 60, // 6 hours ago
  "1D": 24 * 60 * 60, // 1 day ago
  "1W": 7 * 24 * 60 * 60, // 1 week ago
  "1M": 30 * 24 * 60 * 60, // 30 days ago
  ALL: 365 * 24 * 60 * 60, // 1 year ago (or market creation)
};

// Map time range to fidelity (resolution in minutes)
const timeRangeToFidelity: Record<TimeRange, number> = {
  "1H": 1, // 1-minute intervals
  "6H": 5, // 5-minute intervals
  "1D": 15, // 15-minute intervals
  "1W": 60, // 1-hour intervals
  "1M": 360, // 6-hour intervals
  ALL: 720, // 12-hour intervals
};

/**
 * Fetch price history for a token using startTs and fidelity
 * @see https://docs.polymarket.com/api-reference/pricing/get-price-history-for-a-traded-token
 */
async function fetchPriceHistory(
  tokenId: string,
  startTs: number,
  fidelity: number
): Promise<PriceHistoryPoint[]> {
  if (!tokenId || tokenId.length < 10) {
    return [];
  }

  try {
    const params = new URLSearchParams({
      startTs: startTs.toString(),
      fidelity: fidelity.toString(),
    });

    const response = await fetch(
      `/api/markets/price-history/${tokenId}?${params.toString()}`
    );

    if (!response.ok) {
      console.warn(`Failed to fetch price history for ${tokenId}`);
      return [];
    }

    const data: PriceHistoryResponse = await response.json();

    if (!data.success || !data.history) {
      return [];
    }

    return data.history;
  } catch (error) {
    console.error("Error fetching price history:", error);
    return [];
  }
}

export function MarketPriceChart({
  tokens = [],
  outcomes = [],
  outcomePrices = [],
  defaultTimeRange = "ALL",
}: MarketPriceChartProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>(defaultTimeRange);

  // Calculate startTs based on time range (seconds since epoch)
  const startTs =
    Math.floor(Date.now() / 1000) - timeRangeToStartTsOffset[timeRange];
  const fidelity = timeRangeToFidelity[timeRange];

  // Check if we have valid token IDs
  const hasValidTokens =
    tokens.length > 0 && tokens.some((t) => t.tokenId?.length > 10);

  // Fetch price history for all tokens
  const {
    data: priceHistories,
    isLoading,
    error,
  } = useQuery({
    queryKey: [
      "priceHistory",
      tokens.map((t) => t.tokenId),
      timeRange,
      fidelity,
    ],
    queryFn: async () => {
      const histories = await Promise.all(
        tokens.map(async (token) => ({
          tokenId: token.tokenId,
          name: token.name,
          color: token.color,
          history: await fetchPriceHistory(token.tokenId, startTs, fidelity),
        }))
      );
      return histories;
    },
    enabled: hasValidTokens,
    staleTime: 60 * 1000, // 1 minute
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
  });

  // Process data for chart
  const chartData = useMemo(() => {
    if (!priceHistories || priceHistories.length === 0) {
      // Fallback to mock data if no real data available
      return generateMockData(outcomes, outcomePrices, timeRange);
    }

    // Check if any token has data
    const hasAnyData = priceHistories.some((ph) => ph.history.length > 0);
    if (!hasAnyData) {
      return generateMockData(outcomes, outcomePrices, timeRange);
    }

    // For each token, create a map of timestamp -> price for quick lookup
    const tokenPriceMaps = priceHistories.map((ph) => {
      const map = new Map<number, number>();
      ph.history.forEach((point) => {
        map.set(point.t, point.p);
      });
      return {
        ...ph,
        priceMap: map,
        sortedTimestamps: ph.history.map((p) => p.t).sort((a, b) => a - b),
      };
    });

    // Find all unique timestamps across all tokens
    const timestampSet = new Set<number>();
    priceHistories.forEach((ph) => {
      ph.history.forEach((point) => {
        timestampSet.add(point.t);
      });
    });

    // Sort timestamps
    const timestamps = Array.from(timestampSet).sort((a, b) => a - b);

    if (timestamps.length === 0) {
      return generateMockData(outcomes, outcomePrices, timeRange);
    }

    // Helper function to find the closest price for a timestamp using interpolation
    const findPriceAtTimestamp = (
      tokenData: (typeof tokenPriceMaps)[0],
      timestamp: number
    ): number | null => {
      // Direct match
      if (tokenData.priceMap.has(timestamp)) {
        return tokenData.priceMap.get(timestamp) ?? null;
      }

      const sortedTs = tokenData.sortedTimestamps;
      if (sortedTs.length === 0) return null;

      // Find surrounding timestamps for interpolation
      let lowerIdx = -1;
      let upperIdx = -1;

      for (let i = 0; i < sortedTs.length; i++) {
        if (sortedTs[i] <= timestamp) {
          lowerIdx = i;
        }
        if (sortedTs[i] >= timestamp && upperIdx === -1) {
          upperIdx = i;
          break;
        }
      }

      // If timestamp is before all data, use first value
      if (lowerIdx === -1 && upperIdx !== -1) {
        return tokenData.priceMap.get(sortedTs[upperIdx]) ?? null;
      }

      // If timestamp is after all data, use last value
      if (lowerIdx !== -1 && upperIdx === -1) {
        return tokenData.priceMap.get(sortedTs[lowerIdx]) ?? null;
      }

      // If we have both bounds, use the closest one (or interpolate)
      if (lowerIdx !== -1 && upperIdx !== -1) {
        const lowerTs = sortedTs[lowerIdx];
        const upperTs = sortedTs[upperIdx];
        const lowerPrice = tokenData.priceMap.get(lowerTs);
        const upperPrice = tokenData.priceMap.get(upperTs);
        if (lowerPrice === undefined || upperPrice === undefined) return null;

        // Linear interpolation
        if (upperTs === lowerTs) return lowerPrice;
        const ratio = (timestamp - lowerTs) / (upperTs - lowerTs);
        return lowerPrice + ratio * (upperPrice - lowerPrice);
      }

      return null;
    };

    // Create chart data points with interpolated values
    return timestamps.map((timestamp) => {
      const point: Record<string, number | string> = {
        date: new Date(timestamp * 1000).toISOString(),
      };

      tokenPriceMaps.forEach((tokenData, idx) => {
        const price = findPriceAtTimestamp(tokenData, timestamp);
        if (price !== null) {
          // Convert price (0-1) to percentage (0-100)
          point[`outcome${idx}`] = Number((price * 100).toFixed(2));
        }
      });

      return point;
    });
  }, [priceHistories, outcomes, outcomePrices, timeRange]);

  // Generate chart config
  const chartConfig = useMemo(() => {
    const config: ChartConfig = {};
    const defaultColors = [
      "hsl(25, 95%, 53%)", // Orange
      "hsl(221, 83%, 53%)", // Blue
      "hsl(280, 100%, 70%)", // Purple/Pink
      "hsl(142, 76%, 36%)", // Green
    ];

    if (priceHistories && priceHistories.length > 0) {
      priceHistories.forEach((ph, idx) => {
        config[`outcome${idx}`] = {
          label: ph.name,
          color: ph.color || defaultColors[idx % defaultColors.length],
        };
      });
    } else {
      // Fallback to outcomes
      outcomes.forEach((outcome, idx) => {
        config[`outcome${idx}`] = {
          label: outcome,
          color: defaultColors[idx % defaultColors.length],
        };
      });

      // Default config if nothing provided
      if (outcomes.length === 0) {
        config.outcome0 = { label: "Yes", color: defaultColors[0] };
        config.outcome1 = { label: "No", color: defaultColors[1] };
      }
    }

    return config;
  }, [priceHistories, outcomes]);

  const formatXAxis = (value: string) => {
    const date = new Date(value);
    switch (timeRange) {
      case "1H":
      case "6H":
        return date.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        });
      case "1D":
        return date.toLocaleTimeString("en-US", {
          hour: "numeric",
        });
      case "1W":
        return date.toLocaleDateString("en-US", {
          weekday: "short",
        });
      case "1M":
        return date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
      case "ALL":
        return date.toLocaleDateString("en-US", {
          month: "short",
          year: "2-digit",
        });
      default:
        return date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
    }
  };

  // Calculate dynamic Y-axis range based on data
  // Min is always 0, max is rounded up from highest data value + padding
  const { yAxisMin, yAxisMax, yAxisTicks } = useMemo(() => {
    if (!chartData || chartData.length === 0) {
      return {
        yAxisMin: 0,
        yAxisMax: 100,
        yAxisTicks: [0, 20, 40, 60, 80, 100],
      };
    }

    // Find max value across all outcomes
    let maxValue = -Infinity;

    chartData.forEach((point) => {
      Object.keys(point).forEach((key) => {
        if (key.startsWith("outcome")) {
          const value = point[key] as number;
          if (typeof value === "number" && !Number.isNaN(value)) {
            maxValue = Math.max(maxValue, value);
          }
        }
      });
    });

    // If no valid data found, use defaults
    if (maxValue === -Infinity) {
      return {
        yAxisMin: 0,
        yAxisMax: 100,
        yAxisTicks: [0, 20, 40, 60, 80, 100],
      };
    }

    // Min is always 0
    const yMin = 0;

    // Add padding to max (round up to nearest 10)
    // e.g., 35% -> 40%, 72% -> 80%, 68% -> 70%
    let yMax = Math.ceil((maxValue + 5) / 10) * 10;

    // Ensure max is at least 10 and at most 100
    yMax = Math.max(10, Math.min(100, yMax));

    // Generate equal distribution ticks from 0 to max
    // Use interval of 10 for most cases
    const tickInterval = 10;
    const ticks: number[] = [];
    for (let tick = yMin; tick <= yMax; tick += tickInterval) {
      ticks.push(tick);
    }

    return { yAxisMin: yMin, yAxisMax: yMax, yAxisTicks: ticks };
  }, [chartData]);

  const timeRanges: TimeRange[] = ["1H", "6H", "1D", "1W", "1M", "ALL"];

  return (
    <div className="space-y-4">
      {/* Chart */}
      <ChartContainer
        config={chartConfig}
        className="w-full min-h-[200px] h-[220px] sm:h-[300px] md:h-[360px] lg:h-[400px] max-h-[60vh]"
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Failed to load price history
          </div>
        ) : (
          <LineChart
            accessibilityLayer
            data={chartData}
            margin={{
              left: 0,
              right: 12,
              top: 12,
              bottom: 12,
            }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={formatXAxis}
              minTickGap={50}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={4}
              tickFormatter={(value) => `${value}%`}
              domain={[yAxisMin, yAxisMax]}
              ticks={yAxisTicks}
              width={45}
            />
            <Tooltip
              cursor={{
                stroke: "hsl(var(--muted-foreground))",
                strokeWidth: 1,
              }}
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0 || !label) {
                  return null;
                }

                const date = new Date(label as string | number);
                const formattedDate = date.toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  hour12: true,
                });

                return (
                  <div className="bg-background/95 backdrop-blur-sm border border-border rounded-lg shadow-xl p-3 space-y-2">
                    {/* Date header */}
                    <div className="text-xs text-muted-foreground font-medium">
                      {formattedDate}
                    </div>

                    {/* Outcome values */}
                    <div className="space-y-1.5">
                      {payload
                        .filter((entry) => entry.value !== undefined)
                        .sort(
                          (a, b) => (b.value as number) - (a.value as number)
                        )
                        .map((entry) => {
                          const configKey =
                            entry.dataKey as keyof typeof chartConfig;
                          const config = chartConfig[configKey];
                          const label = config?.label || entry.name;
                          const color = entry.color || config?.color || "#888";
                          const entryKey =
                            typeof entry.dataKey === "string" ||
                            typeof entry.dataKey === "number"
                              ? entry.dataKey
                              : String(configKey);

                          return (
                            <div
                              key={entryKey}
                              className="flex items-center gap-2"
                            >
                              <span
                                className="px-2 py-0.5 rounded text-xs font-semibold text-white"
                                style={{ backgroundColor: color }}
                              >
                                {label}
                              </span>
                              <span className="text-sm font-bold">
                                {typeof entry.value === "number"
                                  ? `${entry.value.toFixed(1)}%`
                                  : entry.value}
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                );
              }}
            />
            {Object.keys(chartConfig).map((key) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={chartConfig[key as keyof typeof chartConfig]?.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls={true}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        )}
      </ChartContainer>

      {/* Time Range Selectors - Below Chart */}
      <div className="flex justify-center gap-2">
        {timeRanges.map((range) => (
          <Button
            key={range}
            type="button"
            variant={timeRange === range ? "default" : "ghost"}
            size="sm"
            onClick={() => setTimeRange(range)}
            className="h-8 px-3"
          >
            {range}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * Generate mock data when real price history is not available
 */
function generateMockData(
  _outcomes: string[],
  outcomePrices: string[],
  timeRange: TimeRange
): Record<string, number | string>[] {
  const data: Record<string, number | string>[] = [];
  const now = new Date();

  const parsedPrices =
    outcomePrices.length > 0
      ? outcomePrices.map((p) => Number.parseFloat(p))
      : [0.5, 0.5];

  let dataPoints: number;
  let intervalMs: number;

  switch (timeRange) {
    case "1H":
      dataPoints = 12;
      intervalMs = 5 * 60 * 1000; // 5 minutes
      break;
    case "6H":
      dataPoints = 24;
      intervalMs = 15 * 60 * 1000; // 15 minutes
      break;
    case "1D":
      dataPoints = 24;
      intervalMs = 60 * 60 * 1000; // 1 hour
      break;
    case "1W":
      dataPoints = 28;
      intervalMs = 6 * 60 * 60 * 1000; // 6 hours
      break;
    case "1M":
      dataPoints = 30;
      intervalMs = 24 * 60 * 60 * 1000; // 1 day
      break;
    case "ALL":
      dataPoints = 90;
      intervalMs = 24 * 60 * 60 * 1000; // 1 day
      break;
  }

  for (let i = 0; i <= dataPoints; i++) {
    const timestamp = now.getTime() - (dataPoints - i) * intervalMs;
    const point: Record<string, number | string> = {
      date: new Date(timestamp).toISOString(),
    };

    parsedPrices.forEach((basePrice, idx) => {
      const variance = (Math.random() - 0.5) * 0.05;
      const trend = basePrice * 0.1 * (i / dataPoints) - basePrice * 0.05;
      let price = basePrice + trend + variance;
      price = Math.max(0.01, Math.min(0.99, price));
      point[`outcome${idx}`] = Number((price * 100).toFixed(2));
    });

    data.push(point);
  }

  return data;
}
