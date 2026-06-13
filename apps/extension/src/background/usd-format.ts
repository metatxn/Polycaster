import { Decimal } from "decimal.js";

/**
 * Format a raw 6-decimal collateral amount (pUSD / USDC.e base units) as
 * USD. Decimal.js, not floating point — Number(formatUnits(...)) loses
 * precision on amounts a double can't represent exactly.
 */
export function formatUsd6(raw: bigint): string {
  return `$${new Decimal(raw.toString()).div(1_000_000).toFixed(2)}`;
}
