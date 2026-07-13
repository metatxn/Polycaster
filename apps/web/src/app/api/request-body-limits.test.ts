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

describe("API request body limits", () => {
  it("does not parse JSON request bodies before applying a body-size cap", () => {
    const apiRoot = join(process.cwd(), "src/app/api");
    const files = [
      ...routeFiles(apiRoot),
      join(process.cwd(), "src/lib/agent/api.ts"),
    ];

    const unboundedParsers = files
      .filter((file) => readFileSync(file, "utf8").includes("request.json("))
      .map((file) => relative(process.cwd(), file));

    expect(unboundedParsers).toEqual([]);
  });
});
