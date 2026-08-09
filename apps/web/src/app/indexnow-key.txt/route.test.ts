import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("GET /indexnow-key.txt", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the configured IndexNow verification key", async () => {
    vi.stubEnv("INDEXNOW_KEY", "Abcd1234-key");

    const response = GET();

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("Abcd1234-key");
  });

  it("returns 404 when IndexNow is not configured", async () => {
    vi.stubEnv("INDEXNOW_KEY", "");

    const response = GET();

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("Not Found");
  });
});
