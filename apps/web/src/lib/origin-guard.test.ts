import { afterEach, describe, expect, it, vi } from "vitest";

import { isAllowedOrigin } from "./origin-guard";

describe("isAllowedOrigin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows configured production origins", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOWED_ORIGIN", "");
    vi.stubEnv("ALLOWED_ORIGINS", "");

    expect(isAllowedOrigin("https://knoww.app")).toBe(true);
    expect(isAllowedOrigin("https://www.knoww.app")).toBe(true);
  });

  it("does not treat wildcard env origins as production allow-all", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOWED_ORIGIN", "");
    vi.stubEnv("ALLOWED_ORIGINS", "*");

    expect(isAllowedOrigin("https://evil.example")).toBe(false);
  });

  it("allows loopback browser origins in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOWED_ORIGIN", "");
    vi.stubEnv("ALLOWED_ORIGINS", "");

    expect(isAllowedOrigin("http://localhost:3000")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:8000")).toBe(true);
    expect(isAllowedOrigin("http://[::1]:8001")).toBe(true);
  });

  it("allows wildcard env origins only outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOWED_ORIGIN", "");
    vi.stubEnv("ALLOWED_ORIGINS", "*");

    expect(isAllowedOrigin("https://preview.example")).toBe(true);
  });
});
