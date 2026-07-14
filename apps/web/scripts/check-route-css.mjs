import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";

const ROUTE_ENTRIES = {
  shared: ["/layout"],
  landing: ["/layout", "/page"],
  privacy: ["/layout", "/privacy/page"],
  markets: ["/layout", "/markets/layout"],
  eventDetail: ["/layout", "/events/layout"],
};

export const CSS_BUDGETS = {
  shared: 32 * 1024,
  landing: 42 * 1024,
  privacy: 35 * 1024,
  markets: 40 * 1024,
  eventDetail: 40 * 1024,
};

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function createRouteCssReport(manifest, readAsset) {
  const report = {};

  for (const [surface, entries] of Object.entries(ROUTE_ENTRIES)) {
    const assets = new Set();

    for (const entry of entries) {
      const entryAssets = manifest.pages?.[entry];
      if (!entryAssets) {
        throw new Error(`Missing ${entry} in .next/app-build-manifest.json`);
      }

      for (const asset of entryAssets) {
        if (asset.endsWith(".css")) {
          assets.add(asset);
        }
      }
    }

    const sizes = [...assets].sort().map((asset) => {
      const contents = readAsset(asset);
      if (!Buffer.isBuffer(contents)) {
        throw new Error(`Unable to read generated CSS asset ${asset}`);
      }

      return {
        asset,
        raw: contents.length,
        gzip: gzipSync(contents).length,
        brotli: brotliCompressSync(contents).length,
      };
    });

    report[surface] = {
      assets: sizes.map(({ asset }) => asset),
      raw: sizes.reduce((total, asset) => total + asset.raw, 0),
      gzip: sizes.reduce((total, asset) => total + asset.gzip, 0),
      brotli: sizes.reduce((total, asset) => total + asset.brotli, 0),
    };
  }

  return report;
}

export function assertCssBudgets(report, budgets = CSS_BUDGETS) {
  const failures = [];

  for (const [surface, budget] of Object.entries(budgets)) {
    const actual = report[surface]?.gzip;
    if (actual === undefined) {
      failures.push(`Missing CSS report for ${surface}`);
      continue;
    }

    if (actual > budget) {
      failures.push(
        `${surface} CSS is ${formatBytes(actual)} (${formatBytes(actual - budget)} over its ${formatBytes(budget)} gzip budget)`
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }
}

function formatReport(report) {
  const header = "Surface       Raw       Gzip    Brotli  Assets";
  const rows = Object.entries(report).map(([surface, sizes]) =>
    [
      surface.padEnd(12),
      formatBytes(sizes.raw).padStart(9),
      formatBytes(sizes.gzip).padStart(9),
      formatBytes(sizes.brotli).padStart(9),
      String(sizes.assets.length).padStart(7),
    ].join(" ")
  );

  return [header, ...rows].join("\n");
}

function run() {
  const nextDir = new URL("../.next/", import.meta.url);
  const manifest = JSON.parse(
    readFileSync(new URL("app-build-manifest.json", nextDir), "utf8")
  );
  const report = createRouteCssReport(manifest, (asset) =>
    readFileSync(new URL(asset, nextDir))
  );

  assertCssBudgets(report);
  process.stdout.write(`${formatReport(report)}\nCSS budgets passed.\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`CSS budget check failed:\n${message}\n`);
    process.exitCode = 1;
  }
}
