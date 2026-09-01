import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const outputPath = fileURLToPath(
  new URL("../cloudflare-env.d.ts", import.meta.url)
);
const result = spawnSync("wrangler", ["types", "./cloudflare-env.d.ts"], {
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const generatedTypes = readFileSync(outputPath, "utf8");
const normalizedTypes = generatedTypes.replace(/[\t ]+(?=\r?$)/gm, "");

if (normalizedTypes !== generatedTypes) {
  writeFileSync(outputPath, normalizedTypes);
}
