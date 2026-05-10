import Decimal from "decimal.js";
import type {
  ExecutionAdapter,
  LiveOrderRequest,
  PaperFill,
  PaperOrderRequest,
  RiskInput,
  RiskResult,
} from "./types.ts";

const DECIMAL_PLACES = 6;

function decimal(value: string): Decimal {
  return new Decimal(value || "0");
}

function format(value: Decimal): string {
  return value.toDecimalPlaces(DECIMAL_PLACES).toString();
}

export function evaluateRisk(input: RiskInput): RiskResult {
  if (input.action === "HOLD") {
    return {
      approved: false,
      reason: "Decision is HOLD.",
      cappedSizeUsd: "0",
    };
  }

  const requested = decimal(input.requestedSizeUsd);
  const price = decimal(input.price);
  const availableLiquidity = decimal(input.availableLiquidityUsd);
  const cash = decimal(input.portfolio.cashUsd);
  const maxTrade = decimal(input.portfolio.maxTradeUsd);
  const maxPosition = decimal(input.portfolio.maxPositionUsd);
  const bankroll = decimal(input.portfolio.bankrollUsd);
  const realizedPnl = decimal(input.portfolio.realizedPnlUsd);
  const maxDrawdownPct = decimal(input.portfolio.maxDrawdownPct);

  if (price.lte(0) || price.gte(1)) {
    return {
      approved: false,
      reason: "Price is outside the tradable probability range.",
      cappedSizeUsd: "0",
    };
  }

  if (availableLiquidity.lt(requested)) {
    return {
      approved: false,
      reason: "Insufficient liquidity for requested paper order.",
      cappedSizeUsd: "0",
    };
  }

  if (cash.lt(requested)) {
    return {
      approved: false,
      reason: "Insufficient paper cash.",
      cappedSizeUsd: "0",
    };
  }

  const drawdownLimit = bankroll.mul(maxDrawdownPct).neg();
  if (realizedPnl.lte(drawdownLimit)) {
    return {
      approved: false,
      reason: "Maximum drawdown stop is active.",
      cappedSizeUsd: "0",
    };
  }

  const capped = Decimal.min(requested, maxTrade, maxPosition);
  if (capped.lte(0)) {
    return {
      approved: false,
      reason: "Risk limits reduce the trade size to zero.",
      cappedSizeUsd: "0",
    };
  }

  return {
    approved: true,
    reason: "Risk checks passed.",
    cappedSizeUsd: format(capped),
  };
}

export class PaperExecutionAdapter implements ExecutionAdapter {
  readonly mode = "paper" as const;

  async execute(request: PaperOrderRequest): Promise<PaperFill> {
    const risk = evaluateRisk(request);
    const createdAt = new Date().toISOString();

    if (!risk.approved) {
      return {
        id: crypto.randomUUID(),
        runId: request.runId,
        watchlistItemId: request.watchlistItemId,
        tokenId: request.tokenId,
        status: "BLOCKED",
        side: request.action,
        price: request.price,
        notionalUsd: "0",
        shares: "0",
        cashAfterUsd: request.portfolio.cashUsd,
        reason: risk.reason,
        createdAt,
      };
    }

    const notional = decimal(risk.cappedSizeUsd);
    const price = decimal(request.price);
    const shares = notional.div(price);
    const cashAfter = decimal(request.portfolio.cashUsd).sub(notional);

    return {
      id: crypto.randomUUID(),
      runId: request.runId,
      watchlistItemId: request.watchlistItemId,
      tokenId: request.tokenId,
      status: "FILLED",
      side: request.action,
      price: request.price,
      notionalUsd: format(notional),
      shares: format(shares),
      cashAfterUsd: format(cashAfter),
      createdAt,
    };
  }

  async submitLiveOrder(_request: unknown): Promise<never> {
    throw new Error("Live execution is disabled for the paper trading agent.");
  }
}

export function validateLiveOrderPreconditions(
  request: Partial<LiveOrderRequest>
): LiveOrderRequest {
  if (!request.idempotencyKey) {
    throw new Error("Live execution requires an idempotency key.");
  }
  if (!request.killSwitchEnabled) {
    throw new Error("Live execution requires an enabled kill switch.");
  }
  if (!request.maxPositionUsd || !request.maxOrderUsd) {
    throw new Error("Live execution requires explicit position limits.");
  }
  if (
    request.orderIndicator !== "manual" &&
    request.orderIndicator !== "automatic"
  ) {
    throw new Error("Live execution requires an order indicator.");
  }
  if (
    request.walletSigningIsolation !== "server-isolated" &&
    request.walletSigningIsolation !== "hardware-isolated"
  ) {
    throw new Error("Live execution requires wallet signing isolation.");
  }
  return request as LiveOrderRequest;
}

export class LiveExecutionAdapter implements ExecutionAdapter {
  readonly mode = "live" as const;

  async execute(_request: PaperOrderRequest): Promise<never> {
    throw new Error("Live execution is disabled for the paper trading agent.");
  }

  async submitLiveOrder(request: unknown): Promise<never> {
    validateLiveOrderPreconditions(request as Partial<LiveOrderRequest>);
    throw new Error("Live execution is disabled for the paper trading agent.");
  }
}
