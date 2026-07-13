import { Decimal } from "decimal.js";

export type PortfolioFundAction = "deposit" | "withdraw";

export interface PortfolioFundIntentInput {
  action: PortfolioFundAction;
  address: string;
  walletMode?: string;
  amount: string;
  destination?: string;
  chainId?: string;
  tokenSymbol?: string;
  tokenAddress?: string;
  tokenDecimals?: number;
  chainKey?: string;
  tokenId?: string;
}

function normalizeAmount(amount: string): string {
  const value = new Decimal(amount.trim());
  if (!value.isFinite() || value.lte(0)) {
    throw new Error("Fund amount must be greater than zero");
  }
  return value.toFixed();
}

function normalizeAddressLike(value?: string): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  return /^0x[0-9a-f]{40}$/i.test(normalized)
    ? normalized.toLowerCase()
    : normalized;
}

export function fingerprintPortfolioFundIntent(
  input: PortfolioFundIntentInput
): string {
  return JSON.stringify({
    action: input.action,
    address: input.address.trim().toLowerCase(),
    walletMode: input.walletMode?.trim().toLowerCase() || "deposit",
    amount: normalizeAmount(input.amount),
    destination: normalizeAddressLike(input.destination),
    chainId: input.chainId?.trim() || null,
    tokenSymbol: input.tokenSymbol?.trim() || null,
    tokenAddress: normalizeAddressLike(input.tokenAddress),
    tokenDecimals:
      typeof input.tokenDecimals === "number" &&
      Number.isInteger(input.tokenDecimals)
        ? input.tokenDecimals
        : null,
    chainKey: input.chainKey?.trim().toLowerCase() || null,
    tokenId: input.tokenId?.trim().toLowerCase() || null,
  });
}

export function isPortfolioFundIdempotencyKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  );
}
