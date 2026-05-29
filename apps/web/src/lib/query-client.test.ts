import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _resetBrowserQueryClientForTests,
  defaultQueryOptions,
  getQueryClient,
  makeQueryClient,
  shouldRetryQuery,
} from "./query-client";

afterEach(() => {
  _resetBrowserQueryClientForTests();
  vi.unstubAllGlobals();
});

describe("shouldRetryQuery", () => {
  describe("client errors (4xx) — never retry", () => {
    it("does not retry on a 400 Response", () => {
      expect(shouldRetryQuery(0, new Response(null, { status: 400 }))).toBe(
        false
      );
    });

    it("does not retry on a 401 Response", () => {
      expect(shouldRetryQuery(0, new Response(null, { status: 401 }))).toBe(
        false
      );
    });

    it("does not retry on a 403 Response", () => {
      expect(shouldRetryQuery(0, new Response(null, { status: 403 }))).toBe(
        false
      );
    });

    it("does not retry on a 404 Response", () => {
      expect(shouldRetryQuery(0, new Response(null, { status: 404 }))).toBe(
        false
      );
    });

    it("does not retry on a 422 Response", () => {
      expect(shouldRetryQuery(0, new Response(null, { status: 422 }))).toBe(
        false
      );
    });

    it("does not retry on an error-like object with a 4xx status", () => {
      const err = { status: 404, message: "Not Found" };
      expect(shouldRetryQuery(0, err)).toBe(false);
    });

    it("does not retry on an Error whose message includes a 4xx code", () => {
      expect(shouldRetryQuery(0, new Error("HTTP 401: Unauthorized"))).toBe(
        false
      );
      expect(
        shouldRetryQuery(0, new Error("fetch failed: 404 Not Found"))
      ).toBe(false);
    });
  });

  describe("server errors (5xx) and network errors — retry once", () => {
    it("retries once on a 500 Response", () => {
      const err = new Response(null, { status: 500 });
      expect(shouldRetryQuery(0, err)).toBe(true);
      expect(shouldRetryQuery(1, err)).toBe(false);
    });

    it("retries once on a 503 Response", () => {
      const err = new Response(null, { status: 503 });
      expect(shouldRetryQuery(0, err)).toBe(true);
      expect(shouldRetryQuery(1, err)).toBe(false);
    });

    it("retries once on a generic network Error", () => {
      const err = new TypeError("Failed to fetch");
      expect(shouldRetryQuery(0, err)).toBe(true);
      expect(shouldRetryQuery(1, err)).toBe(false);
    });

    it("retries once on a string error (unknown shape)", () => {
      expect(shouldRetryQuery(0, "ECONNRESET")).toBe(true);
      expect(shouldRetryQuery(1, "ECONNRESET")).toBe(false);
    });

    it("retries once when error is null/undefined", () => {
      expect(shouldRetryQuery(0, null)).toBe(true);
      expect(shouldRetryQuery(0, undefined)).toBe(true);
    });
  });

  describe("boundary cases", () => {
    it("treats 399 as a server-side / network error (not a client error)", () => {
      const err = new Response(null, { status: 399 });
      expect(shouldRetryQuery(0, err)).toBe(true);
    });

    it("treats 499 as the last client error in the 4xx band", () => {
      const err = new Response(null, { status: 499 });
      expect(shouldRetryQuery(0, err)).toBe(false);
    });

    it("treats 500 as the first retryable server error", () => {
      const err = new Response(null, { status: 500 });
      expect(shouldRetryQuery(0, err)).toBe(true);
    });

    it("does not extract a 4xx code from arbitrary text containing numbers", () => {
      // "200" is not a 4xx; "1000" contains no 4xx digit-run.
      expect(shouldRetryQuery(0, new Error("retry after 1000ms"))).toBe(true);
    });
  });
});

describe("defaultQueryOptions", () => {
  it("sets staleTime to 1 minute", () => {
    expect(defaultQueryOptions.queries?.staleTime).toBe(60_000);
  });

  it("sets gcTime to 30 minutes", () => {
    expect(defaultQueryOptions.queries?.gcTime).toBe(30 * 60 * 1000);
  });

  it("disables refetchOnWindowFocus", () => {
    expect(defaultQueryOptions.queries?.refetchOnWindowFocus).toBe(false);
  });

  it("disables refetchOnReconnect", () => {
    expect(defaultQueryOptions.queries?.refetchOnReconnect).toBe(false);
  });

  it("wires the shouldRetryQuery function as the retry policy", () => {
    expect(defaultQueryOptions.queries?.retry).toBe(shouldRetryQuery);
  });

  it("disables retry on mutations", () => {
    expect(defaultQueryOptions.mutations?.retry).toBe(false);
  });
});

describe("makeQueryClient", () => {
  it("creates a QueryClient instance", () => {
    const client = makeQueryClient();
    expect(client).toBeInstanceOf(QueryClient);
  });

  it("applies the default options", () => {
    const client = makeQueryClient();
    const opts = client.getDefaultOptions();
    expect(opts.queries?.staleTime).toBe(60_000);
    expect(opts.queries?.gcTime).toBe(30 * 60 * 1000);
    expect(opts.queries?.refetchOnWindowFocus).toBe(false);
    expect(opts.queries?.refetchOnReconnect).toBe(false);
    expect(opts.mutations?.retry).toBe(false);
  });

  it("returns a fresh instance each call (not a singleton)", () => {
    expect(makeQueryClient()).not.toBe(makeQueryClient());
  });
});

describe("getQueryClient", () => {
  // The default vitest jsdom env defines `window`, so we're in
  // "browser" mode here. Server-side behavior is verified by stubbing
  // window away.

  it("reuses the same instance across calls in the browser", () => {
    const a = getQueryClient();
    const b = getQueryClient();
    expect(a).toBe(b);
  });

  it("returns a fresh client per call on the server (no window)", () => {
    // vi.stubGlobal lets us pretend we're on the server for one test.
    vi.stubGlobal("window", undefined);
    const a = getQueryClient();
    const b = getQueryClient();
    expect(a).not.toBe(b);
  });

  it("does not leak the server-side fresh-instance into the browser cache", () => {
    vi.stubGlobal("window", undefined);
    const serverClient = getQueryClient();
    vi.unstubAllGlobals();
    // Restore browser mode and ask again — should be a new instance,
    // not the server one.
    const browserClient = getQueryClient();
    expect(browserClient).not.toBe(serverClient);
    // And subsequent browser calls reuse the new one.
    expect(getQueryClient()).toBe(browserClient);
  });
});
