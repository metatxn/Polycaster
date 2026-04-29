import { motion } from "framer-motion";
import { Coins, Loader2, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatCurrency, formatPrice } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { EmptyState } from "./empty-state";
import type { Order } from "./types";

const DESKTOP_GRID =
  "grid grid-cols-[minmax(0,1fr)_64px_72px_124px_124px_92px_80px] items-center gap-3";

/** Format expiration as relative time remaining. */
function formatExpirationRelative(
  expiration: string | null | undefined
): string {
  if (!expiration) return "Until cancelled";

  const diffMs = new Date(expiration).getTime() - Date.now();
  if (diffMs <= 0) return "Expired";

  const s = Math.floor(diffMs / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);

  if (d > 0) return `${d}d left`;
  if (h > 0) return `${h}h left`;
  if (m > 0) return `${m}m left`;
  return `${s}s left`;
}

function orderHref(order: Order): string | null {
  if (!order.market?.eventSlug) return null;
  const base = `/events/detail/${order.market.eventSlug}`;
  return order.market.conditionId
    ? `${base}?conditionId=${order.market.conditionId}`
    : base;
}

function OrderIcon({ order, size }: { order: Order; size: number }) {
  if (!order.market?.icon) {
    return (
      <div
        className="rounded-sm bg-muted border border-border/50 shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="relative rounded-sm overflow-hidden bg-muted border border-border/50 shrink-0"
      style={{ width: size, height: size }}
    >
      <Image
        src={order.market.icon}
        alt={order.market?.question || "Market"}
        fill
        sizes={`${size}px`}
        className="object-cover"
      />
    </div>
  );
}

function FilledMeter({
  filled,
  total,
  side,
}: {
  filled: number;
  total: number;
  side: string;
}) {
  const pct = total > 0 ? (filled / total) * 100 : 0;
  const trackColor = side === "BUY" ? "bg-emerald-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2 w-full justify-end font-mono text-[11px] tabular-nums">
      <div className="relative h-[3px] w-16 bg-muted overflow-hidden">
        <div
          className={cn("absolute inset-y-0 left-0", trackColor)}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
      <span className="text-foreground whitespace-nowrap">
        {filled.toFixed(1)} / {total.toFixed(1)}
      </span>
    </div>
  );
}

function ScoringBadge() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.14em] text-amber-600 dark:text-amber-400 border-b border-amber-500/40 pb-px cursor-help">
          <Coins className="h-3 w-3" />
          Scoring
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">This order is eligible for liquidity rewards.</p>
      </TooltipContent>
    </Tooltip>
  );
}

function SideLabel({ side }: { side: string }) {
  const isBuy = side === "BUY";
  return (
    <span
      className={cn(
        "font-mono text-[11px] uppercase tracking-[0.14em] font-semibold",
        isBuy
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-red-600 dark:text-red-400"
      )}
    >
      {side}
    </span>
  );
}

export function OrdersTable({
  orders,
  isLoading,
  searchQuery,
  onCancel,
  cancellingOrderId,
}: {
  orders: Order[];
  isLoading: boolean;
  searchQuery: string;
  onCancel: (orderId: string) => void;
  cancellingOrderId?: string;
}) {
  const filteredOrders = orders.filter(
    (o) =>
      o.market?.question?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      o.tokenId.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="border-t border-border/40">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="flex items-center gap-3 px-3 py-4 border-b border-border/40"
          >
            <div className="h-9 w-9 rounded-sm bg-muted-foreground/10 animate-pulse shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/3 rounded bg-muted-foreground/10 animate-pulse" />
              <div className="h-3 w-1/3 rounded bg-muted-foreground/10 animate-pulse" />
            </div>
            <div className="h-4 w-20 rounded bg-muted-foreground/10 animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (filteredOrders.length === 0) {
    return (
      <EmptyState
        title="No open orders"
        description={
          searchQuery
            ? "Try a different search term."
            : "No limit orders working. Set a price on any market and it'll land here."
        }
        action={
          !searchQuery
            ? { label: "Browse markets", href: "/markets" }
            : undefined
        }
      />
    );
  }

  return (
    <TooltipProvider>
      {/* Desktop — hairline grid */}
      <div className="hidden md:block">
        <div
          className={cn(
            DESKTOP_GRID,
            "px-3 py-2.5 border-y border-border/40 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
          )}
        >
          <span>Market</span>
          <span className="text-center">Side</span>
          <span className="text-right tabular-nums">Price</span>
          <span className="text-right">Filled</span>
          <span className="text-right">Expires</span>
          <span className="text-right tabular-nums">Total</span>
          <span className="text-right">Action</span>
        </div>

        {filteredOrders.map((order, index) => {
          const href = orderHref(order);
          const isCancelling = cancellingOrderId === order.id;
          const title =
            order.market?.question || `Token ${order.tokenId.slice(0, 8)}…`;

          return (
            <motion.div
              key={order.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.015, 0.3) }}
              className={cn(
                DESKTOP_GRID,
                "px-3 py-3.5 border-b border-border/40 hover:bg-muted/30 transition-colors"
              )}
            >
              {href ? (
                <Link
                  href={href}
                  className="flex items-center gap-3 min-w-0 group"
                >
                  <OrderIcon order={order} size={32} />
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate text-foreground">
                      {title}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {order.market?.outcome && (
                        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                          {order.market.outcome}
                        </span>
                      )}
                      {order.scoring && <ScoringBadge />}
                    </div>
                  </div>
                </Link>
              ) : (
                <div className="flex items-center gap-3 min-w-0">
                  <OrderIcon order={order} size={32} />
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate text-foreground">
                      {title}
                    </p>
                    {order.scoring && (
                      <div className="mt-0.5">
                        <ScoringBadge />
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="text-center">
                <SideLabel side={order.side} />
              </div>

              <div className="text-right font-mono tabular-nums text-sm text-foreground">
                {formatPrice(order.price)}
              </div>

              <FilledMeter
                filled={order.filledSize}
                total={order.size}
                side={order.side}
              />

              <div className="text-right font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                {formatExpirationRelative(order.expiration)}
              </div>

              <div className="text-right font-mono tabular-nums text-sm text-foreground">
                {formatCurrency(order.size * order.price)}
              </div>

              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => onCancel(order.id)}
                  disabled={isCancelling}
                  className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground hover:text-red-600 dark:hover:text-red-400 transition-colors underline underline-offset-4 decoration-border hover:decoration-red-500/60 disabled:opacity-50"
                >
                  {isCancelling ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>Cancelling</span>
                    </>
                  ) : (
                    <>
                      <X className="h-3 w-3" />
                      <span>Cancel</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Mobile — hairline stacked rows */}
      <div className="md:hidden border-t border-border/40">
        {filteredOrders.map((order, index) => {
          const href = orderHref(order);
          const isCancelling = cancellingOrderId === order.id;
          const pct =
            order.size > 0 ? (order.filledSize / order.size) * 100 : 0;
          const title =
            order.market?.question || `Token ${order.tokenId.slice(0, 8)}…`;

          return (
            <motion.div
              key={order.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index * 0.015, 0.3) }}
              className="border-b border-border/40 py-4 space-y-3"
            >
              <div className="flex items-start gap-3">
                {href ? (
                  <Link href={href} className="shrink-0">
                    <OrderIcon order={order} size={40} />
                  </Link>
                ) : (
                  <OrderIcon order={order} size={40} />
                )}
                <div className="flex-1 min-w-0">
                  {href ? (
                    <Link
                      href={href}
                      className="font-medium text-sm leading-tight line-clamp-2 block text-foreground"
                    >
                      {title}
                    </Link>
                  ) : (
                    <p className="font-medium text-sm leading-tight line-clamp-2 text-foreground">
                      {title}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                    <SideLabel side={order.side} />
                    {order.market?.outcome && (
                      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        {order.market.outcome}
                      </span>
                    )}
                    {order.scoring && <ScoringBadge />}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <div>
                  Price{" "}
                  <span className="tabular-nums normal-case text-foreground ml-1">
                    {formatPrice(order.price)}
                  </span>
                </div>
                <div className="text-center">
                  Filled{" "}
                  <span className="tabular-nums normal-case text-foreground ml-1">
                    {order.filledSize.toFixed(1)}/{order.size.toFixed(1)}
                  </span>
                </div>
                <div className="text-right">
                  Total{" "}
                  <span className="tabular-nums normal-case text-foreground font-semibold ml-1">
                    {formatCurrency(order.size * order.price)}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="relative h-[3px] flex-1 bg-muted overflow-hidden">
                  <div
                    className={cn(
                      "absolute inset-y-0 left-0",
                      order.side === "BUY" ? "bg-emerald-500" : "bg-red-500"
                    )}
                    style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                  />
                </div>
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                  {pct.toFixed(0)}%
                </span>
              </div>

              <div className="flex items-center justify-between pt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <span>{formatExpirationRelative(order.expiration)}</span>
                <button
                  type="button"
                  onClick={() => onCancel(order.id)}
                  disabled={isCancelling}
                  className="inline-flex items-center gap-1 text-[11px] tracking-[0.14em] text-muted-foreground hover:text-red-600 dark:hover:text-red-400 transition-colors underline underline-offset-4 decoration-border hover:decoration-red-500/60 disabled:opacity-50"
                >
                  {isCancelling ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>Cancelling</span>
                    </>
                  ) : (
                    <>
                      <X className="h-3 w-3" />
                      <span>Cancel</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
