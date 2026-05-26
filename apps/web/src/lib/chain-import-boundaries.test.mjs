import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SRC_DIR = fileURLToPath(new URL("../", import.meta.url));
const DISALLOWED_IMPORTS = [
  '"viem/chains"',
  "'viem/chains'",
  '"@reown/appkit/networks"',
  "'@reown/appkit/networks'",
];

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (/\.(ts|tsx)$/.test(entry.name)) return [path];
    return [];
  });
}

test("web source imports app chain config instead of chain package barrels", () => {
  const offenders = sourceFiles(SRC_DIR).filter((file) => {
    const source = readFileSync(file, "utf8");
    return DISALLOWED_IMPORTS.some((specifier) => source.includes(specifier));
  });

  assert.deepEqual(offenders.map((file) => relative(SRC_DIR, file)).sort(), []);
});
