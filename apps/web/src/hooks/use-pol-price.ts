"use client";

import { useQuery } from "@tanstack/react-query";

interface PolPriceResponse {
  price: number;
  cached?: boolean;
  stale?: boolean;
  error?: string;
}

export function usePolPrice() {
  return useQuery<PolPriceResponse>({
    queryKey: ["pol-price"],
    queryFn: async () => {
      const response = await fetch("/api/price/pol");
      if (!response.ok) {
        throw new Error("Failed to fetch POL price");
      }
      return response.json();
    },
    staleTime: 5 * 60 * 1000, // Consider data stale after 5 minutes
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
    retry: 2,
  });
}
