import { Decimal } from "decimal.js";

/**
 * Outcome token balances crossing the background→content message boundary.
 * Exact 6-decimal share quantities as decimal strings (viem formatUnits
 * output) — never floats, so no precision is lost in transit. All math on
 * them goes through Decimal.js per the monetary-calculation rule.
 */
export type OutcomeBalances = {
  yesBalance: string;
  noBalance: string;
  minBalance: string;
};

/** Threshold below which a position is noise, not a holding (display only). */
const DISPLAY_POSITION_THRESHOLD = "0.01";

/** Balance delta that counts as a fill while polling for order settlement. */
const SETTLE_EPSILON = "0.001";

/**
 * Share count for the panel's numeric sizing model (inputs, steppers).
 * Exact for 6-decimal balances within double range.
 */
export function balanceToNumber(balance: string | undefined): number {
  return balance ? new Decimal(balance).toNumber() : 0;
}

export function hasDisplayPosition(balance: string | undefined): boolean {
  return balance ? new Decimal(balance).gte(DISPLAY_POSITION_THRESHOLD) : false;
}

export function formatBalance(
  balance: string | undefined,
  decimalPlaces: number
): string {
  return new Decimal(balance || 0).toFixed(decimalPlaces);
}

/** Position value (shares × price) for the portfolio bar, as "X.XX". */
export function positionValueUsd(balance: string, price: number): string {
  return new Decimal(balance).mul(price).toFixed(2);
}

export function balanceChanged(prev: string, next: string): boolean {
  return new Decimal(next).sub(prev).abs().gt(SETTLE_EPSILON);
}
