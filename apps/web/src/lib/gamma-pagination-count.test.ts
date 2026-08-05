import { describe, expect, it, vi } from "vitest";
import {
  buildPaginationCountParams,
  fetchGammaPaginationTotal,
} from "./gamma-pagination-count";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function paginationBody(totalResults: unknown) {
  return { data: [], pagination: { hasMore: true, totalResults } };
}

describe("buildPaginationCountParams", () => {
  it("always sends closed=false, active=true and limit=1", () => {
    const params = buildPaginationCountParams({ tagSlug: "soccer" });
    expect(params.get("closed")).toBe("false");
    expect(params.get("active")).toBe("true");
    expect(params.get("limit")).toBe("1");
    expect(params.get("tag_slug")).toBe("soccer");
  });

  it("never emits a live parameter for scheduled baselines", () => {
    const params = buildPaginationCountParams({
      tagSlug: "epl",
      startTimeMin: "2026-07-30T00:00:00.000Z",
    });
    expect(params.get("live")).toBeNull();
    expect(params.get("start_time_min")).toBe("2026-07-30T00:00:00.000Z");
  });

  it("emits live=true only for the explicit live baseline", () => {
    const params = buildPaginationCountParams({
      tagSlug: "sports",
      live: true,
    });
    expect(params.get("live")).toBe("true");
  });

  it("prefers series_id over tag_slug when both are configured", () => {
    const params = buildPaginationCountParams({
      tagSlug: "nba",
      seriesId: 10345,
    });
    expect(params.get("series_id")).toBe("10345");
    expect(params.get("tag_slug")).toBeNull();
  });
});

describe("fetchGammaPaginationTotal", () => {
  it("returns the validated total from pagination.totalResults", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(paginationBody(731)));
    const result = await fetchGammaPaginationTotal(
      { tagSlug: "epl" },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );

    expect(result).toEqual({ ok: true, total: 731 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toContain("/events/pagination?");
    expect(url).toContain("limit=1");
    expect(url).toContain("tag_slug=epl");
    expect(init.cache).toBe("no-store");
  });

  it("treats zero as a valid count, not a failure", async () => {
    const fetchImpl = async () => jsonResponse(paginationBody(0));
    await expect(
      fetchGammaPaginationTotal(
        { tagSlug: "kbo" },
        { fetchImpl: fetchImpl as unknown as typeof fetch }
      )
    ).resolves.toEqual({ ok: true, total: 0 });
  });

  it("accepts numeric-string totals", async () => {
    const fetchImpl = async () => jsonResponse(paginationBody("42"));
    await expect(
      fetchGammaPaginationTotal(
        { tagSlug: "nba" },
        { fetchImpl: fetchImpl as unknown as typeof fetch }
      )
    ).resolves.toEqual({ ok: true, total: 42 });
  });

  it("reports HTTP failures with their status", async () => {
    const fetchImpl = async () => jsonResponse({ error: "boom" }, 502);
    await expect(
      fetchGammaPaginationTotal(
        { tagSlug: "nba" },
        { fetchImpl: fetchImpl as unknown as typeof fetch }
      )
    ).resolves.toEqual({ ok: false, reason: "http_error", status: 502 });
  });

  it("reports non-JSON bodies as schema_invalid", async () => {
    const fetchImpl = async () => new Response("<html>rate limited</html>");
    await expect(
      fetchGammaPaginationTotal(
        { tagSlug: "nba" },
        { fetchImpl: fetchImpl as unknown as typeof fetch }
      )
    ).resolves.toEqual({ ok: false, reason: "schema_invalid" });
  });

  it.each([
    ["missing pagination", {}],
    ["missing totalResults", { pagination: {} }],
    ["negative", paginationBody(-1)],
    ["non-integer", paginationBody(3.5)],
    ["non-numeric string", paginationBody("lots")],
  ])("rejects %s payloads as schema_invalid", async (_label, body) => {
    const fetchImpl = async () => jsonResponse(body);
    await expect(
      fetchGammaPaginationTotal(
        { tagSlug: "nba" },
        { fetchImpl: fetchImpl as unknown as typeof fetch }
      )
    ).resolves.toEqual({ ok: false, reason: "schema_invalid" });
  });

  it.each(["TimeoutError", "AbortError"])(
    "maps %s rejections to a timeout failure",
    async (name) => {
      const error = new Error("aborted");
      error.name = name;
      const fetchImpl = async () => {
        throw error;
      };
      await expect(
        fetchGammaPaginationTotal(
          { tagSlug: "nba" },
          { fetchImpl: fetchImpl as unknown as typeof fetch }
        )
      ).resolves.toEqual({ ok: false, reason: "timeout" });
    }
  );

  it("maps other rejections to network_error", async () => {
    const fetchImpl = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(
      fetchGammaPaginationTotal(
        { tagSlug: "nba" },
        { fetchImpl: fetchImpl as unknown as typeof fetch }
      )
    ).resolves.toEqual({ ok: false, reason: "network_error" });
  });
});
