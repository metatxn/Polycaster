import Decimal from "decimal.js";

/** Money and prices stay decimal strings end to end; floats never leave here. */
export function toDecimalString(
  value: number | string | undefined
): string | undefined {
  if (value === undefined) return undefined;
  try {
    const decimal = new Decimal(value);
    return decimal.isFinite() ? decimal.toString() : undefined;
  } catch {
    return undefined;
  }
}
