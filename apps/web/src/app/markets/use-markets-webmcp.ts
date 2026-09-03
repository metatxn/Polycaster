import { useEffect, useRef } from "react";
import { registerWebMcpTools } from "@/lib/webmcp";
import {
  createMarketsWebMcpTools,
  type MarketsWebMcpDependencies,
  type MarketsWebMcpSnapshot,
} from "./markets-webmcp";

interface UseMarketsWebMcpOptions
  extends Omit<MarketsWebMcpDependencies, "getSnapshot"> {
  snapshot: MarketsWebMcpSnapshot | null;
}

/** Keeps one markets-page WebMCP registration wired to the latest React state. */
export function useMarketsWebMcp(options: UseMarketsWebMcpOptions): void {
  const latestRef = useRef(options);

  useEffect(() => {
    latestRef.current = options;
  }, [options]);

  useEffect(() => {
    const tools = createMarketsWebMcpTools({
      getSnapshot: () => latestRef.current.snapshot,
      applyFilters: (update) => latestRef.current.applyFilters(update),
      resetFilters: () => latestRef.current.resetFilters(),
      openEvent: (path) => latestRef.current.openEvent(path),
      loadMore: () => latestRef.current.loadMore(),
      searchEvents: (query, limit, tagSlug) =>
        latestRef.current.searchEvents(query, limit, tagSlug),
    });

    return registerWebMcpTools(tools);
  }, []);
}
