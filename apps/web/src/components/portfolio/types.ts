import type { ElementType } from "react";

export type TabType = "positions" | "orders" | "history";
export type SortField = "value" | "pnl" | "name" | "date";
export type SortDirection = "asc" | "desc";
export type PnLFilter = "all" | "profit" | "loss";

export interface Position {
  id: string;
  outcome: string;
  size: number;
  avgPrice: number;
  currentPrice: number;
  currentValue: number;
  initialValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  /** Token ID (asset) for the position */
  asset?: string;
  /** Condition ID for the market */
  conditionId?: string;
  /** Whether this is a negative risk market */
  negRisk?: boolean;
  market: {
    title: string;
    slug: string;
    eventSlug: string;
    eventId?: string;
    icon?: string;
    endDate?: string;
  };
}

export interface Order {
  id: string;
  side: "BUY" | "SELL";
  price: number;
  size: number;
  filledSize: number;
  remainingSize: number;
  createdAt: string;
  expiration: string;
  market?: {
    question: string;
    slug: string;
    eventSlug: string;
    outcome: string;
    icon?: string;
  };
  tokenId: string;
  scoring?: boolean;
}

export interface Trade {
  id: string;
  timestamp: string;
  type: string;
  side: string | null;
  size: number;
  price: number;
  usdcAmount: number;
  outcome: string;
  transactionHash: string;
  market: {
    conditionId?: string;
    title: string;
    slug: string;
    icon: string;
  };
}

export interface EmptyStateProps {
  icon: ElementType;
  title: string;
  description: string;
  action?: { label: string; href: string };
  secondaryAction?: { label: string; href: string };
}
