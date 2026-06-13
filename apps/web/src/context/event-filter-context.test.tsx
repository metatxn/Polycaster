import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { EventFilterProvider, useEventFilters } from "./event-filter-context";

function wrapper({ children }: { children: ReactNode }) {
  return <EventFilterProvider>{children}</EventFilterProvider>;
}

describe("EventFilterProvider", () => {
  it("maps ended-only status to the closed events query", () => {
    const { result } = renderHook(() => useEventFilters(), { wrapper });

    act(() => {
      result.current.setStatus(["ended"]);
    });

    expect(result.current.apiQueryParams.closed).toBe(true);
  });

  it("keeps tag filters singular because the events query accepts one tag_slug", () => {
    const { result } = renderHook(() => useEventFilters(), { wrapper });

    act(() => {
      result.current.setTagSlugs(["german-elections", "legislation"]);
    });

    expect(result.current.filters.tagSlugs).toEqual(["legislation"]);
    expect(result.current.apiQueryParams.tagSlug).toBe("legislation");
  });
});
