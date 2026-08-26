import Decimal from "decimal.js";
import { z } from "zod";

type DecimalBounds = {
  min?: string;
  max?: string;
  minExclusive?: boolean;
};

export function isBoundedDecimal(
  value: string | number,
  bounds: DecimalBounds = {}
): boolean {
  try {
    const decimal = new Decimal(value);
    if (!decimal.isFinite()) return false;
    if (bounds.min !== undefined) {
      const comparison = decimal.comparedTo(bounds.min);
      if (comparison < 0 || (bounds.minExclusive && comparison === 0)) {
        return false;
      }
    }
    if (bounds.max !== undefined && decimal.comparedTo(bounds.max) > 0) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function decimalValueSchema(bounds: DecimalBounds = {}) {
  return z
    .union([z.string().trim().min(1), z.number().finite()])
    .refine(
      (value) => isBoundedDecimal(value, bounds),
      "Invalid decimal value"
    );
}

function jsonArrayMatches(value: string, itemSchema: z.ZodType): boolean {
  try {
    return z.array(itemSchema).safeParse(JSON.parse(value)).success;
  } catch {
    return false;
  }
}

export const gammaStringArraySchema = z.union([
  z.array(z.string()),
  z
    .string()
    .refine(
      (value) => jsonArrayMatches(value, z.string()),
      "Expected a JSON string array"
    ),
]);

const probabilitySchema = decimalValueSchema({ min: "0", max: "1" });

export const gammaProbabilityArraySchema = z.union([
  z.array(probabilitySchema),
  z
    .string()
    .refine(
      (value) => jsonArrayMatches(value, probabilitySchema),
      "Expected a JSON probability array"
    ),
]);

export const gammaTimestampSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => Number.isFinite(Date.parse(value)), "Invalid timestamp");

export const nonNegativeDecimalSchema = decimalValueSchema({ min: "0" });
