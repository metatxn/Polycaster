import { describe, expect, it } from "vitest";
import { jsonError } from "./api-error";

describe("jsonError", () => {
  it("returns the standard envelope with the given status", async () => {
    const res = jsonError("nope", 404);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: "nope",
    });
  });
  it("merges extra headers", () => {
    const res = jsonError("slow down", 429, { "Retry-After": "30" });
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
