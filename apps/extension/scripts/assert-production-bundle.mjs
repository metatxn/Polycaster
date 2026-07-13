#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractStaticEsmExportNames } from "./lib/esm-contract.mjs";
import { collectEntryModules } from "./lib/stats-graph.mjs";
import { validateLazyWarContract } from "./lib/war-contract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(__dirname, "..");
const distDir = path.resolve(__dirname, "../dist");
const platformManifestPath = path.join(
  extensionDir,
  "src/content/platforms/manifest.json"
);
const routingFixturesPath = path.join(
  extensionDir,
  "src/content/platforms/routing-fixtures.json"
);
const supportedHostsPath = path.join(extensionDir, "src/supported-hosts.ts");
const classicStatsPath = path.join(distDir, ".stats/classic.json");
const esmStatsPath = path.join(distDir, ".stats/esm.json");

// Task 10 production baseline measured 2026-07-11: 281,034 bytes.
// Keep 10% headroom (ceil(281,034 * 1.10)) while preventing core regressions.
const contentJavaScriptByteBudget = 309_138;

const requiredClassicAssets = [
  "background.js",
  "content.js",
  "fonts/fraunces-italic-500.woff2",
  "fonts/jetbrains-mono-500.woff2",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
  "icons/icon-256.png",
  "knoww-inline.css",
  "manifest.json",
  "offscreen.html",
  "offscreen.js",
  "options.html",
  "options.js",
  "ort/ort-wasm-simd-threaded.asyncify.mjs",
  "ort/ort-wasm-simd-threaded.asyncify.wasm",
  "page-bridge.js",
  "sidepanel.html",
  "sidepanel.js",
  "styles.css",
];

const forbiddenPathParts = new Set([
  "perf-fixtures",
  "embedding-ab.json",
  "embedding-ab-extra.jsonl",
  "benchmark-embeddings.mjs",
  "benchmark-rerank",
]);

// Local-only artifacts that must never be copied into the shipped bundle.
// Matched against the dist-relative path (forward-slash separated).
const forbiddenPathPatterns = [
  // Anything sourced from the dev/ design-preview folder.
  /(^|\/)dev\//,
  // *preview*.html design previews, wherever they land.
  /[^/]*preview[^/]*\.html$/i,
];

const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".txt",
]);

const forbiddenContent = [
  "perf-fixtures/embedding-ab",
  "benchmark:embeddings",
  "bge-small-cls-q8",
  "snowflake-arctic-s-cls-q8",
  "bge-mean-xencoder-top5-int8",
  "snowflake-q8-xencoder-top5-int8",
  "Knoww:extension.content.log",
];

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function relativeDistPath(filePath) {
  return path.relative(distDir, filePath).split(path.sep).join("/");
}

async function fileContainsForbiddenContent(filePath) {
  if (!textExtensions.has(path.extname(filePath))) return [];
  const size = (await stat(filePath)).size;
  if (size > 8 * 1024 * 1024) return [];

  const text = await readFile(filePath, "utf8");
  return forbiddenContent.filter((marker) => text.includes(marker));
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function extractStringArray(tsSource, exportName) {
  const pattern = new RegExp(
    `export\\s+const\\s+${exportName}\\s*(?::\\s*string\\[\\])?\\s*=\\s*\\[([\\s\\S]*?)\\];`
  );
  const match = tsSource.match(pattern);
  if (!match) throw new Error(`Could not extract ${exportName}`);

  const values = [];
  for (const line of match[1].split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("//")) continue;
    const stringMatch = trimmed.match(/"([^"]+)"/);
    if (stringMatch) values.push(stringMatch[1]);
  }
  return values;
}

function matchPatternHost(pattern) {
  const match = pattern.match(/^(?:\*|https?|file|ftp):\/\/([^/]+)(?:\/.*)?$/);
  return match?.[1] ?? null;
}

function hostMatchesPattern(host, pattern, strictWildcard = false) {
  const patternHost = matchPatternHost(pattern);
  if (!patternHost) return false;
  if (!patternHost.startsWith("*.")) return host === patternHost;

  const baseHost = patternHost.slice(2);
  if (strictWildcard) {
    return host !== baseHost && host.endsWith(`.${baseHost}`);
  }
  return host === baseHost || host.endsWith(`.${baseHost}`);
}

function addSetFailures(failures, label, actualValues, expectedValues) {
  const actual = new Set(actualValues);
  const expected = new Set(expectedValues);
  for (const value of expected) {
    if (!actual.has(value)) failures.push(`${label} is missing "${value}"`);
  }
  for (const value of actual) {
    if (!expected.has(value))
      failures.push(`${label} has unexpected "${value}"`);
  }
}

function assetName(asset) {
  if (typeof asset === "string") return asset;
  return typeof asset?.name === "string" ? asset.name : null;
}

function collectNamedAssets(assets) {
  const names = [];
  for (const asset of assets ?? []) {
    const name = assetName(asset);
    if (name) names.push(name);
    for (const relatedAsset of asset?.related ?? []) {
      const relatedName = assetName(relatedAsset);
      if (relatedName) names.push(relatedName);
    }
  }
  return names;
}

function normalizeModulePath(identifier) {
  return identifier.replaceAll("\\", "/");
}

function forbiddenHeavyPackage(normalizedIdentifier) {
  return normalizedIdentifier.match(
    /(^|\/)node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(react|react-dom|react-qr-code|viem)(?:\/|$)/
  )?.[2];
}

async function main() {
  const files = await listFiles(distDir);
  const failures = [];
  let contentJavaScriptBytes = null;
  const [
    platformManifest,
    routingFixtures,
    builtManifest,
    classicStats,
    esmStats,
    supportedHostsSource,
  ] = await Promise.all([
    readJson(platformManifestPath),
    readJson(routingFixturesPath),
    readJson(path.join(distDir, "manifest.json")),
    readJson(classicStatsPath),
    readJson(esmStatsPath),
    readFile(supportedHostsPath, "utf8"),
  ]);

  if (!Array.isArray(platformManifest)) {
    throw new TypeError("Platform manifest must be an array");
  }
  if (!Array.isArray(routingFixtures)) {
    throw new TypeError("Platform routing fixtures must be an array");
  }

  const relativeFiles = files.map(relativeDistPath);
  const contentJavaScriptPath = path.join(distDir, "content.js");
  const contentTradingPath = path.join(distDir, "content-trading.js");
  try {
    const contentTradingSource = await readFile(contentTradingPath, "utf8");
    const exportNames = extractStaticEsmExportNames(contentTradingSource);
    if (exportNames.length !== 1 || exportNames[0] !== "createTradingRuntime") {
      failures.push(
        `content-trading.js static exports must be exactly ["createTradingRuntime"] (got ${JSON.stringify(exportNames)})`
      );
    }
  } catch (error) {
    failures.push(
      `content-trading.js static exports could not be parsed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  try {
    contentJavaScriptBytes = (await stat(contentJavaScriptPath)).size;
    if (contentJavaScriptBytes > contentJavaScriptByteBudget) {
      failures.push(
        `content.js is ${contentJavaScriptBytes} bytes, exceeding the ${contentJavaScriptByteBudget}-byte Task 10 baseline budget`
      );
    }
  } catch (error) {
    failures.push(
      `content.js byte size could not be measured: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  const expectedPlatformEntries = platformManifest.map(
    (entry) => `platforms/${entry.name}`
  );
  const expectedPlatformAssets = expectedPlatformEntries.map(
    (entryName) => `${entryName}.js`
  );
  const expectedEsmEntries = [...expectedPlatformEntries, "content-trading"];
  const expectedEsmAssets = [...expectedPlatformAssets, "content-trading.js"];
  const emittedPlatformAssets = relativeFiles.filter((relativePath) =>
    /^platforms\/[^/]+\.js$/.test(relativePath)
  );

  addSetFailures(
    failures,
    "emitted platform JavaScript",
    emittedPlatformAssets,
    expectedPlatformAssets
  );

  const supportedMatchPatterns = extractStringArray(
    supportedHostsSource,
    "SUPPORTED_MATCH_PATTERNS"
  );
  for (const failure of validateLazyWarContract(
    builtManifest.web_accessible_resources,
    supportedMatchPatterns
  )) {
    failures.push(`lazy WAR contract: ${failure}`);
  }
  const webAccessibleResources = Array.isArray(
    builtManifest.web_accessible_resources
  )
    ? builtManifest.web_accessible_resources
    : [];
  const platformWarEntries = webAccessibleResources.filter(
    (entry) =>
      Array.isArray(entry?.resources) &&
      entry.resources.includes("platforms/*.js")
  );

  const fixtureHosts = new Set();
  for (const fixture of routingFixtures) {
    if (
      typeof fixture?.host !== "string" ||
      typeof fixture?.expect !== "string"
    ) {
      failures.push(
        "routing fixture must contain string host and expect fields"
      );
      continue;
    }
    if (fixtureHosts.has(fixture.host)) {
      failures.push(`routing fixtures duplicate host "${fixture.host}"`);
    }
    fixtureHosts.add(fixture.host);

    const matchedEntry = platformManifest.find((entry) =>
      entry.hostPatterns.some(({ source, flags }) =>
        new RegExp(source, flags).test(fixture.host)
      )
    );
    const actual = matchedEntry?.name ?? "none";
    if (actual !== fixture.expect) {
      failures.push(
        `routing fixture "${fixture.host}" expected "${fixture.expect}" but matched "${actual}"`
      );
    }
  }

  for (const pattern of supportedMatchPatterns) {
    const patternHost = matchPatternHost(pattern);
    if (!patternHost) {
      failures.push(`unsupported SUPPORTED_MATCH_PATTERNS value "${pattern}"`);
      continue;
    }
    const strictWildcard = patternHost.startsWith("*.");
    if (
      !routingFixtures.some(
        (fixture) =>
          typeof fixture?.host === "string" &&
          hostMatchesPattern(fixture.host, pattern, strictWildcard)
      )
    ) {
      failures.push(
        `SUPPORTED_MATCH_PATTERNS value "${pattern}" has no routing fixture${
          strictWildcard ? " with a real subdomain" : ""
        }`
      );
    }
  }

  for (const entry of platformManifest) {
    const positiveFixtures = routingFixtures.filter(
      (fixture) => fixture.expect === entry.name
    );
    if (positiveFixtures.length === 0) {
      failures.push(`platform "${entry.name}" has no positive routing fixture`);
      continue;
    }

    const reachableFixture = positiveFixtures.find(
      (fixture) =>
        supportedMatchPatterns.some((pattern) =>
          hostMatchesPattern(fixture.host, pattern)
        ) &&
        platformWarEntries.some((warEntry) =>
          (warEntry.matches ?? []).some((pattern) =>
            hostMatchesPattern(fixture.host, pattern)
          )
        )
    );
    if (!reachableFixture) {
      failures.push(
        `platform "${entry.name}" has no injectable, WAR-covered positive routing fixture`
      );
    }
  }

  const forbiddenPlatformEntryMarkers = [
    "platform-registry.ts",
    "registerAdapterWithRetry",
    "platform-loader.ts",
  ];
  for (const entry of platformManifest) {
    const entryName = `platforms/${entry.name}`;
    let modules;
    try {
      modules = collectEntryModules(esmStats, entryName);
    } catch (error) {
      failures.push(
        `${entryName} graph could not be collected: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      continue;
    }
    for (const identifier of modules) {
      const marker = forbiddenPlatformEntryMarkers.find((candidate) =>
        identifier.includes(candidate)
      );
      if (marker) {
        failures.push(
          `${entryName} graph contains forbidden ${marker}: ${identifier}`
        );
      }
    }
  }

  try {
    const contentModules = collectEntryModules(classicStats, "content");
    for (const identifier of contentModules) {
      const normalized = normalizeModulePath(identifier);
      if (
        /(^|\/)src\/content\/platforms\//.test(normalized) &&
        !normalized.endsWith("src/content/platforms/manifest.json")
      ) {
        failures.push(
          `classic content graph contains forbidden platform module: ${identifier}`
        );
      }
      if (/(^|\/)src\/content\/trading\//.test(normalized)) {
        failures.push(
          `classic content graph contains forbidden trading module: ${identifier}`
        );
      }
      const packageName = forbiddenHeavyPackage(normalized);
      if (packageName) {
        failures.push(
          `classic content graph contains forbidden heavy package ${packageName}: ${identifier}`
        );
      }
    }
  } catch (error) {
    failures.push(
      `classic content graph could not be collected: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  try {
    const tradingModules = collectEntryModules(esmStats, "content-trading");
    const requiredTradingPanelModules = [
      "src/content/trading/panel/deposit-view.ts",
      "src/content/trading/panel/format.ts",
      "src/content/trading/panel/order-view.ts",
      "src/content/trading/panel/panel-state.ts",
      "src/content/trading/panel/positions-view.ts",
      "src/content/trading/panel/setup-view.ts",
    ];
    const forbiddenTradingGraphMarkers = [
      "/src/content/ui/index.ts",
      "/src/content/trading-loader.ts",
      "/src/content/platform-loader.ts",
    ];
    const normalizedTradingModules = [...tradingModules].map(
      normalizeModulePath
    );
    for (const normalized of normalizedTradingModules) {
      const marker = forbiddenTradingGraphMarkers.find((candidate) =>
        normalized.includes(candidate)
      );
      if (marker) {
        failures.push(
          `content-trading graph contains forbidden core module ${marker}: ${normalized}`
        );
      }
    }
    for (const requiredModule of requiredTradingPanelModules) {
      if (
        !normalizedTradingModules.some((identifier) =>
          identifier.includes(requiredModule)
        )
      ) {
        failures.push(
          `content-trading graph is missing required panel module ${requiredModule}`
        );
      }
    }
  } catch (error) {
    failures.push(
      `content-trading graph could not be collected: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  for (const requiredAsset of [
    ...requiredClassicAssets,
    ...collectNamedAssets(classicStats.assets),
    ...expectedEsmAssets,
  ]) {
    if (!relativeFiles.includes(requiredAsset)) {
      failures.push(`clean build is missing required asset "${requiredAsset}"`);
    }
  }

  addSetFailures(
    failures,
    "ESM stats entrypoints",
    Object.keys(esmStats.entrypoints ?? {}),
    expectedEsmEntries
  );
  const esmJavaScriptAssets = (esmStats.assets ?? [])
    .map(assetName)
    .filter((name) => name?.endsWith(".js"));
  addSetFailures(
    failures,
    "ESM primary JavaScript assets",
    esmJavaScriptAssets,
    expectedEsmAssets
  );
  for (const entryName of expectedEsmEntries) {
    const primaryAssets = (esmStats.entrypoints?.[entryName]?.assets ?? [])
      .map(assetName)
      .filter((name) => name?.endsWith(".js"));
    const expectedAsset = `${entryName}.js`;
    if (primaryAssets.length !== 1 || primaryAssets[0] !== expectedAsset) {
      failures.push(
        `${entryName} must emit exactly "${expectedAsset}" as its primary JavaScript asset (got ${JSON.stringify(
          primaryAssets
        )})`
      );
    }
  }

  for (const filePath of files) {
    const relativePath = relativeDistPath(filePath);
    const pathParts = relativePath.split("/");
    for (const part of pathParts) {
      if (forbiddenPathParts.has(part)) {
        failures.push(`${relativePath} matches forbidden path part "${part}"`);
      }
    }

    for (const pattern of forbiddenPathPatterns) {
      if (pattern.test(relativePath)) {
        failures.push(
          `${relativePath} matches forbidden path pattern ${pattern}`
        );
      }
    }

    const markers = await fileContainsForbiddenContent(filePath);
    for (const marker of markers) {
      failures.push(`${relativePath} contains forbidden marker "${marker}"`);
    }
  }

  if (failures.length > 0) {
    process.stderr.write(
      `Production extension bundle checks failed:\n${failures
        .map((failure) => `- ${failure}`)
        .join("\n")}\n`
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `Production bundle check passed (${platformManifest.length} platform entries; content.js ${contentJavaScriptBytes} bytes <= ${contentJavaScriptByteBudget}-byte budget).\n`
  );
}

main().catch((error) => {
  process.stderr.write(
    error instanceof Error ? error.stack || error.message : String(error)
  );
  process.stderr.write("\n");
  process.exitCode = 1;
});
