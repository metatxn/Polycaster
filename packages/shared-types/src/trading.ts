import Decimal from "decimal.js";
import { type Address, encodeFunctionData, erc20Abi, type Hex } from "viem";
import { COLLATERAL_ONRAMP_ABI } from "./abi";
import {
  COLLATERAL_ONRAMP_ADDRESS,
  PUSD_DECIMALS,
  USDC_E_ADDRESS,
} from "./contracts";

export const DEFAULT_APPROVAL_AMOUNT = "100";
export const APPROVAL_DECIMALS = PUSD_DECIMALS;
export const PROTOCOL_FEE_DECIMALS = 5;
export const CONDITIONAL_TOKEN_DECIMALS = PUSD_DECIMALS;
export const CLOB_SIZE_DECIMALS = 2;

type ProtocolFeeDetails = {
  rate: Decimal;
  exponent: Decimal;
};

export type ClobMarketInfoClient = {
  getClobMarketInfo?: (conditionId: string) => Promise<unknown>;
};

export type ClobOpenOrderLike = {
  side?: string;
  price?: string | number;
  original_size?: string | number;
  size_matched?: string | number;
};

export interface ClobOrderPreflightPlanInput {
  side: string;
  orderType?: string;
  amount?: number;
  size: number;
  price: number;
  conditionId?: string;
  openOrders?: unknown;
  getOpenOrders?: () => Promise<unknown>;
  marketInfoClient?: ClobMarketInfoClient;
  builderCode?: string;
  /**
   * Resolves the maker + taker builder fee rates as fractions (e.g. 0.001 for
   * 10 bps). Required when `builderCode` is set; without it the preflight
   * falls back to whatever rate is embedded in `getClobMarketInfo`, which the
   * CLOB does NOT populate for builder orders.
   */
  getBuilderFeeRates?: (
    builderCode: string
  ) => Promise<{ maker: number; taker: number }>;
  /**
   * Whether the BUY order will execute immediately as a taker (true) or rest
   * in the book as a maker (false). When omitted, defaults to taker — the
   * conservative choice for the allowance pre-flight, since builder taker
   * rates are typically ≥ maker rates.
   */
  isMarketableBuy?: boolean;
  estimatedFeeRaw?: bigint | null;
  onOpenOrdersError?: (error: unknown) => void;
  onFeeError?: (error: unknown) => void;
}

export interface ClobBuyOrderPreflightPlan {
  requiredNotional: Decimal;
  requiredPusdRaw: bigint;
  reservedPusdRaw: bigint;
  estimatedFeeRaw: bigint | null;
  feeRequirementRaw: bigint;
  requiredCollateralRaw: bigint;
}

export interface ClobSellOrderPreflightPlan {
  requiredConditionalRaw: bigint;
}

export interface ClobOrderPreflightPlan {
  side: string;
  orderType?: string;
  isMarketOrder: boolean;
  buy: ClobBuyOrderPreflightPlan | null;
  sell: ClobSellOrderPreflightPlan | null;
}

export interface PusdAutoWrapPlanInput {
  pusdBalanceRaw: bigint;
  usdcEBalanceRaw: bigint;
  requiredPusdRaw: bigint;
  reservedPusdRaw?: bigint;
  estimatedFeeRaw?: bigint | null;
}

export interface PusdAutoWrapPlan {
  requiredPusdRaw: bigint;
  reservedPusdRaw: bigint;
  availablePusdRaw: bigint;
  feeRequirementRaw: bigint;
  targetPusdRaw: bigint;
  shortfallRaw: bigint;
  baseShortfallRaw: bigint;
  wrapAmountRaw: bigint;
  needsWrap: boolean;
  hasEnoughBaseCollateral: boolean;
}

export interface PusdAutoWrapTransaction {
  to: Address;
  data: Hex;
  value: "0";
}

export function isMarketOrderType(orderType?: string): boolean {
  return orderType === "FAK" || orderType === "FOK";
}

function getNestedValue(source: unknown, path: string[]): unknown {
  let current = source;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function decimalFromUnknown(value: unknown): Decimal | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const decimal = new Decimal(value);
  return decimal.isFinite() ? decimal : null;
}

function parseProtocolFeeDetails(info: unknown): ProtocolFeeDetails {
  const rate =
    decimalFromUnknown(getNestedValue(info, ["fd", "r"])) ??
    decimalFromUnknown(getNestedValue(info, ["fee_details", "r"]));
  const exponent =
    decimalFromUnknown(getNestedValue(info, ["fd", "e"])) ??
    decimalFromUnknown(getNestedValue(info, ["fee_details", "e"]));

  return {
    rate: rate ?? new Decimal(0),
    exponent: exponent?.isFinite() ? exponent : new Decimal(1),
  };
}

function parseBuilderTakerFeeRate(info: unknown): Decimal {
  const rawBps =
    decimalFromUnknown(getNestedValue(info, ["tbf"])) ??
    decimalFromUnknown(getNestedValue(info, ["builderTakerFeeBps"])) ??
    decimalFromUnknown(getNestedValue(info, ["builder_taker_fee_bps"]));
  if (!rawBps) return new Decimal(0);
  return rawBps.div(10_000);
}

export function normalizeApprovalAmount(amount?: string): string {
  const decimal = new Decimal(amount || DEFAULT_APPROVAL_AMOUNT);
  if (!decimal.isFinite() || decimal.lte(0)) {
    throw new Error("Approval amount must be greater than 0");
  }
  return decimal
    .toDecimalPlaces(APPROVAL_DECIMALS, Decimal.ROUND_DOWN)
    .toFixed();
}

export function decimalToPusdRaw(
  value: Decimal.Value,
  rounding: Decimal.Rounding = Decimal.ROUND_CEIL
): bigint {
  const decimal = new Decimal(value);
  if (!decimal.isFinite() || decimal.lt(0)) {
    throw new Error("pUSD amount must be a finite non-negative value");
  }

  const fixed = decimal
    .toDecimalPlaces(PUSD_DECIMALS, rounding)
    .toFixed(PUSD_DECIMALS);
  const [whole, fraction = ""] = fixed.split(".");
  return (
    BigInt(whole || "0") * BigInt(10 ** PUSD_DECIMALS) +
    BigInt(fraction.padEnd(PUSD_DECIMALS, "0").slice(0, PUSD_DECIMALS))
  );
}

export function parsePusdUnits(
  amount: Decimal.Value,
  rounding: Decimal.Rounding = Decimal.ROUND_CEIL
): bigint {
  return decimalToPusdRaw(amount, rounding);
}

export function parseApprovalAmountRaw(amount?: string): bigint {
  return parsePusdUnits(normalizeApprovalAmount(amount), Decimal.ROUND_DOWN);
}

export function calculateBuyOrderNotional(args: {
  orderType?: string;
  amount?: number;
  size: number;
  price: number;
}): Decimal {
  if (isMarketOrderType(args.orderType)) {
    if (args.amount == null) {
      throw new Error("BUY market orders require a notional amount");
    }
    return new Decimal(args.amount);
  }

  return new Decimal(args.price).mul(args.size);
}

export function calculateReservedBuyPusdRaw(
  openOrders: readonly ClobOpenOrderLike[]
): bigint {
  let reservedPusd = BigInt(0);

  for (const order of openOrders) {
    if (order?.side !== "BUY") continue;
    const price = new Decimal(order.price ?? 0);
    const remaining = new Decimal(order.original_size ?? 0).sub(
      order.size_matched ?? 0
    );
    if (!price.isFinite() || !remaining.isFinite() || remaining.lte(0)) {
      continue;
    }
    reservedPusd += parsePusdUnits(price.mul(remaining));
  }

  return reservedPusd;
}

export function formatConditionalShares(raw: bigint): string {
  return new Decimal(raw.toString())
    .div(new Decimal(10).pow(CONDITIONAL_TOKEN_DECIMALS))
    .toDecimalPlaces(CLOB_SIZE_DECIMALS)
    .toFixed();
}

export function getClobSellSizeRaw(size: Decimal.Value): bigint {
  const roundedSize = new Decimal(size).toDecimalPlaces(
    CLOB_SIZE_DECIMALS,
    Decimal.ROUND_DOWN
  );
  return parsePusdUnits(roundedSize, Decimal.ROUND_DOWN);
}

export function estimateFallbackFeeRaw(amount: bigint): bigint {
  return (amount * BigInt(300)) / BigInt(10_000);
}

function normalizeOpenOrders(
  openOrders: unknown
): readonly ClobOpenOrderLike[] {
  return Array.isArray(openOrders)
    ? (openOrders as readonly ClobOpenOrderLike[])
    : [];
}

export async function buildClobOrderPreflightPlan(
  input: ClobOrderPreflightPlanInput
): Promise<ClobOrderPreflightPlan> {
  const plan: ClobOrderPreflightPlan = {
    side: input.side,
    orderType: input.orderType,
    isMarketOrder: isMarketOrderType(input.orderType),
    buy: null,
    sell: null,
  };

  if (input.side === "SELL") {
    plan.sell = {
      requiredConditionalRaw: getClobSellSizeRaw(input.size),
    };
    return plan;
  }

  if (input.side !== "BUY") return plan;

  const requiredNotional = calculateBuyOrderNotional({
    orderType: input.orderType,
    amount: input.amount,
    size: input.size,
    price: input.price,
  });
  const requiredPusdRaw = parsePusdUnits(requiredNotional);

  let reservedPusdRaw = BigInt(0);
  if (input.openOrders !== undefined) {
    reservedPusdRaw = calculateReservedBuyPusdRaw(
      normalizeOpenOrders(input.openOrders)
    );
  } else if (input.getOpenOrders) {
    try {
      reservedPusdRaw = calculateReservedBuyPusdRaw(
        normalizeOpenOrders(await input.getOpenOrders())
      );
    } catch (err) {
      input.onOpenOrdersError?.(err);
    }
  }

  const estimatedFeeRaw =
    input.estimatedFeeRaw !== undefined
      ? input.estimatedFeeRaw
      : await estimateBuyTakerFeeRaw(
          input.marketInfoClient ?? {},
          input.conditionId,
          input.size,
          input.price,
          requiredNotional,
          {
            builderCode: input.builderCode,
            getBuilderFeeRates: input.getBuilderFeeRates,
            isMarketableBuy: input.isMarketableBuy,
            onError: input.onFeeError,
          }
        );
  const feeRequirementRaw =
    estimatedFeeRaw ?? estimateFallbackFeeRaw(requiredPusdRaw);

  plan.buy = {
    requiredNotional,
    requiredPusdRaw,
    reservedPusdRaw,
    estimatedFeeRaw,
    feeRequirementRaw,
    requiredCollateralRaw: requiredPusdRaw + feeRequirementRaw,
  };

  return plan;
}

export function planPusdAutoWrap(
  input: PusdAutoWrapPlanInput
): PusdAutoWrapPlan {
  const requiredPusdRaw = input.requiredPusdRaw;
  const reservedPusdRaw = input.reservedPusdRaw ?? BigInt(0);
  const availablePusdRaw =
    input.pusdBalanceRaw > reservedPusdRaw
      ? input.pusdBalanceRaw - reservedPusdRaw
      : BigInt(0);
  const feeRequirementRaw =
    input.estimatedFeeRaw ?? estimateFallbackFeeRaw(requiredPusdRaw);
  const targetPusdRaw = requiredPusdRaw + feeRequirementRaw;
  const shortfallRaw =
    targetPusdRaw > availablePusdRaw
      ? targetPusdRaw - availablePusdRaw
      : BigInt(0);
  const baseShortfallRaw =
    requiredPusdRaw > availablePusdRaw
      ? requiredPusdRaw - availablePusdRaw
      : BigInt(0);
  const hasEnoughBaseCollateral = input.usdcEBalanceRaw >= baseShortfallRaw;
  const wrapAmountRaw =
    input.usdcEBalanceRaw < shortfallRaw ? input.usdcEBalanceRaw : shortfallRaw;

  return {
    requiredPusdRaw,
    reservedPusdRaw,
    availablePusdRaw,
    feeRequirementRaw,
    targetPusdRaw,
    shortfallRaw,
    baseShortfallRaw,
    wrapAmountRaw,
    needsWrap: shortfallRaw > BigInt(0),
    hasEnoughBaseCollateral,
  };
}

export function buildPusdAutoWrapTransactions(
  recipient: Address,
  wrapAmountRaw: bigint
): PusdAutoWrapTransaction[] {
  if (wrapAmountRaw <= BigInt(0)) return [];

  return [
    {
      to: USDC_E_ADDRESS as Address,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [COLLATERAL_ONRAMP_ADDRESS as Address, wrapAmountRaw],
      }),
      value: "0",
    },
    {
      to: COLLATERAL_ONRAMP_ADDRESS as Address,
      data: encodeFunctionData({
        abi: COLLATERAL_ONRAMP_ABI,
        functionName: "wrap",
        args: [USDC_E_ADDRESS as Address, recipient, wrapAmountRaw],
      }),
      value: "0",
    },
  ];
}

export async function estimateBuyTakerFeeRaw(
  client: ClobMarketInfoClient,
  conditionId: string | undefined,
  size: number,
  price: number,
  notional: Decimal.Value,
  options?: {
    builderCode?: string;
    getBuilderFeeRates?: (
      builderCode: string
    ) => Promise<{ maker: number; taker: number }>;
    /**
     * `false` → order will rest as a maker, use the maker rate.
     * `true` or omitted → order will execute as a taker (or marketability is
     * unknown), use the taker rate.
     */
    isMarketableBuy?: boolean;
    onError?: (error: unknown) => void;
  }
): Promise<bigint | null> {
  if (!conditionId || typeof client.getClobMarketInfo !== "function") {
    return null;
  }

  try {
    const info = await client.getClobMarketInfo(conditionId);
    const shares = new Decimal(size);
    const notionalDecimal = new Decimal(notional);
    const effectivePrice =
      price > 0 ? new Decimal(price) : notionalDecimal.div(shares);
    if (
      !shares.isFinite() ||
      shares.lte(0) ||
      !effectivePrice.isFinite() ||
      effectivePrice.lte(0) ||
      effectivePrice.gte(1)
    ) {
      return BigInt(0);
    }

    const { rate: protocolRate, exponent: protocolExponent } =
      parseProtocolFeeDetails(info);
    const priceCurve = effectivePrice
      .mul(new Decimal(1).sub(effectivePrice))
      .pow(protocolExponent);
    const protocolFee = shares
      .mul(protocolRate)
      .mul(priceCurve)
      .toDecimalPlaces(PROTOCOL_FEE_DECIMALS, Decimal.ROUND_HALF_UP);
    // Pick the side-appropriate builder rate. The CLOB's balance check uses
    // whichever rate the order will actually incur — taker for marketable
    // BUYs, maker for resting limits. Default to taker when marketability
    // is unknown (it's typically the higher rate, so the safer over-reserve).
    let builderFeeRate: Decimal;
    if (options?.builderCode && options.getBuilderFeeRates) {
      const rates = await options.getBuilderFeeRates(options.builderCode);
      const useMaker = options.isMarketableBuy === false;
      builderFeeRate = new Decimal(useMaker ? rates.maker : rates.taker);
    } else {
      builderFeeRate = parseBuilderTakerFeeRate(info);
    }
    const builderFee = notionalDecimal.mul(builderFeeRate);
    return parsePusdUnits(Decimal.max(0, protocolFee.plus(builderFee)));
  } catch (error) {
    options?.onError?.(error);
    return null;
  }
}
