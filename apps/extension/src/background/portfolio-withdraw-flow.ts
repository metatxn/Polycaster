import {
  buildBridgeTokenIndex,
  type DepositStatus,
  type DepositStatusTone,
  type DepositTransaction,
  getDepositStatusDisplay,
  POLYGON_BRIDGE_CHAIN_ID,
  type QuoteRequest,
  resolveDestTokenAddress,
  type SupportedAsset,
  validateWithdrawBridgeDestination,
  WITHDRAW_CHAIN_IDS,
  WITHDRAW_TOKEN_CONFIGS,
  type WithdrawTokenId,
} from "@knoww/shared-types/bridge";
import { PUSD_ADDRESS, PUSD_DECIMALS } from "@knoww/shared-types/contracts";
import { parseUnits } from "viem";

export interface PortfolioWithdrawDestination {
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

export function resolvePortfolioWithdrawDestination(input: {
  supportedAssets: SupportedAsset[];
  chainKey?: string;
  tokenId?: string;
}): PortfolioWithdrawDestination {
  const chainKey = input.chainKey || "polygon";
  const toChainId = WITHDRAW_CHAIN_IDS[chainKey] ?? POLYGON_BRIDGE_CHAIN_ID;
  const tokenId = (input.tokenId as WithdrawTokenId) || "usdc-e";
  const tokenConfig = WITHDRAW_TOKEN_CONFIGS[tokenId];
  if (!tokenConfig) {
    throw new Error("That token isn't available on the selected chain.");
  }

  const index = buildBridgeTokenIndex(input.supportedAssets);
  const toTokenAddress =
    resolveDestTokenAddress(index, toChainId, tokenId) ||
    (toChainId === POLYGON_BRIDGE_CHAIN_ID ? tokenConfig.address : "");
  if (!toTokenAddress) {
    throw new Error("That token isn't available on the selected chain.");
  }
  validateWithdrawBridgeDestination({ toTokenAddress });

  return {
    chainKey,
    tokenId,
    toChainId,
    toTokenAddress,
    tokenSymbol: tokenConfig.symbol,
    tokenDecimals: tokenConfig.decimals,
  };
}

export function validatePortfolioWithdrawBridgeAddress(input: {
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
