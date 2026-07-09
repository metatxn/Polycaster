import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

const FORBIDDEN_VALIDATION_ERROR_PATTERNS = [
  /parsed\.error\.message/,
  /parsed\.error\.flatten\(/,
  /parsed\.error\.format\(/,
  /details:\s*parsed\.error/,
  /jsonError\([\s\S]*?parsed\.error/,
];

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === "route.ts" ? [path] : [];
  });
}

describe("API validation error responses", () => {
  it("does not expose raw validator details to clients", () => {
    const apiRoot = join(process.cwd(), "src/app/api");
    const leakingRoutes = routeFiles(apiRoot)
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return FORBIDDEN_VALIDATION_ERROR_PATTERNS.some((pattern) =>
          pattern.test(source)
        );
      })
      .map((file) => relative(process.cwd(), file));

    expect(leakingRoutes).toEqual([]);
  });
});
