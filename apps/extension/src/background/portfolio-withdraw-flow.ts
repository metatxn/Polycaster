import {
  buildBridgeTokenIndex,
  type DepositStatus,
  type DepositStatusTone,
  type DepositTransaction,
  getDepositStatusDisplay,
  getWithdrawExecutionRoute,
  POLYGON_BRIDGE_CHAIN_ID,
  type QuoteRequest,
  type QuoteResponse,
  type SupportedAsset,
  validateWithdrawBridgeDestination,
  type WithdrawExecutionRouteKind,
  type WithdrawTokenId,
} from "@knoww/shared-types/bridge";
import { PUSD_ADDRESS, PUSD_DECIMALS } from "@knoww/shared-types/contracts";
import Decimal from "decimal.js";
import { parseUnits } from "viem";

export interface PortfolioWithdrawDestination {
  routeKind: WithdrawExecutionRouteKind;
  chainKey: string;
  tokenId: WithdrawTokenId;
  toChainId: string;
  toTokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
}

export interface PortfolioWithdrawQuoteDraft {
  request: QuoteRequest;
  destination: PortfolioWithdrawDestination;
}

export interface PortfolioBridgeStatusSummary {
  status: DepositStatus | "WAITING";
  text: string;
  tone: DepositStatusTone;
  completed: boolean;
  failed: boolean;
  txHash?: string;
  fromTokenAddress?: string;
  fromAmountBaseUnit?: string;
  toChainId?: string;
  toTokenAddress?: string;
}

export function formatPortfolioTokenBaseUnitAmount(
  baseUnit: string,
  decimals: number
): string {
  try {
    const value = new Decimal(baseUnit || "0").div(
      new Decimal(10).pow(decimals)
    );
    if (!value.isFinite() || value.eq(0)) return "0";
    return value
      .toDecimalPlaces(Math.min(Math.max(decimals, 2), 8), Decimal.ROUND_DOWN)
      .toFixed()
      .replace(/(\.\d*?)0+$/, "$1")
      .replace(/\.$/, "");
  } catch {
    return "0";
  }
}

export function resolvePortfolioWithdrawDestination(input: {
  supportedAssets: SupportedAsset[];
  chainKey?: string;
  tokenId?: string;
}): PortfolioWithdrawDestination {
  const chainKey = input.chainKey || "polygon";
  const tokenId = (input.tokenId as WithdrawTokenId) || "usdc-e";
  const index = buildBridgeTokenIndex(input.supportedAssets);
  const route = getWithdrawExecutionRoute({
    bridgeTokenIndex: index,
    chainKey,
    tokenId,
  });
  validateWithdrawBridgeDestination({
    routeKind: route.kind,
    toTokenAddress: route.tokenAddress,
  });

  return {
    routeKind: route.kind,
    chainKey,
    tokenId,
    toChainId: route.toChainId,
    toTokenAddress: route.tokenAddress,
    tokenSymbol: route.tokenSymbol,
    tokenDecimals: route.tokenDecimals,
  };
}

export function validatePortfolioWithdrawBridgeAddress(input: {
  routeKind?: WithdrawExecutionRouteKind;
  bridgeAddress: string;
  recipientAddress: string;
  sourceAddress: string;
}): void {
  validateWithdrawBridgeDestination(input);
}

export function buildPortfolioWithdrawQuoteRequest(input: {
  amount: string;
  chainKey?: string;
  tokenId?: string;
  recipientAddress: string;
  supportedAssets: SupportedAsset[];
}): PortfolioWithdrawQuoteDraft {
  const amountRaw = parseUnits(input.amount, PUSD_DECIMALS);
  if (amountRaw <= 0n) throw new Error("Enter an amount greater than zero.");

  const destination = resolvePortfolioWithdrawDestination({
    supportedAssets: input.supportedAssets,
    chainKey: input.chainKey,
    tokenId: input.tokenId,
  });

  return {
    destination,
    request: {
      fromAmountBaseUnit: amountRaw.toString(),
      fromChainId: POLYGON_BRIDGE_CHAIN_ID,
      fromTokenAddress: PUSD_ADDRESS,
      recipientAddress: input.recipientAddress,
      toChainId: destination.toChainId,
      toTokenAddress: destination.toTokenAddress,
    },
  };
}

export function buildPortfolioDirectWithdrawQuote(input: {
  amount: string;
  destination: PortfolioWithdrawDestination;
}): QuoteResponse {
  const amountRaw = parseUnits(input.amount, input.destination.tokenDecimals);
  const amountUsd = new Decimal(input.amount || "0");

  return {
    estCheckoutTimeMs: 27_000,
    estFeeBreakdown: {
      appFeeLabel: "Direct transfer",
      appFeePercent: 0,
      appFeeUsd: 0,
      fillCostPercent: 0,
      fillCostUsd: 0,
      gasUsd: 0,
      maxSlippage: 0,
      minReceived: amountUsd.toNumber(),
      swapImpact: 0,
      swapImpactUsd: 0,
      totalImpact: 0,
      totalImpactUsd: 0,
    },
    estInputUsd: amountUsd.toNumber(),
    estOutputUsd: amountUsd.toNumber(),
    estToTokenBaseUnit: amountRaw.toString(),
    quoteId: "direct",
  };
}

export function summarizePortfolioBridgeStatus(
  transactions: DepositTransaction[]
): PortfolioBridgeStatusSummary {
  if (transactions.length === 0) {
    return {
      status: "WAITING",
      text: "Waiting for bridge",
      tone: "info",
      completed: false,
      failed: false,
    };
  }

  const latest = transactions
    .map((transaction, index) => ({ transaction, index }))
    .reduce((current, next) => {
      const currentTime = current.transaction.createdTimeMs ?? current.index;
      const nextTime = next.transaction.createdTimeMs ?? next.index;
      return nextTime >= currentTime ? next : current;
    }).transaction;
  const display = getDepositStatusDisplay(latest.status);

  return {
    status: latest.status,
    text: display.text,
    tone: display.tone,
    completed: latest.status === "COMPLETED",
    failed: latest.status === "FAILED",
    fromTokenAddress: latest.fromTokenAddress,
    fromAmountBaseUnit: latest.fromAmountBaseUnit,
    toChainId: latest.toChainId,
    toTokenAddress: latest.toTokenAddress,
    ...(latest.txHash ? { txHash: latest.txHash } : {}),
  };
}
