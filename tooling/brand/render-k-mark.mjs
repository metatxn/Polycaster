#!/usr/bin/env node
/**
 * Render the Knoww K-mark SVG into all the raster sizes the platform
 * needs — extension toolbar icons (manifest.json), web favicons, and
 * web logo / OG / Twitter card images. Re-run this script whenever
 * `knoww-k-mark.svg` changes; the outputs are committed to the repo
 * so the build doesn't depend on sharp at install time.
 *
 * Usage:
 *   pnpm exec node tooling/brand/render-k-mark.mjs
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
// Source artwork — currently a 1024×1024 PNG of the diamond-cutout K mark.
// Was an SVG in earlier iterations; switched to the PNG once the design
// landed because the rounded corners + central diamond negative space were
// hand-crafted in raster. If we ever re-trace this to SVG, swap the path.
const SRC_ART = path.join(__dirname, "knoww-k-mark.png");

/**
 * Each entry is `[absolute output path, size in pixels]`. Sizes are
 * matched to existing filenames in the repo so the new assets drop in
 * place — manifest.json and `<link rel="icon">` references don't need
 * to change. If you add a new target, list it here so the script is
 * the one source of truth for what gets shipped.
 */
const TARGETS = [
  // Extension — Chrome toolbar + Web Store listing
  ["apps/extension/icons/icon-16.png", 16],
  ["apps/extension/icons/icon-32.png", 32],
  ["apps/extension/icons/icon-48.png", 48],
  ["apps/extension/icons/icon-128.png", 128],
  ["apps/extension/icons/icon-256.png", 256],

  // Web — favicons + open graph + apple touch
  ["apps/web/public/favicon-16x16.png", 16],
  ["apps/web/public/favicon-32x32.png", 32],
  ["apps/web/public/favicon-48x48.png", 48],
  ["apps/web/public/logo-256x256.png", 256],
  ["apps/web/public/logo-512x512.png", 512],
  ["apps/web/public/logo-1024x1024.png", 1024],
];

async function main() {
  const art = await readFile(SRC_ART);

  // Render once per size. Sharp downscales from the 1024-source via
  // lanczos3, which keeps the rounded corners and the central diamond
  // negative space crisp even at 16px favicon sizes.
  const results = await Promise.all(
    TARGETS.map(async ([rel, size]) => {
      const out = path.join(REPO_ROOT, rel);
      await sharp(art)
        .resize(size, size, { fit: "contain", kernel: "lanczos3" })
        .png({ compressionLevel: 9 })
        .toFile(out);
      return { rel, size };
    })
  );

  for (const { rel, size } of results) {
    console.log(`  ${size.toString().padStart(4, " ")}px  ${rel}`);
  }
  console.log(
    `\nrendered ${results.length} files from ${path.relative(REPO_ROOT, SRC_ART)}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
