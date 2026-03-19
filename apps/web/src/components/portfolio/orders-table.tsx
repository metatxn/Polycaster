import { motion } from "framer-motion";
import { Coins, ListOrdered, RefreshCw, Trash2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatCurrency, formatPrice } from "@/lib/formatters";
import { EmptyState } from "./empty-state";
import type { Order } from "./types";

/**
 * Format expiration time as relative time remaining
 */
function formatExpirationRelative(
  expiration: string | null | undefined
): string {
  if (!expiration) return "GTC";

  const expirationDate = new Date(expiration);
  const now = new Date();
  const diffMs = expirationDate.getTime() - now.getTime();

  // If already expired
  if (diffMs <= 0) return "Expired";

  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${diffDays} day${diffDays !== 1 ? "s" : ""} left`;
  }
  if (diffHours > 0) {
    return `${diffHours} hour${diffHours !== 1 ? "s" : ""} left`;
  }
  if (diffMinutes > 0) {
    return `${diffMinutes} min${diffMinutes !== 1 ? "s" : ""} left`;
  }
  return `${diffSeconds} sec${diffSeconds !== 1 ? "s" : ""} left`;
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
      <div className="p-4 sm:p-6 space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (filteredOrders.length === 0) {
    return (
      <EmptyState
        icon={ListOrdered}
        title="No open orders"
        description={
          searchQuery
            ? "Try a different search term"
            : "Place limit orders on any market to see them here. Limit orders let you set your own price."
        }
        action={
          !searchQuery ? { label: "Browse Markets", href: "/" } : undefined
        }
      />
    );
  }

  return (
    <>
      {/* Mobile Card View */}
      <div className="md:hidden space-y-3 p-4">
        {filteredOrders.map((order) => (
          <motion.div
            key={order.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-background border border-border rounded-xl p-4 space-y-3"
          >
            <div className="flex items-start gap-3">
              {/* Avatar */}
              {order.market?.icon && (
                <Link
                  href={`/events/detail/${order.market.eventSlug}`}
                  className="relative w-10 h-10 shrink-0 rounded-full overflow-hidden bg-muted"
                >
                  <Image
                    src={order.market.icon}
                    alt={order.market?.question || "Market"}
                    fill
                    sizes="40px"
                    className="object-cover"
                  />
                </Link>
              )}
              <div className="flex-1 min-w-0">
                {order.market?.eventSlug ? (
                  <Link
                    href={`/events/detail/${order.market.eventSlug}`}
                    className="font-medium text-sm leading-tight hover:text-primary transition-colors line-clamp-2"
                  >
                    {order.market?.question ||
                      `Token ${order.tokenId.slice(0, 8)}...`}
                  </Link>
                ) : (
                  <p className="font-medium text-sm leading-tight line-clamp-2">
                    {order.market?.question ||
                      `Token ${order.tokenId.slice(0, 8)}...`}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      order.side === "BUY"
                        ? "bg-emerald-500/15 text-emerald-500"
                        : "bg-red-500/15 text-red-500"
                    }`}
                  >
                    {order.side}
                  </span>
                  {order.market?.outcome && (
                    <span className="text-xs text-muted-foreground">
                      {order.market.outcome}
                    </span>
                  )}
                  {order.scoring && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                            <Coins className="h-3 w-3" />
                            <span className="text-[10px] font-bold uppercase">
                              Scoring
                            </span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs">
                            This order is eligible for liquidity rewards.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onCancel(order.id)}
                disabled={cancellingOrderId === order.id}
                className="h-8 w-8 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 shrink-0"
              >
                {cancellingOrderId === order.id ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-3 pt-3 border-t border-border">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  Price
                </p>
                <p className="text-sm font-medium">
                  {formatPrice(order.price)}
                </p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  Filled
                </p>
                <p className="text-sm">
                  {order.filledSize.toFixed(1)} / {order.size.toFixed(1)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  Total
                </p>
                <p className="text-sm font-medium">
                  {formatCurrency(order.size * order.price)}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border">
              <span>{formatExpirationRelative(order.expiration)}</span>
              {/* Progress indicator */}
              <div className="flex items-center gap-1.5">
                <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      order.side === "BUY" ? "bg-emerald-500" : "bg-red-500"
                    }`}
                    style={{
                      width: `${(order.filledSize / order.size) * 100}%`,
                    }}
                  />
                </div>
                <span>
                  {((order.filledSize / order.size) * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Desktop Table View */}
      <div className="hidden md:block overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-b">
              <TableHead className="w-[35%] min-w-[220px]">Market</TableHead>
              <TableHead className="text-center min-w-[60px]">Side</TableHead>
              <TableHead className="text-center min-w-[80px]">
                Outcome
              </TableHead>
              <TableHead className="text-right min-w-[70px]">Price</TableHead>
              <TableHead className="text-right min-w-[90px]">Filled</TableHead>
              <TableHead className="text-right min-w-[70px]">Total</TableHead>
              <TableHead className="text-center min-w-[100px]">
                Expiration
              </TableHead>
              <TableHead className="text-center min-w-[80px]">
                Rewards
              </TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredOrders.map((order) => (
              <TableRow
                key={order.id}
                className="hover:bg-muted/50 transition-colors"
              >
                <TableCell>
                  <div className="flex items-center gap-3">
                    {/* Avatar */}
                    {order.market?.icon && (
                      <Link
                        href={`/events/detail/${order.market.eventSlug}`}
                        className="relative w-8 h-8 shrink-0 rounded-full overflow-hidden bg-muted"
                      >
                        <Image
                          src={order.market.icon}
                          alt={order.market?.question || "Market"}
                          fill
                          sizes="32px"
                          className="object-cover"
                        />
                      </Link>
                    )}
                    {order.market?.eventSlug ? (
                      <Link
                        href={`/events/detail/${order.market.eventSlug}`}
                        className="font-medium text-sm hover:text-primary transition-colors line-clamp-2"
                      >
                        {order.market?.question ||
                          `Token ${order.tokenId.slice(0, 8)}...`}
                      </Link>
                    ) : (
                      <p className="font-medium text-sm line-clamp-2">
                        {order.market?.question ||
                          `Token ${order.tokenId.slice(0, 8)}...`}
                      </p>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  <span
                    className={`inline-flex text-xs font-medium px-2 py-1 rounded ${
                      order.side === "BUY"
                        ? "bg-emerald-500/15 text-emerald-500"
                        : "bg-red-500/15 text-red-500"
                    }`}
                  >
                    {order.side}
                  </span>
                </TableCell>
                <TableCell className="text-center text-sm">
                  {order.market?.outcome || "-"}
                </TableCell>
                <TableCell className="text-right">
                  {formatPrice(order.price)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          order.side === "BUY" ? "bg-emerald-500" : "bg-red-500"
                        }`}
                        style={{
                          width: `${(order.filledSize / order.size) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="text-sm text-muted-foreground">
                      {order.filledSize.toFixed(1)} / {order.size.toFixed(1)}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrency(order.size * order.price)}
                </TableCell>
                <TableCell className="text-center text-sm text-muted-foreground">
                  {formatExpirationRelative(order.expiration)}
                </TableCell>
                <TableCell className="text-center">
                  {order.scoring ? (
                    <div className="flex justify-center">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                              <Coins className="h-3 w-3" />
                              <span className="text-[10px] font-bold uppercase">
                                Scoring
                              </span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-xs">
                              This order is eligible for liquidity rewards.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  ) : (
                    <span className="text-muted-foreground/30">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onCancel(order.id)}
                    disabled={cancellingOrderId === order.id}
                    className="h-8 w-8 text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
                  >
                    {cancellingOrderId === order.id ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
