import type { TabType } from "@/components/portfolio/types";

const PORTFOLIO_TABS = new Set<TabType>(["positions", "orders", "history"]);

export function parsePortfolioTab(
  search: string | URLSearchParams | null | undefined
): TabType {
  const params =
    typeof search === "string"
      ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
      : search;
  const tab = params?.get("tab");
  return PORTFOLIO_TABS.has(tab as TabType) ? (tab as TabType) : "positions";
}

export function buildPortfolioTabUrl(
  pathname: string,
  search: string,
  tab: TabType
): string {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search
  );

  if (tab === "positions") {
    params.delete("tab");
  } else {
    params.set("tab", tab);
  }

  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}
