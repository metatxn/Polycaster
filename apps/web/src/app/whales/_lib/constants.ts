import type {
  InsiderSensitivity,
  InsiderSortMode,
} from "@/hooks/use-insider-activity";

export const TIME_PERIODS = [
  { value: "24h", label: "24H", apiPeriod: "DAY" as const },
  { value: "7d", label: "7D", apiPeriod: "WEEK" as const },
  { value: "30d", label: "30D", apiPeriod: "MONTH" as const },
  { value: "all", label: "ALL", apiPeriod: "ALL" as const },
] as const;

export type TimePeriodValue = (typeof TIME_PERIODS)[number]["value"];

export const TRADE_SIZE_OPTIONS = [
  { value: "100", label: "$100+" },
  { value: "500", label: "$500+" },
  { value: "1000", label: "$1K+" },
  { value: "5000", label: "$5K+" },
] as const;

export const INSIDER_SENSITIVITY_OPTIONS: {
  value: InsiderSensitivity;
  label: string;
}[] = [
  { value: "conservative", label: "Conservative" },
  { value: "balanced", label: "Balanced" },
  { value: "aggressive", label: "Aggressive" },
];

export const INSIDER_SORT_OPTIONS: {
  value: InsiderSortMode;
  label: string;
}[] = [
  { value: "suspicion", label: "Most Suspicious" },
  { value: "amount", label: "Largest Amount" },
  { value: "newest_account", label: "Newest Account" },
  { value: "most_repeated", label: "Most Repeated" },
];

export type WhaleSortColumn =
  | "volume"
  | "trades"
  | "buyRatio"
  | "markets"
  | "lastActive";

export type ActivitySortColumn = "time" | "amount" | "price";

export type ActivitySideFilter = "all" | "buy" | "sell";

export const WHALE_TYPE_FILTERS = [
  { value: "all", label: "All" },
  { value: "big", label: "Big Bets" },
  { value: "directional", label: "Directional" },
] as const;

export type WhaleTypeFilter = (typeof WHALE_TYPE_FILTERS)[number]["value"];
