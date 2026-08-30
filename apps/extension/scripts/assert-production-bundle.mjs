#!/usr/bin/env node

import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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

// Chrome Web Store–compliant build. Must ship no real-money trading or
// on-chain money-movement code. Keep in sync with webpack STORE_BUILD gating.
// See docs/chrome-prediction-market-ban-assessment.md.
const STORE_BUILD = process.env.STORE_BUILD === "true";

// Source-module path fragments that constitute genuine trading capability:
// order placement, on-chain money movement, and wallet signing. In a store
// build NONE of these may appear anywhere in the emitted module graph (any
// entry chunk or lazily-split async chunk).
const STORE_FORBIDDEN_MODULE_MARKERS = [
  "src/background/portfolio-funds",
  "src/background/bridge-signer",
  "src/background/relayer-client",
  "src/background/unified-clob-client",
  "src/background/trading-handler",
  "src/background/clob-open-orders",
  "src/offscreen/trading-runtime",
  // The unified Polymarket CLOB SDK (order placement / split / merge). Reached
  // via the dynamic imports in packages/shared-types/src/clob.ts.
  "packages/shared-types/src/polymarket-unified",
];

// Everything under src/content/trading/ is forbidden in the store graph by
// default; only these capability-free state/util helpers, which the read-only
// sidepanel legitimately shares, are allowed through. A new file in that
// directory therefore fails the store build until it is explicitly reviewed
// and listed here (deny-by-default, not allow-by-omission).
const STORE_ALLOWED_TRADING_UTIL_FILES = new Set([
  "src/content/trading/backoff.ts",
  "src/content/trading/setup-gates.ts",
  "src/content/trading/portfolio-approval.ts",
  "src/content/trading/portfolio-setup-view.ts",
  "src/content/trading/setup-flow.ts",
  "src/content/trading/setup-flow-storage.ts",
  // The wallet-only rail shipped as content-wallet.js: EIP-6963 discovery,
  // WalletConnect pairing, and knoww.app session auth (personal_sign only).
  // Reviewed capability-free — no order construction, credential derivation,
  // approvals, or on-chain money movement.
  "src/content/trading/wallet-entry.ts",
  "src/content/trading/bridge.ts",
  "src/content/trading/walletconnect-bridge.ts",
  "src/content/trading/walletconnect-qr.ts",
  "src/content/trading/extension-session.ts",
]);

function storeForbiddenTradingDirModule(normalizedIdentifier) {
  const match = normalizedIdentifier.match(/src\/content\/trading\/.*$/);
  if (!match) return null;
  // Strip webpack loader/query suffixes ("path.ts?abcd", "loader!path.ts").
  const sourcePath = match[0].split("?")[0].split("!").pop();
  return STORE_ALLOWED_TRADING_UTIL_FILES.has(sourcePath) ? null : sourcePath;
}

// Endpoints dropped from host_permissions in the store build (order placement
// + on-chain money movement). Keep in sync with webpack.config.cjs.
const STORE_FORBIDDEN_HOST_PERMISSIONS = [
  "https://clob.polymarket.com/*",
  "https://relayer-v2.polymarket.com/*",
  "https://bridge.polymarket.com/*",
];

function collectAllModuleIdentifiers(statsJson, identifiers = new Set()) {
  const visit = (module) => {
    if (!module || typeof module !== "object") return;
    for (const field of ["nameForCondition", "identifier", "name"]) {
      if (typeof module[field] === "string" && module[field].length > 0) {
        identifiers.add(module[field]);
        break;
      }
    }
    for (const nested of module.modules ?? []) visit(nested);
  };
  for (const module of statsJson?.modules ?? []) visit(module);
  for (const chunk of statsJson?.chunks ?? []) {
    for (const module of chunk?.modules ?? []) visit(module);
  }
  return identifiers;
}

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
  "markets-panel-navbar.css",
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
  "unsupported-site-prompt.css",
  "unsupported-site.js",
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
  // Each build emits exactly one runtime chunk: the full trading panel in the
  // regular build, the wallet-only runtime (discovery + WalletConnect +
  // session auth) in the store build. Both export the same
  // createTradingRuntime contract; the other build's chunk must be absent.
  const runtimeChunkEntry = STORE_BUILD ? "content-wallet" : "content-trading";
  const runtimeChunkAsset = `${runtimeChunkEntry}.js`;
  const absentRuntimeChunkAsset = STORE_BUILD
    ? "content-trading.js"
    : "content-wallet.js";
  if (relativeFiles.includes(absentRuntimeChunkAsset)) {
    failures.push(
      STORE_BUILD
        ? "store build must not emit content-trading.js (in-page trading panel)"
        : "full build must not emit content-wallet.js (store-only wallet runtime)"
    );
  }
  try {
    const runtimeChunkSource = await readFile(
      path.join(distDir, runtimeChunkAsset),
      "utf8"
    );
    const exportNames = extractStaticEsmExportNames(runtimeChunkSource);
    if (exportNames.length !== 1 || exportNames[0] !== "createTradingRuntime") {
      failures.push(
        `${runtimeChunkAsset} static exports must be exactly ["createTradingRuntime"] (got ${JSON.stringify(exportNames)})`
      );
    }
  } catch (error) {
    failures.push(
      `${runtimeChunkAsset} static exports could not be parsed: ${
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
  const expectedEsmEntries = [...expectedPlatformEntries, runtimeChunkEntry];
  const expectedEsmAssets = [...expectedPlatformAssets, runtimeChunkAsset];
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
  // The lazy-WAR contract asserts this build's runtime chunk (trading in the
  // full build, wallet-only in the store build) is exposed exactly once by the
  // same canonical owner as platforms/*.js.
  for (const failure of validateLazyWarContract(
    builtManifest.web_accessible_resources,
    supportedMatchPatterns,
    runtimeChunkAsset
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

  if (STORE_BUILD) {
    // Authoritative capability check: no trading / money-movement / signing
    // source module may appear anywhere in the emitted graph — not in an entry
    // chunk, not in a lazily-split async chunk. This is what makes the store
    // ZIP genuinely compliant rather than merely UI-hidden.
    const allModules = [
      ...collectAllModuleIdentifiers(classicStats),
      ...collectAllModuleIdentifiers(esmStats),
    ].map(normalizeModulePath);
    // Guard against a vacuous pass: if the stats walker returns almost
    // nothing, the marker scan below would "pass" without inspecting the
    // real module graph (stats format drift, empty stats file, etc.).
    if (allModules.length < 50) {
      failures.push(
        `store module-graph scan collected only ${allModules.length} module identifiers — stats look wrong, refusing to certify the build`
      );
    }
    for (const marker of STORE_FORBIDDEN_MODULE_MARKERS) {
      const leaked = allModules.find((identifier) =>
        identifier.includes(marker)
      );
      if (leaked) {
        failures.push(
          `store build leaks forbidden trading module "${marker}": ${leaked}`
        );
      }
    }
    const leakedTradingDirModules = new Set();
    for (const identifier of allModules) {
      const forbidden = storeForbiddenTradingDirModule(identifier);
      if (forbidden) leakedTradingDirModules.add(forbidden);
    }
    for (const forbidden of leakedTradingDirModules) {
      failures.push(
        `store build leaks src/content/trading module "${forbidden}" (not in the reviewed capability-free allowlist)`
      );
    }
    const hostPermissions = Array.isArray(builtManifest.host_permissions)
      ? builtManifest.host_permissions
      : [];
    for (const forbidden of STORE_FORBIDDEN_HOST_PERMISSIONS) {
      if (hostPermissions.includes(forbidden)) {
        failures.push(
          `store build manifest must not request trading host permission "${forbidden}"`
        );
      }
    }
    const warResources =
      builtManifest.web_accessible_resources?.[0]?.resources ?? [];
    if (warResources.includes("content-trading.js")) {
      failures.push(
        "store build manifest must not expose content-trading.js as a web-accessible resource"
      );
    }
  }

  if (STORE_BUILD) {
    try {
      const walletModules = [
        ...collectEntryModules(esmStats, "content-wallet"),
      ].map(normalizeModulePath);
      // The wallet chunk must actually contain the wallet rail (a build that
      // silently dropped it would strand the sidepanel with no wallets) and
      // none of the core modules the loader/UI own.
      const requiredWalletModules = [
        "src/content/trading/wallet-entry.ts",
        "src/content/trading/bridge.ts",
        "src/content/trading/walletconnect-bridge.ts",
        "src/content/trading/walletconnect-qr.ts",
        "src/content/trading/extension-session.ts",
      ];
      const forbiddenWalletGraphMarkers = [
        "/src/content/ui/index.ts",
        "/src/content/trading-loader.ts",
        "/src/content/platform-loader.ts",
      ];
      for (const normalized of walletModules) {
        const marker = forbiddenWalletGraphMarkers.find((candidate) =>
          normalized.includes(candidate)
        );
        if (marker) {
          failures.push(
            `content-wallet graph contains forbidden core module ${marker}: ${normalized}`
          );
        }
      }
      for (const requiredModule of requiredWalletModules) {
        if (
          !walletModules.some((identifier) =>
            identifier.includes(requiredModule)
          )
        ) {
          failures.push(
            `content-wallet graph is missing required wallet module ${requiredModule}`
          );
        }
      }
    } catch (error) {
      failures.push(
        `content-wallet graph could not be collected: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  } else {
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

  // Variant marker consumed by the zip scripts so `zip:store` can only ever
  // package a verified store build (and `zip` only a full build). Webpack's
  // `clean: true` wipes it on every rebuild; it is (re)written only after all
  // checks above pass, and the zip excludes dotfiles so it never ships.
  const storeMarkerPath = path.join(distDir, ".store-build");
  if (STORE_BUILD) {
    await writeFile(storeMarkerPath, "");
  } else {
    await rm(storeMarkerPath, { force: true });
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
