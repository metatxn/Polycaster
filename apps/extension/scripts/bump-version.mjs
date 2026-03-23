import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const manifestPath = resolve(root, "manifest.json");
const pkgPath = resolve(root, "package.json");

const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

const bumpType = process.argv[2] || "patch"; // patch | minor | major

const oldVersion = manifest.version;
const parts = oldVersion.split(".").map(Number);

if (bumpType === "major") {
  parts[0] += 1;
  parts[1] = 0;
  parts[2] = 0;
} else if (bumpType === "minor") {
  parts[1] += 1;
  parts[2] = 0;
} else {
  parts[2] += 1;
}

const newVersion = parts.join(".");

manifest.version = newVersion;
pkg.version = newVersion;

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log(`Bumped version: ${oldVersion} → ${newVersion}`);
console.log(`  ✓ manifest.json`);
console.log(`  ✓ package.json`);
