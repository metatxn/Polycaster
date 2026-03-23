import { useQuery } from "@tanstack/react-query";

interface Sport {
  tag: string;
  name: string;
  description?: string;
}

interface SportsListResponse {
  success: boolean;
  count: number;
  sports: Sport[];
  error?: string;
}

export function useSportsList() {
  return useQuery({
    queryKey: ["sports-list"],
    queryFn: async () => {
      const response = await fetch("/api/sports/list?limit=20");

      if (!response.ok) {
        throw new Error("Failed to fetch sports");
      }

      const data: SportsListResponse = await response.json();

      if (!data.success) {
        throw new Error(data.error || "Failed to fetch sports");
      }

      // Deduplicate sports by tag
      const uniqueSportsMap = new Map<string, Sport>();

      data.sports.forEach((sport) => {
        const sportData = sport as unknown as Record<string, unknown>;
        if (!sportData?.tag || typeof sportData.tag !== "string") {
          return;
        }

        const normalizedTag = sportData.tag.toLowerCase();
        if (!uniqueSportsMap.has(normalizedTag)) {
          uniqueSportsMap.set(normalizedTag, {
            tag: sportData.tag as string,
            name: (sportData.name as string) ?? (sportData.tag as string),
            description: (sportData.description as string) ?? undefined,
          });
        }
      });

      return {
        ...data,
        sports: Array.from(uniqueSportsMap.values()),
      };
    },
    staleTime: 3600 * 1000, // 1 hour - sports list rarely changes
  });
}
