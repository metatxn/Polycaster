import Decimal from "decimal.js";

export interface UserPositionSummaryInput {
  currentValue?: number | null;
  cashPnl?: number | null;
  realizedPnl?: number | null;
}

export function sumPositionField(
  positions: UserPositionSummaryInput[],
  field: keyof UserPositionSummaryInput
): number {
  return positions
    .reduce((sum, position) => {
      const value = position[field];
      return sum.plus(value ?? 0);
    }, new Decimal(0))
    .toNumber();
}

export function summarizeUserPositions(positions: UserPositionSummaryInput[]): {
  totalValue: number;
  totalUnrealizedPnl: number;
  totalRealizedPnl: number;
  totalPnl: number;
  positionCount: number;
} {
  const totalValue = sumPositionField(positions, "currentValue");
  const totalUnrealizedPnl = sumPositionField(positions, "cashPnl");
  const totalRealizedPnl = sumPositionField(positions, "realizedPnl");

  return {
    totalValue,
    totalUnrealizedPnl,
    totalRealizedPnl,
    totalPnl: new Decimal(totalUnrealizedPnl).plus(totalRealizedPnl).toNumber(),
    positionCount: positions.length,
  };
}
