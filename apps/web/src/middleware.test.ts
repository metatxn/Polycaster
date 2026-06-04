import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "./middleware";

describe("middleware security headers", () => {
  it("does not emit obsolete Permissions-Policy features", () => {
    const request = new NextRequest("https://knoww.app/");
    const response = middleware(request);

    const permissionsPolicy = response.headers.get("Permissions-Policy");
    expect(permissionsPolicy).toContain("camera=()");
    expect(permissionsPolicy).toContain("microphone=()");
    expect(permissionsPolicy).toContain("geolocation=()");
    expect(permissionsPolicy).not.toContain("interest-cohort");
  });
});
