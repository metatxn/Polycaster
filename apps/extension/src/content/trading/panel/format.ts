import { PUSD_DECIMALS } from "@knoww/shared-types/contracts";
import { Decimal } from "decimal.js";
import { formatUnits } from "viem";
import type { FundingError } from "../../../funding";
import { formatTradingErrorLine } from "../error-mapping";
import type { TradingContext } from "../trading-service";

export function isSigningBridgeUnreachable(error: string): boolean {
  return (
    error.includes("Receiving end does not exist") ||
    error.includes("Could not establish connection") ||
    error.includes("Extension context invalidated")
  );
}

export function depositErrorCopy(error: FundingError): string {
  switch (error.code) {
    case "PENDING_RECONCILIATION":
      return "This transaction may already be submitted. Check your wallet and portfolio before trying again.";
    case "IDEMPOTENCY_FINGERPRINT_MISMATCH":
      return "Transaction details changed. Review the form and start a new transaction.";
    case "NO_CONTENT_TAB":
      return "Open a supported page (e.g. Polymarket) with your wallet, then retry — or finish on knoww.app.";
    default:
      if (isSigningBridgeUnreachable(error.message)) {
        return "Couldn't reach your wallet. Open the page where you connected it (e.g. Polymarket), keep it active, then retry.";
      }
      if (
        /user rejected|request rejected|rejected the request|denied|4001/i.test(
          error.message
        )
      ) {
        return "Transaction rejected.";
      }
      return error.message;
  }
}

export function truncAddr(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatShareQuantity(quantity: number): string {
  try {
    const value = new Decimal(quantity);
    if (!value.isFinite()) return "0";
    const rounded = value.toDecimalPlaces(4);
    return rounded.isInteger()
      ? rounded.toFixed(0)
      : rounded.toFixed().replace(/\.?0+$/, "");
  } catch {
    return "0";
  }
}

export function formatMarketBuyAmountInput(amount: number): string {
  return amount > 0 ? String(amount) : "0";
}

export function normalizeUsdInputAmount(amount: number | string): number {
  try {
    const value = new Decimal(amount || 0);
    if (!value.isFinite() || value.lt(0)) return 0;
    return value.toNumber();
  } catch {
    return 0;
  }
}

export function normalizeUsdChipAmount(amount: number | string): number {
  try {
    const value = new Decimal(amount || 0);
    if (!value.isFinite() || value.lt(0)) return 0;
    return value.toDecimalPlaces(2).toNumber();
  } catch {
    return 0;
  }
}

export function rawPusdToNumber(raw: string): number {
  return new Decimal(raw || "0")
    .div(new Decimal(10).pow(PUSD_DECIMALS))
    .toNumber();
}

export function formatTokenAmount(amount: number): string {
  if (amount <= 0) return "0.00";
  if (amount < 0.01) return "<0.01";
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(2)}K`;
  return amount.toFixed(2);
}

export function getTokenBalance(ctx: TradingContext, symbol: string): number {
  const normalized = symbol.toLowerCase();
  return (
    ctx.tokenBalances.find((token) => token.symbol.toLowerCase() === normalized)
      ?.amount ?? 0
  );
}

export function getPusdBalance(ctx: TradingContext): number {
  return ctx.pusdBalance ?? getTokenBalance(ctx, "pUSD");
}

export function getExactPusdBalance(ctx: TradingContext): string {
  return formatUnits(BigInt(ctx.pusdBalanceRaw), PUSD_DECIMALS);
}

export function formatSplitMergeAmount(amount: string): string {
  const decimal = new Decimal(amount);
  return decimal.toFixed(Math.max(2, decimal.decimalPlaces()));
}

export function formatCollateralBreakdown(ctx: TradingContext): string {
  return `pUSD ${formatTokenAmount(getPusdBalance(ctx))} + USDC.e ${formatTokenAmount(ctx.usdcEBalance ?? getTokenBalance(ctx, "USDC.e"))}`;
}

export function formatTradingPanelErrorMessage(
  message: string | null | undefined
): string {
  return formatTradingErrorLine(message);
}

export function formatDepositRawAmount(raw: bigint, decimals: number): string {
  const amount = new Decimal(raw.toString()).div(new Decimal(10).pow(decimals));
  const fixed = amount.toFixed();
  return fixed.includes(".")
    ? fixed.replace(/0+$/, "").replace(/\.$/, "")
    : fixed;
}
