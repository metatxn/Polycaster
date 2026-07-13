import { Decimal } from "decimal.js";
import { normalizeExtensionTradingWalletMode } from "../content/trading/setup-gates";

export type TradingWalletMode = "deposit" | "safe" | "eoa";
export type SidePanelView = "markets" | "portfolio";

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char] || char
  );
}

export function formatMoney(value: number | undefined): string {
  const safeValue = Number.isFinite(value) ? Number(value) : 0;
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: safeValue >= 1000 ? 0 : 2,
    minimumFractionDigits: safeValue >= 1000 ? 0 : 2,
    style: "currency",
  }).format(safeValue);
}

export function formatDecimalMoney(value: Decimal.Value): string {
  const decimal = new Decimal(value);
  const safeValue = decimal.isFinite() ? decimal.toNumber() : 0;
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: decimal.greaterThanOrEqualTo(1000) ? 0 : 2,
    minimumFractionDigits: decimal.greaterThanOrEqualTo(1000) ? 0 : 2,
    style: "currency",
  }).format(safeValue);
}

export function formatSignedMoney(value: number | undefined): string {
  return formatMoney(Number.isFinite(value) ? Number(value) : 0);
}

export function formatPercent(value: number | undefined): string {
  const safeValue = Number.isFinite(value) ? Number(value) : 0;
  return `${safeValue.toFixed(1)}%`;
}

export function formatCompactNumber(value: number | undefined): string {
  const safeValue = Number.isFinite(value) ? Number(value) : 0;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: safeValue >= 1000 ? 1 : 0,
    notation: safeValue >= 10_000 ? "compact" : "standard",
  }).format(safeValue);
}

export function formatAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatTradeTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function formatOrderExpiration(expiration: string): string {
  if (!expiration || expiration === "0") return "GTC";
  const numeric = Number(expiration);
  const date = Number.isFinite(numeric)
    ? new Date(numeric * 1000)
    : new Date(expiration);
  if (Number.isNaN(date.getTime())) return "GTC";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function normalizePortfolioWalletMode(
  value: unknown
): TradingWalletMode {
  return typeof value === "string"
    ? normalizeExtensionTradingWalletMode(value)
    : "deposit";
}

export function setSidepanelView(
  root: HTMLElement,
  view: SidePanelView,
  onPortfolioSelected: () => void
): void {
  const stack = root.querySelector("#knoww-notification-stack");
  const markets = root.querySelector<HTMLElement>("[data-sidepanel-markets]");
  const portfolio = root.querySelector<HTMLElement>(
    "[data-sidepanel-portfolio]"
  );
  const searchToggle = root.querySelector<HTMLButtonElement>(
    "#knoww-search-toggle"
  );
  const tabs = root.querySelectorAll<HTMLButtonElement>(
    "[data-sidepanel-view]"
  );

  markets?.toggleAttribute("hidden", view !== "markets");
  portfolio?.toggleAttribute("hidden", view !== "portfolio");
  stack?.classList.toggle(
    "knoww-sidepanel-portfolio-active",
    view === "portfolio"
  );
  if (searchToggle) searchToggle.hidden = view === "portfolio";
  tabs.forEach((tab) => {
    const selected = tab.dataset.sidepanelView === view;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
  });
  if (view === "portfolio") onPortfolioSelected();
}
