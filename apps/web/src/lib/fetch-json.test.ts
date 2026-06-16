import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson } from "./fetch-json";

afterEach(() => vi.unstubAllGlobals());

describe("fetchJson", () => {
  it("returns parsed JSON on ok responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"a":1}', { status: 200 }))
    );
    await expect(fetchJson<{ a: number }>("/api/x")).resolves.toEqual({ a: 1 });
  });

  it("throws a descriptive error on non-ok responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"error":"nope"}', { status: 502 }))
    );
    await expect(fetchJson("/api/x")).rejects.toThrow(
      "/api/x failed (502): nope"
    );
  });

  it("throws the envelope error when success is false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response('{"success":false,"error":"bad"}', { status: 200 })
      )
    );
    await expect(fetchJson("/api/x")).rejects.toThrow("bad");
  });

  it("passes through success envelopes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response('{"success":true,"tags":[]}', { status: 200 })
      )
    );
    await expect(fetchJson("/api/x")).resolves.toEqual({
      success: true,
      tags: [],
    });
  });
});
