import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name === "route.ts" ? [path] : [];
  });
}

describe("API OpenAPI annotations", () => {
  it("documents every API route handler with an OpenAPI block", () => {
    const apiRoot = join(process.cwd(), "src/app/api");
    const missing = routeFiles(apiRoot)
      .filter((file) => !readFileSync(file, "utf8").includes("@openapi"))
      .map((file) => relative(process.cwd(), file));

    expect(missing).toEqual([]);
  });
});
