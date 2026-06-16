"use client";

import { useCallback, useMemo } from "react";
import { useProxyWallet } from "@/hooks/use-proxy-wallet";
import { type Position, useUserPositions } from "@/hooks/use-user-positions";
import type { EventMarket } from "./types";

export function useMarketPositionLookup(): {
  tradingAddress: string | undefined;
  getMarketPositions: (market: EventMarket) => Position[];
} {
  const { proxyAddress, isDeployed: hasProxyWallet } = useProxyWallet();
  const tradingAddress =
    hasProxyWallet && proxyAddress ? proxyAddress : undefined;
  const { data: positionsData } = useUserPositions({
    userAddress: tradingAddress,
    enabled: !!tradingAddress,
  });

  const { positionsByConditionId, positionsByAsset } = useMemo(() => {
    const byConditionId = new Map<string, Position[]>();
    const byAsset = new Map<string, Position[]>();

    for (const position of positionsData?.positions ?? []) {
      if (position.conditionId) {
        const existing = byConditionId.get(position.conditionId) ?? [];
        existing.push(position);
        byConditionId.set(position.conditionId, existing);
      }
      if (position.asset) {
        const existing = byAsset.get(position.asset) ?? [];
        existing.push(position);
        byAsset.set(position.asset, existing);
      }
    }

    return { positionsByConditionId: byConditionId, positionsByAsset: byAsset };
  }, [positionsData?.positions]);

  const getMarketPositions = useCallback(
    (market: EventMarket): Position[] => {
      const seen = new Set<string>();
      const results: Position[] = [];
      const addPositions = (positions: Position[] | undefined) => {
        for (const position of positions ?? []) {
          if (seen.has(position.id)) continue;
          seen.add(position.id);
          results.push(position);
        }
      };

      if (market.conditionId) {
        addPositions(positionsByConditionId.get(market.conditionId));
      }
      for (const tokenId of market.clobTokenIds ?? []) {
        if (tokenId) addPositions(positionsByAsset.get(tokenId));
      }

      return results;
    },
    [positionsByAsset, positionsByConditionId]
  );

  return { tradingAddress, getMarketPositions };
}
