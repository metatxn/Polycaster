import { useQuery } from "@tanstack/react-query";

interface Team {
  id: number;
  name: string;
  league?: string;
  record?: string;
  logo?: string;
  abbreviation?: string;
  alias?: string;
}

interface TeamsResponse {
  success: boolean;
  count: number;
  teams: Team[];
  error?: string;
}

interface UseTeamsOptions {
  league?: string;
  name?: string;
  abbreviation?: string;
  limit?: number;
}

export function useTeams(options: UseTeamsOptions = {}) {
  const { league, name, abbreviation, limit = 100 } = options;

  return useQuery({
    queryKey: ["teams", { league, name, abbreviation, limit }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limit", limit.toString());

      if (league) params.set("league", league);
      if (name) params.set("name", name);
      if (abbreviation) params.set("abbreviation", abbreviation);

      const response = await fetch(`/api/sports/teams?${params.toString()}`);

      if (!response.ok) {
        throw new Error("Failed to fetch teams");
      }

      const data: TeamsResponse = await response.json();

      if (!data.success) {
        throw new Error(data.error || "Failed to fetch teams");
      }

      return data;
    },
    staleTime: 3600 * 1000, // 1 hour - teams rarely change
  });
}
